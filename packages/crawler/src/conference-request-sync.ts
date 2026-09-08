import type { Catalog, Deadline, Edition, Evidence } from "@conf/contracts"
import { findTrackedEditionIndex } from "./conference-request-tracking"
import type { ConferenceRequestRecord } from "./management-requests"
import { type ParsedObservation, parseOfficialHtml } from "./parsers"
import { fetchRegisteredHtml } from "./safe-fetch"
import type { RegisteredSource } from "./source-registry"

export interface ConferenceRequestSource {
  readonly finalUrl: string
  readonly checkedAt: string
  readonly observations: readonly ParsedObservation[]
}

export interface ConferenceRequestEditionResult {
  readonly edition: Edition
  readonly evidence: readonly Evidence[]
}

export interface ConferenceRequestSyncOptions {
  readonly now: Date
  readonly fetchSource: (request: ConferenceRequestRecord) => Promise<ConferenceRequestSource>
}

export interface ConferenceRequestSyncResult {
  readonly catalog: Catalog
  readonly imported: readonly string[]
  readonly skipped: readonly string[]
  readonly failed: readonly string[]
  readonly report: string
}

const deadlineLabels: Readonly<Record<Deadline["kind"], string>> = {
  abstract_registration: "초록 등록",
  paper_submission: "논문 제출",
  supplementary_submission: "보충 자료 제출",
  first_notification: "1차 결과 발표",
  rebuttal: "반박 제출",
  final_notification: "최종 결과 발표",
  camera_ready: "최종본 제출",
  workshop_submission: "워크숍 제출",
}

function requestSlug(request: ConferenceRequestRecord): string {
  const name = request.name
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const normalizedId = request.id.replace(/[^a-zA-Z0-9]+/g, "-")
  const suffix = normalizedId.length > 16 ? normalizedId.slice(-8) : normalizedId
  return `${name || "conference"}-${suffix || "request"}`
}

function requestYear(request: ConferenceRequestRecord, now: Date): number {
  const yearMatch = /\b(20\d{2})\b/.exec(`${request.name} ${request.officialUrl}`)
  return yearMatch?.[1] ? Number(yearMatch[1]) : now.getUTCFullYear() + 1
}

function requestAcronym(request: ConferenceRequestRecord, year: number): string {
  return /\b20\d{2}\b/.test(request.name) ? request.name : `${request.name} ${year}`
}

function statusForObservation(
  observation: ParsedObservation,
): "confirmed" | "timezone-review-needed" | undefined {
  switch (observation.state) {
    case "accepted":
      return "confirmed"
    case "timezone-review-needed":
      return "timezone-review-needed"
    case "review-needed":
      return undefined
  }
}

function uniqueObservationByKind(
  observations: readonly ParsedObservation[],
): readonly ParsedObservation[] {
  const groups = new Map<Deadline["kind"], ParsedObservation[]>()
  for (const observation of observations) {
    const values = groups.get(observation.kind) ?? []
    values.push(observation)
    groups.set(observation.kind, values)
  }
  return [...groups.values()].flatMap((values) => {
    const usable = values.filter(
      (value) => value.normalizedValue && value.displayDate && value.sourceTimezone,
    )
    return usable.length === 1 ? usable : []
  })
}

function createDeadline(editionId: string, observation: ParsedObservation): Deadline | undefined {
  if (!observation.normalizedValue || !observation.displayDate || !observation.sourceTimezone)
    return undefined
  const status = statusForObservation(observation)
  if (!status) return undefined
  return {
    id: `${editionId}-${observation.kind}`,
    label: deadlineLabels[observation.kind],
    kind: observation.kind,
    dueAtUtc: observation.normalizedValue,
    displayDate: observation.displayDate,
    timezone: observation.sourceTimezone,
    status,
    track: "Main conference",
  }
}

function editionStatus(deadlines: readonly Deadline[]): Edition["status"] {
  if (deadlines.length === 0) return "dates-pending"
  if (deadlines.some((deadline) => deadline.status === "timezone-review-needed"))
    return "timezone-review-needed"
  return "review-needed"
}

export function buildConferenceRequestEdition(
  request: ConferenceRequestRecord,
  source: ConferenceRequestSource,
  now: Date,
): ConferenceRequestEditionResult {
  const id = requestSlug(request)
  const year = requestYear(request, now)
  const deadlines = uniqueObservationByKind(source.observations)
    .filter((observation) => {
      if (!observation.normalizedValue) return false
      return observation.normalizedValue >= now.toISOString()
    })
    .map((observation) => createDeadline(id, observation))
    .filter((deadline): deadline is Deadline => deadline !== undefined)
    .sort((left, right) => left.dueAtUtc.localeCompare(right.dueAtUtc))
  const edition: Edition = {
    id,
    acronym: requestAcronym(request, year),
    name: request.name,
    year,
    location: "공식 발표 대기",
    dateRange: "공식 일정 검수 중",
    conferenceStart: null,
    conferenceEnd: null,
    officialUrl: request.officialUrl,
    tier: null,
    categories: [request.category],
    status: editionStatus(deadlines),
    description: "관리자 요청으로 등록된 후보입니다. 공식 일정과 장소 검수가 필요합니다.",
    registrySource: "curated",
    registrySourceUrl: request.officialUrl,
    registryRecordId: request.id,
    deadlines,
  }
  const evidence = deadlines.map((deadline) => {
    const observation = source.observations.find((value) => value.kind === deadline.kind)
    if (!observation) throw new Error(`추출 근거가 없습니다: ${deadline.id}`)
    return {
      id: `request-${request.id}-${deadline.kind}`,
      editionId: id,
      deadlineId: deadline.id,
      sourceTitle: `${request.name} official page · initial extraction`,
      sourceUrl: source.finalUrl || request.officialUrl,
      checkedAt: source.checkedAt,
      rawValue: observation.rawValue,
      locator: observation.locator,
      confidence: observation.confidence,
    }
  })
  return { edition, evidence }
}

export async function fetchConferenceRequestSource(
  request: ConferenceRequestRecord,
): Promise<ConferenceRequestSource> {
  const url = new URL(request.officialUrl)
  if (url.protocol !== "https:") throw new Error("공식 URL은 HTTPS여야 합니다.")
  const source: RegisteredSource = {
    id: `request-${request.id}`,
    canonicalUrl: url.href,
    allowedHosts: [url.hostname],
    adapter: "official-html",
  }
  const fetched = await fetchRegisteredHtml(source)
  return {
    finalUrl: fetched.finalUrl,
    checkedAt: new Date().toISOString(),
    observations: parseOfficialHtml(fetched.body),
  }
}

export async function syncConferenceRequests(
  catalog: Catalog,
  requests: readonly ConferenceRequestRecord[],
  options: ConferenceRequestSyncOptions,
): Promise<ConferenceRequestSyncResult> {
  const nextEditions = [...catalog.editions]
  const nextEvidence = [...catalog.evidence]
  const imported: string[] = []
  const skipped: string[] = []
  const failed: string[] = []
  const reportLines = ["# Conference request review", ""]
  for (const request of [...requests].sort((left, right) => left.id.localeCompare(right.id))) {
    if (request.status !== "approved") {
      skipped.push(`${request.id}:status-${request.status}`)
      continue
    }
    const trackedIndex = findTrackedEditionIndex(nextEditions, request)
    const trackedEdition = nextEditions[trackedIndex]
    if (
      trackedEdition &&
      (trackedEdition.registryRecordId !== request.id || trackedEdition.deadlines.length > 0)
    ) {
      skipped.push(`${request.id}:already-tracked`)
      continue
    }
    try {
      const source = await options.fetchSource(request)
      const result = buildConferenceRequestEdition(request, source, options.now)
      if (trackedIndex >= 0 && result.edition.deadlines.length === 0) {
        skipped.push(`${request.id}:dates-pending`)
        continue
      }
      if (trackedEdition)
        nextEditions.splice(trackedIndex, 1, {
          ...trackedEdition,
          deadlines: result.edition.deadlines,
          status: result.edition.status,
        })
      else nextEditions.push(result.edition)
      nextEvidence.push(...result.evidence)
      imported.push(request.id)
      reportLines.push(
        `## ${request.name}`,
        "",
        `Request ID: ${request.id}`,
        `Official URL: ${request.officialUrl}`,
        `Result: ${trackedIndex >= 0 ? "refreshed" : "imported"} into the catalog as a reviewable candidate (${result.edition.id}).`,
        `Extracted deadlines: ${result.edition.deadlines.length}`,
        "",
      )
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "알 수 없는 오류"
      failed.push(`${request.id}:${reason}`)
      reportLines.push(
        `## ${request.name}`,
        "",
        `Request ID: ${request.id}`,
        `Official URL: ${request.officialUrl}`,
        `Result: rejected for review (${reason}).`,
        "",
      )
    }
  }
  if (imported.length === 0 && failed.length === 0)
    reportLines.push("No new approved requests.", "")
  if (failed.length > 0) {
    reportLines.push("## Failed requests", "", ...failed.map((value) => `- ${value}`), "")
  }
  return {
    catalog: { editions: nextEditions, evidence: nextEvidence, history: catalog.history },
    imported,
    skipped,
    failed,
    report: reportLines.join("\n"),
  }
}
