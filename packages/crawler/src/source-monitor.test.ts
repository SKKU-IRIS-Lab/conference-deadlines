import { expect, test } from "bun:test"
import { catalogSchema } from "@conf/contracts"
import {
  compareSourceStates,
  createSourceState,
  formatMonitorReport,
  isAutoMergeEligible,
  type MonitorRun,
  monitorSources,
} from "./source-monitor"

test("source monitor registers every catalog edition as an official URL check", async () => {
  // Given: the published catalog that powers the public site.
  const catalog = catalogSchema.parse(
    await Bun.file(new URL("../../../data/seed/catalog-state.json", import.meta.url)).json(),
  )

  // When: the monthly monitor derives its registered sources.
  const sources = monitorSources(catalog)

  // Then: every edition has a primary check, plus every registered official auxiliary source.
  const additionalSourceCount = catalog.editions.reduce(
    (count, edition) => count + (edition.additionalSourceUrls?.length ?? 0),
    0,
  )
  expect(sources).toHaveLength(catalog.editions.length + additionalSourceCount)
  expect(new Set(sources.map((source) => source.id)).size).toBe(
    catalog.editions.length + additionalSourceCount,
  )
  expect(sources.every((source) => new URL(source.canonicalUrl).protocol === "https:")).toBe(true)
  expect(sources).toContainEqual({
    id: "isca-2026:additional-1",
    editionId: "isca-2026",
    name: "ISCA 2026",
    canonicalUrl: "https://iscaconf.org/isca2026/submit/callforpapers.php",
  })
})

test("daily monitor narrows requests to imminent submission deadlines", async () => {
  const catalog = catalogSchema.parse(
    await Bun.file(new URL("../../../data/seed/catalog-state.json", import.meta.url)).json(),
  )
  const now = new Date("2026-09-03T00:00:00.000Z")
  const imminent = monitorSources(catalog, { deadlineWithinDays: 30, now })
  const sourceEditions = new Map(catalog.editions.map((edition) => [edition.id, edition]))

  expect(imminent.length).toBeGreaterThan(0)
  expect(
    imminent.every((source) => {
      const edition = sourceEditions.get(source.editionId)
      return edition?.deadlines.some((deadline) => {
        const dueAt = new Date(deadline.dueAtUtc).getTime()
        return dueAt >= now.getTime() && dueAt <= now.getTime() + 30 * 86_400_000
      })
    }),
  ).toBe(true)
})

test("source monitor reports a changed official URL fingerprint", () => {
  // Given: a previously reachable official source.
  const previous = createSourceState([
    {
      id: "cvpr-2027",
      canonicalUrl: "https://cvpr.thecvf.com/",
      finalUrl: "https://cvpr.thecvf.com/",
      kind: "available",
      sha256: "first-hash",
    },
  ])

  // When: the source content changes without moving.
  const next = createSourceState([
    {
      id: "cvpr-2027",
      canonicalUrl: "https://cvpr.thecvf.com/",
      finalUrl: "https://cvpr.thecvf.com/",
      kind: "available",
      sha256: "second-hash",
    },
  ])
  const previousCheck = previous.sources["cvpr-2027"]
  const nextCheck = next.sources["cvpr-2027"]
  if (!previousCheck || !nextCheck) throw new Error("source state fixture is incomplete")

  // Then: review receives the content change with the official URL.
  expect(compareSourceStates(previous, next)).toEqual([
    {
      id: "cvpr-2027",
      kind: "content-changed",
      canonicalUrl: "https://cvpr.thecvf.com/",
      previous: previousCheck,
      next: nextCheck,
    },
  ])
})

test("source monitor reports a cross-host redirect for review", () => {
  // Given: the source was previously hosted on its registered domain.
  const previous = createSourceState([
    {
      id: "cvpr-2027",
      canonicalUrl: "https://cvpr.thecvf.com/",
      finalUrl: "https://cvpr.thecvf.com/",
      kind: "available",
      sha256: "same-hash",
    },
  ])

  // When: a later check observes a different final URL.
  const next = createSourceState([
    {
      id: "cvpr-2027",
      canonicalUrl: "https://cvpr.thecvf.com/",
      finalUrl: "https://cvpr2027.example.org/",
      kind: "available",
      sha256: "same-hash",
    },
  ])
  const previousCheck = previous.sources["cvpr-2027"]
  const nextCheck = next.sources["cvpr-2027"]
  if (!previousCheck || !nextCheck) throw new Error("source state fixture is incomplete")

  // Then: review receives an URL-moved event instead of an automatic replacement.
  expect(compareSourceStates(previous, next)).toEqual([
    {
      id: "cvpr-2027",
      kind: "url-moved",
      canonicalUrl: "https://cvpr.thecvf.com/",
      previous: previousCheck,
      next: nextCheck,
    },
  ])
})

test("only a strict confirmed proposal is eligible for automatic merge", () => {
  const state = createSourceState([
    {
      id: "cvpr-2027",
      canonicalUrl: "https://cvpr.example.org/",
      finalUrl: "https://cvpr.example.org/",
      kind: "available",
      sha256: "current-hash",
    },
  ])
  const current = state.sources["cvpr-2027"]
  if (!current) throw new Error("state fixture is incomplete")
  const run: MonitorRun = {
    sources: [],
    state,
    changes: [
      {
        id: "cvpr-2027",
        kind: "content-changed",
        canonicalUrl: "https://cvpr.example.org/",
        previous: {
          id: "cvpr-2027",
          canonicalUrl: "https://cvpr.example.org/",
          finalUrl: "https://cvpr.example.org/",
          kind: "available",
          sha256: "previous-hash",
        },
        next: current,
      },
    ],
    scheduleProposals: [
      {
        editionId: "cvpr-2027",
        acronym: "CVPR 2027",
        officialUrl: "https://cvpr.example.org/",
        deadlineId: "cvpr-2027-paper",
        kind: "paper_submission",
        beforeDueAtUtc: "2026-11-01T23:59:59Z",
        afterDueAtUtc: "2026-11-08T23:59:59Z",
        displayDate: "2026. 11. 8",
        timezone: "UTC",
        status: "confirmed",
        rawValue: "Paper submission: 2026-11-08 23:59 UTC",
        locator: "#dates",
        sourceUrl: "https://cvpr.example.org/cfp",
        checkedAt: "2026-09-03T00:00:00Z",
        confidence: 0.98,
      },
    ],
  }

  expect(isAutoMergeEligible(run)).toBe(true)
  const metadataRun = {
    ...run,
    metadataFindings: [
      {
        editionId: "cvpr-2027",
        sourceUrl: "https://cvpr.example.org/",
        kind: "missing-location" as const,
      },
    ],
  }
  expect(isAutoMergeEligible(metadataRun)).toBe(false)
  expect(formatMonitorReport({ ...metadataRun, changes: [] })).toContain(
    "cvpr-2027: missing-location",
  )
  const [proposal] = run.scheduleProposals
  expect(proposal).toBeDefined()
  if (!proposal) return

  expect(
    isAutoMergeEligible({
      ...run,
      scheduleProposals: [{ ...proposal, status: "timezone-review-needed" }],
    }),
  ).toBe(false)
})
