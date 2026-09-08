import type { Catalog, Deadline, Evidence, History } from "@conf/contracts"
import type { ParsedObservation } from "./parsers"

export interface SourcePageObservations {
  readonly editionId: string
  readonly sourceUrl: string
  readonly finalUrl: string
  readonly checkedAt: string
  readonly html?: string
  readonly observations: readonly ParsedObservation[]
}

export interface ScheduleProposal {
  readonly editionId: string
  readonly acronym: string
  readonly officialUrl: string
  readonly deadlineId: string
  readonly kind: Deadline["kind"]
  readonly beforeDueAtUtc: string
  readonly afterDueAtUtc: string
  readonly displayDate: string
  readonly timezone: string
  readonly status: "confirmed" | "timezone-review-needed"
  readonly rawValue: string
  readonly locator: string
  readonly sourceUrl: string
  readonly checkedAt: string
  readonly confidence: number
}

function statusFor(observation: ParsedObservation): ScheduleProposal["status"] | undefined {
  switch (observation.state) {
    case "accepted":
      return "confirmed"
    case "timezone-review-needed":
      return "timezone-review-needed"
    case "review-needed":
      return undefined
  }
}

function uniqueObservations(
  observations: readonly ParsedObservation[],
): readonly ParsedObservation[] {
  const seen = new Set<string>()
  return observations.filter((observation) => {
    const key = `${observation.kind}|${observation.normalizedValue ?? ""}|${observation.rawValue}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function displayCalendarDate(value: string): string | undefined {
  const match = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/.exec(value)
  if (!match?.[1] || !match[2] || !match[3]) return undefined
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
}

export function buildScheduleProposals(
  catalog: Catalog,
  pages: readonly SourcePageObservations[],
): readonly ScheduleProposal[] {
  const editions = new Map(catalog.editions.map((edition) => [edition.id, edition]))
  const proposals: ScheduleProposal[] = []
  for (const page of pages) {
    const edition = editions.get(page.editionId)
    if (!edition) continue
    const observations = uniqueObservations(page.observations)
    const kinds = new Set(observations.map((observation) => observation.kind))
    for (const kind of kinds) {
      const candidates = observations.filter((observation) => observation.kind === kind)
      const deadline = edition.deadlines.filter((value) => value.kind === kind)
      if (candidates.length !== 1 || deadline.length !== 1) continue
      const [candidate, current] = [candidates[0], deadline[0]]
      if (
        !candidate?.normalizedValue ||
        !candidate.displayDate ||
        !candidate.sourceTimezone ||
        !current
      )
        continue
      const candidateDate = displayCalendarDate(candidate.displayDate)
      const currentDate = displayCalendarDate(current.displayDate)
      const checkedDate = page.checkedAt.slice(0, 10)
      if (
        !candidateDate ||
        candidateDate < checkedDate ||
        (edition.conferenceStart !== null && candidateDate > edition.conferenceStart) ||
        candidateDate === currentDate
      )
        continue
      const status = statusFor(candidate)
      if (!status || current.dueAtUtc === candidate.normalizedValue) continue
      proposals.push({
        editionId: edition.id,
        acronym: edition.acronym,
        officialUrl: edition.officialUrl,
        deadlineId: current.id,
        kind: current.kind,
        beforeDueAtUtc: current.dueAtUtc,
        afterDueAtUtc: candidate.normalizedValue,
        displayDate: candidate.displayDate,
        timezone: candidate.sourceTimezone,
        status,
        rawValue: candidate.rawValue,
        locator: candidate.locator,
        sourceUrl: page.finalUrl || page.sourceUrl,
        checkedAt: page.checkedAt,
        confidence: candidate.confidence,
      })
    }
  }
  const byDeadline = new Map<string, ScheduleProposal[]>()
  for (const proposal of proposals) {
    const key = `${proposal.editionId}:${proposal.deadlineId}`
    const candidates = byDeadline.get(key) ?? []
    candidates.push(proposal)
    byDeadline.set(key, candidates)
  }

  const unambiguous = [...byDeadline.values()].flatMap((candidates) => {
    const observedDueDates = new Set(candidates.map((candidate) => candidate.afterDueAtUtc))
    if (observedDueDates.size !== 1) return []
    return [
      [...candidates].sort(
        (left, right) =>
          right.confidence - left.confidence ||
          right.checkedAt.localeCompare(left.checkedAt) ||
          left.sourceUrl.localeCompare(right.sourceUrl),
      )[0],
    ]
  })

  return unambiguous
    .filter((proposal): proposal is ScheduleProposal => proposal !== undefined)
    .sort((left, right) =>
      `${left.editionId}:${left.deadlineId}`.localeCompare(
        `${right.editionId}:${right.deadlineId}`,
      ),
    )
}

function updateDeadline(deadline: Deadline, proposal: ScheduleProposal): Deadline {
  if (deadline.id !== proposal.deadlineId) return deadline
  return {
    ...deadline,
    dueAtUtc: proposal.afterDueAtUtc,
    displayDate: proposal.displayDate,
    timezone: proposal.timezone,
    status: proposal.status,
  }
}

function proposalKey(proposal: ScheduleProposal): string {
  return `${proposal.editionId}:${proposal.deadlineId}:${proposal.checkedAt.slice(0, 10)}`
}

function createEvidence(proposal: ScheduleProposal): Evidence {
  return {
    id: `auto-${proposalKey(proposal)}`,
    editionId: proposal.editionId,
    deadlineId: proposal.deadlineId,
    sourceTitle: `${proposal.acronym} official page · automated extraction`,
    sourceUrl: proposal.sourceUrl,
    checkedAt: proposal.checkedAt,
    rawValue: proposal.rawValue,
    locator: proposal.locator,
    confidence: proposal.confidence,
  }
}

function createHistory(proposal: ScheduleProposal): History {
  return {
    id: `auto-${proposalKey(proposal)}`,
    editionId: proposal.editionId,
    changedAt: proposal.checkedAt,
    summary: "공식 페이지 자동 추출 날짜 변경 제안",
    before: proposal.beforeDueAtUtc,
    after: proposal.afterDueAtUtc,
    state: "pending",
  }
}

export function applyScheduleProposals(
  catalog: Catalog,
  proposals: readonly ScheduleProposal[],
): Catalog {
  const proposalByDeadline = new Map(proposals.map((proposal) => [proposal.deadlineId, proposal]))
  const editions = catalog.editions.map((edition) => ({
    ...edition,
    deadlines: edition.deadlines.map((deadline) => {
      const proposal = proposalByDeadline.get(deadline.id)
      return proposal ? updateDeadline(deadline, proposal) : deadline
    }),
  }))
  const existingEvidence = new Set(catalog.evidence.map((evidence) => evidence.id))
  const existingHistory = new Set(catalog.history.map((history) => history.id))
  const evidence = [...catalog.evidence]
  const history = [...catalog.history]
  for (const proposal of proposals) {
    const nextEvidence = createEvidence(proposal)
    if (!existingEvidence.has(nextEvidence.id)) evidence.push(nextEvidence)
    const nextHistory = createHistory(proposal)
    if (!existingHistory.has(nextHistory.id)) history.push(nextHistory)
  }
  return { editions, evidence, history }
}

export function formatScheduleProposalReport(proposals: readonly ScheduleProposal[]): string {
  const lines = ["# Automated schedule update review", ""]
  if (proposals.length === 0)
    return [...lines, "No unambiguous official date changes detected."].join("\n")
  lines.push(
    `${proposals.length} date change(s) were extracted from official pages.`,
    "",
    "These updates are applied to the catalog in this pull request. Review the source URL and merge only when the extracted deadline is correct.",
    "",
  )
  for (const proposal of proposals) {
    lines.push(
      `## ${proposal.acronym} · ${proposal.kind}`,
      "",
      `Official URL: ${proposal.officialUrl}`,
      `Source URL: ${proposal.sourceUrl}`,
      `Before: ${proposal.beforeDueAtUtc}`,
      `After: ${proposal.afterDueAtUtc} (${proposal.displayDate}, ${proposal.timezone})`,
      `Raw value: ${proposal.rawValue}`,
      `Confidence: ${proposal.confidence}`,
      "",
    )
  }
  return lines.join("\n")
}
