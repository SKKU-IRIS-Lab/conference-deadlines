import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { type Catalog, catalogSchema } from "@conf/contracts"
import { z } from "zod"
import { auditConferenceMetadata, type MetadataFinding } from "./metadata-audit"
import { parseOfficialHtml } from "./parsers"
import { fetchRegisteredHtml } from "./safe-fetch"
import {
  applyScheduleProposals,
  buildScheduleProposals,
  formatScheduleProposalReport,
  type ScheduleProposal,
  type SourcePageObservations,
} from "./schedule-sync"
import type { RegisteredSource } from "./source-registry"

const availableCheckSchema = z.object({
  id: z.string().min(1),
  canonicalUrl: z.string().url(),
  finalUrl: z.string().url(),
  kind: z.literal("available"),
  sha256: z.string().min(1),
})

const unavailableCheckSchema = z.object({
  id: z.string().min(1),
  canonicalUrl: z.string().url(),
  kind: z.literal("unavailable"),
  reason: z.string().min(1),
})

const sourceStateSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.record(
    z.string(),
    z.discriminatedUnion("kind", [availableCheckSchema, unavailableCheckSchema]),
  ),
})

export type SourceCheck = z.infer<typeof sourceStateSchema>["sources"][string]

export interface SourceState {
  readonly schemaVersion: 1
  readonly sources: Readonly<Record<string, SourceCheck>>
}

export interface MonitorSource {
  readonly id: string
  readonly editionId: string
  readonly name: string
  readonly canonicalUrl: string
}

const sourceChangeKinds = [
  "initial",
  "url-moved",
  "content-changed",
  "availability-changed",
] as const

export type SourceChangeKind = (typeof sourceChangeKinds)[number]

export interface SourceChange {
  readonly id: string
  readonly kind: SourceChangeKind
  readonly canonicalUrl: string
  readonly previous: SourceCheck | undefined
  readonly next: SourceCheck
}

export interface MonitorRun {
  readonly sources: readonly MonitorSource[]
  readonly state: SourceState
  readonly changes: readonly SourceChange[]
  readonly scheduleProposals: readonly ScheduleProposal[]
  readonly metadataFindings?: readonly MetadataFinding[]
}

export interface SourceMonitorOptions {
  /** Only inspect editions with a submission deadline in this many upcoming days. */
  readonly deadlineWithinDays?: number
  readonly now?: Date
}

function registeredSource(source: MonitorSource): RegisteredSource | undefined {
  const url = new URL(source.canonicalUrl)
  if (url.protocol !== "https:") return undefined
  return {
    id: source.id,
    canonicalUrl: source.canonicalUrl,
    allowedHosts: [url.hostname],
    adapter: "official-html",
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function hasDeadlineWithinDays(edition: Catalog["editions"][number], now: Date, days: number) {
  const start = now.getTime()
  const end = start + days * 86_400_000
  return edition.deadlines.some((deadline) => {
    const dueAt = new Date(deadline.dueAtUtc).getTime()
    return Number.isFinite(dueAt) && dueAt >= start && dueAt <= end
  })
}

export function monitorSources(
  catalog: Catalog,
  options: SourceMonitorOptions = {},
): readonly MonitorSource[] {
  const now = options.now ?? new Date()
  const editions =
    options.deadlineWithinDays === undefined
      ? catalog.editions
      : catalog.editions.filter((edition) =>
          hasDeadlineWithinDays(edition, now, options.deadlineWithinDays ?? 0),
        )
  return editions
    .flatMap((edition) => [
      {
        id: edition.id,
        editionId: edition.id,
        name: edition.acronym,
        canonicalUrl: edition.officialUrl,
      },
      ...(edition.additionalSourceUrls ?? []).map((canonicalUrl, index) => ({
        id: `${edition.id}:additional-${index + 1}`,
        editionId: edition.id,
        name: edition.acronym,
        canonicalUrl,
      })),
    ])
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function createSourceState(checks: readonly SourceCheck[]): SourceState {
  return {
    schemaVersion: 1,
    sources: Object.fromEntries(checks.map((check) => [check.id, check])),
  }
}

export function compareSourceStates(
  previous: SourceState,
  next: SourceState,
): readonly SourceChange[] {
  const changes: SourceChange[] = []
  for (const nextCheck of Object.values(next.sources)) {
    const previousCheck = previous.sources[nextCheck.id]
    if (!previousCheck) {
      changes.push({
        id: nextCheck.id,
        kind: "initial",
        canonicalUrl: nextCheck.canonicalUrl,
        previous: undefined,
        next: nextCheck,
      })
      continue
    }
    if (
      previousCheck.kind === "available" &&
      nextCheck.kind === "available" &&
      previousCheck.finalUrl !== nextCheck.finalUrl
    ) {
      changes.push({
        id: nextCheck.id,
        kind: "url-moved",
        canonicalUrl: nextCheck.canonicalUrl,
        previous: previousCheck,
        next: nextCheck,
      })
      continue
    }
    if (
      previousCheck.kind === "available" &&
      nextCheck.kind === "available" &&
      previousCheck.sha256 !== nextCheck.sha256
    ) {
      changes.push({
        id: nextCheck.id,
        kind: "content-changed",
        canonicalUrl: nextCheck.canonicalUrl,
        previous: previousCheck,
        next: nextCheck,
      })
      continue
    }
    if (previousCheck.kind !== nextCheck.kind)
      changes.push({
        id: nextCheck.id,
        kind: "availability-changed",
        canonicalUrl: nextCheck.canonicalUrl,
        previous: previousCheck,
        next: nextCheck,
      })
  }
  return changes
}

interface SourceCheckResult {
  readonly check: SourceCheck
  readonly page: SourcePageObservations | undefined
}

async function checkSource(source: MonitorSource): Promise<SourceCheckResult> {
  const registered = registeredSource(source)
  if (!registered)
    return {
      check: {
        id: source.id,
        canonicalUrl: source.canonicalUrl,
        kind: "unavailable",
        reason: "non-https-source",
      },
      page: undefined,
    }
  try {
    const fetched = await fetchRegisteredHtml(registered)
    const checkedAt = new Date().toISOString()
    return {
      check: {
        id: source.id,
        canonicalUrl: source.canonicalUrl,
        finalUrl: fetched.finalUrl,
        kind: "available",
        sha256: await sha256(fetched.body),
      },
      page: {
        editionId: source.editionId,
        sourceUrl: source.canonicalUrl,
        finalUrl: fetched.finalUrl,
        checkedAt,
        observations: parseOfficialHtml(fetched.body),
        html: fetched.body,
      },
    }
  } catch (error: unknown) {
    if (error instanceof Error)
      return {
        check: {
          id: source.id,
          canonicalUrl: source.canonicalUrl,
          kind: "unavailable",
          reason: error.name,
        },
        page: undefined,
      }
    throw error
  }
}

export async function readSourceState(path: string): Promise<SourceState> {
  const file = Bun.file(path)
  if (!(await file.exists())) return createSourceState([])
  return sourceStateSchema.parse(await file.json())
}

export async function runSourceMonitor(
  catalogPath: string,
  statePath: string,
  options: SourceMonitorOptions = {},
): Promise<MonitorRun> {
  const catalog = catalogSchema.parse(await Bun.file(catalogPath).json())
  const sources = monitorSources(catalog, options)
  const previous = await readSourceState(statePath)
  const checks: SourceCheck[] = []
  const pages: SourcePageObservations[] = []
  for (const source of sources) {
    const result = await checkSource(source)
    checks.push(result.check)
    if (result.page) pages.push(result.page)
  }
  const checkedState = createSourceState(checks)
  // A partial daily scan must not erase fingerprints for sources reserved for
  // the weekly full scan. The full scan remains the canonical reconciliation.
  const state =
    options.deadlineWithinDays === undefined
      ? checkedState
      : {
          schemaVersion: 1 as const,
          sources: { ...previous.sources, ...checkedState.sources },
        }
  const checkedEditionIds = new Set(sources.map((source) => source.editionId))
  const metadataFindings = auditConferenceMetadata(
    {
      ...catalog,
      editions: catalog.editions.filter((edition) => checkedEditionIds.has(edition.id)),
    },
    pages,
  )
  const mismatchedEditions = new Set(
    metadataFindings
      .filter((finding) => finding.kind === "source-year-mismatch")
      .map((finding) => finding.editionId),
  )
  return {
    sources,
    state,
    changes: compareSourceStates(previous, checkedState),
    metadataFindings,
    scheduleProposals: buildScheduleProposals(
      catalog,
      pages.filter((page) => !mismatchedEditions.has(page.editionId)),
    ),
  }
}

/**
 * This is intentionally narrower than a valid proposal. Auto-merge is only
 * allowed for a high-confidence, confirmed deadline from its own unchanged
 * official host; URL moves, outages, ambiguous timezones, and unrelated page
 * changes always remain in a human review PR.
 */
export function isAutoMergeEligible(run: MonitorRun): boolean {
  if (run.metadataFindings?.length) return false
  if (run.scheduleProposals.length === 0) return false
  const proposedEditionIds = new Set(run.scheduleProposals.map((proposal) => proposal.editionId))
  const proposalsAreStrict = run.scheduleProposals.every((proposal) => {
    const officialHost = new URL(proposal.officialUrl).hostname
    const sourceHost = new URL(proposal.sourceUrl).hostname
    return (
      proposal.status === "confirmed" && proposal.confidence >= 0.98 && officialHost === sourceHost
    )
  })
  const changesAreScoped = run.changes.every((change) => {
    const editionId = change.id.split(":", 1)[0]
    return (
      editionId !== undefined &&
      change.kind === "content-changed" &&
      proposedEditionIds.has(editionId)
    )
  })
  return proposalsAreStrict && changesAreScoped
}

export function formatMonitorReport(run: MonitorRun): string {
  const lines = ["# Official-source review", ""]
  if (run.changes.length === 0) lines.push("No source changes detected.", "")
  else {
    lines.push(`${run.changes.length} source change(s) require review.`, "")
    for (const change of run.changes) {
      lines.push(`## ${change.id}: ${change.kind}`, "", `Official URL: ${change.canonicalUrl}`, "")
      if (change.previous?.kind === "available")
        lines.push(`Previous fingerprint: ${change.previous.sha256}`)
      if (change.next.kind === "available") {
        lines.push(
          `Current URL: ${change.next.finalUrl}`,
          `Current fingerprint: ${change.next.sha256}`,
        )
      } else lines.push(`Check result: ${change.next.reason}`)
      lines.push("")
    }
  }
  lines.push("## Venue and event-date review", "")
  for (const finding of run.metadataFindings ?? [])
    lines.push(`- ${finding.editionId}: ${finding.kind} — ${finding.sourceUrl}`)
  lines.push(
    "",
    "Metadata findings require manual verification; venue/date values are not inferred automatically.",
    "",
  )
  return [...lines, formatScheduleProposalReport(run.scheduleProposals)].join("\n")
}

export async function writeMonitorReview(
  statePath: string,
  reportPath: string,
  run: MonitorRun,
): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true })
  await mkdir(dirname(reportPath), { recursive: true })
  await Bun.write(statePath, `${JSON.stringify(run.state, null, 2)}\n`)
  await Bun.write(reportPath, `${formatMonitorReport(run)}\n`)
}

export async function writeScheduleUpdates(
  catalogPath: string,
  catalog: Catalog,
  run: MonitorRun,
): Promise<void> {
  if (run.scheduleProposals.length === 0) return
  const next = applyScheduleProposals(catalog, run.scheduleProposals)
  await Bun.write(catalogPath, `${JSON.stringify(next, null, 2)}\n`)
}
