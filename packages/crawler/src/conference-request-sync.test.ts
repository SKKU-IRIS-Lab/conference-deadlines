import { describe, expect, test } from "bun:test"
import type { Catalog } from "@conf/contracts"
import {
  buildConferenceRequestEdition,
  type ConferenceRequestSource,
  syncConferenceRequests,
} from "./conference-request-sync"
import type { ConferenceRequestRecord } from "./management-requests"

const catalog: Catalog = {
  editions: [],
  evidence: [],
  history: [],
}

const request: ConferenceRequestRecord = {
  id: "request-123",
  name: "ExampleConf",
  officialUrl: "https://example.org/cfp",
  category: "AI",
  note: "Important Dates 확인",
  status: "approved",
  submittedAt: "2026-09-02T00:00:00Z",
}

const source: ConferenceRequestSource = {
  finalUrl: "https://example.org/cfp",
  checkedAt: "2026-09-02T00:01:00Z",
  observations: [
    {
      kind: "paper_submission",
      rawValue: "May 15, 2027 AoE",
      normalizedValue: "2027-05-16T11:59:59Z",
      displayDate: "2027. 5. 15",
      sourceTimezone: "AoE (UTC-12)",
      locator: "#important-dates tr",
      confidence: 0.98,
      state: "accepted",
    },
  ],
}

describe("conference request synchronization", () => {
  test("builds a reviewable edition with extracted deadlines", () => {
    const result = buildConferenceRequestEdition(request, source, new Date("2026-09-02T00:00:00Z"))

    expect(result.edition).toMatchObject({
      id: "exampleconf-request-123",
      acronym: "ExampleConf 2027",
      year: 2027,
      categories: ["AI"],
      status: "review-needed",
      registrySource: "curated",
      registryRecordId: "request-123",
    })
    expect(result.edition.deadlines).toMatchObject([
      {
        id: "exampleconf-request-123-paper_submission",
        kind: "paper_submission",
        displayDate: "2027. 5. 15",
        status: "confirmed",
      },
    ])
    expect(result.evidence).toHaveLength(1)
  })

  test("skips a request whose official URL is already tracked", async () => {
    const tracked: Catalog = {
      ...catalog,
      editions: [
        {
          ...buildConferenceRequestEdition(request, source, new Date("2026-09-02T00:00:00Z"))
            .edition,
          officialUrl: "https://example.org/",
        },
      ],
    }

    const result = await syncConferenceRequests(tracked, [request], {
      now: new Date("2026-09-02T00:00:00Z"),
      fetchSource: async () => source,
    })

    expect(result.catalog.editions).toHaveLength(1)
    expect(result.skipped).toEqual(["request-123:already-tracked"])
    expect(result.imported).toEqual([])
  })

  test("refreshes a tracked dates-pending request when official dates become available", async () => {
    const pendingEdition = buildConferenceRequestEdition(
      request,
      { ...source, observations: [] },
      new Date("2026-09-02T00:00:00Z"),
    ).edition
    const tracked: Catalog = {
      ...catalog,
      editions: [
        {
          ...pendingEdition,
          location: "Boulder, USA",
          dateRange: "2027. 5. 17 - 5. 20",
          conferenceStart: "2027-05-17",
          conferenceEnd: "2027-05-20",
        },
      ],
    }

    const result = await syncConferenceRequests(tracked, [request], {
      now: new Date("2026-09-02T00:00:00Z"),
      fetchSource: async () => source,
    })

    expect(result.catalog.editions[0]?.deadlines).toHaveLength(1)
    expect(result.catalog.editions[0]?.location).toBe("Boulder, USA")
    expect(result.catalog.editions[0]?.conferenceStart).toBe("2027-05-17")
    expect(result.catalog.editions[0]?.conferenceEnd).toBe("2027-05-20")
    expect(result.catalog.editions[0]?.dateRange).toBe("2027. 5. 17 - 5. 20")
    expect(result.catalog.evidence).toHaveLength(1)
    expect(result.imported).toEqual(["request-123"])
    expect(result.skipped).toEqual([])
  })

  test("does not publish deadlines that elapsed before the sync", () => {
    const result = buildConferenceRequestEdition(
      request,
      {
        ...source,
        observations: [
          {
            kind: "paper_submission",
            rawValue: "May 15, 2026 AoE",
            normalizedValue: "2026-05-16T11:59:59Z",
            displayDate: "2026. 5. 15",
            sourceTimezone: "AoE (UTC-12)",
            locator: "#important-dates tr",
            confidence: 0.98,
            state: "accepted",
          },
        ],
      },
      new Date("2026-09-02T00:00:00Z"),
    )

    expect(result.edition.deadlines).toEqual([])
    expect(result.edition.status).toBe("dates-pending")
  })
})
