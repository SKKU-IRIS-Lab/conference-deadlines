import { expect, test } from "bun:test"
import { catalogSchema } from "@conf/contracts"
import { auditConferenceMetadata } from "./metadata-audit"

const catalog = catalogSchema.parse(await Bun.file("data/seed/catalog-state.json").json())
const base = catalog.editions[0]
if (!base) throw new Error("catalog fixture must contain an edition")

test("missing venue and dates remain reviewable without source changes or a successful fetch", () => {
  const findings = auditConferenceMetadata(
    {
      ...catalog,
      editions: [
        { ...base, location: "공식 발표 대기", conferenceStart: null, conferenceEnd: null },
      ],
    },
    [],
  )
  expect(findings.map((finding) => finding.kind)).toEqual(["missing-location", "missing-dates"])
})

test("a different event year in the page title blocks using that source", () => {
  const findings = auditConferenceMetadata({ ...catalog, editions: [{ ...base, year: 2026 }] }, [
    {
      editionId: base.id,
      sourceUrl: base.officialUrl,
      html: "<title>WACV 2027</title><footer>Copyright 2026</footer>",
    },
  ])
  expect(findings.some((finding) => finding.kind === "source-year-mismatch")).toBe(true)
})

test("footer years do not cause a mismatch for a matching event title", () => {
  const findings = auditConferenceMetadata({ ...catalog, editions: [{ ...base, year: 2026 }] }, [
    {
      editionId: base.id,
      sourceUrl: base.officialUrl,
      html: "<title>Conference 2026</title><footer>Copyright 2027</footer>",
    },
  ])
  expect(findings.some((finding) => finding.kind === "source-year-mismatch")).toBe(false)
})
