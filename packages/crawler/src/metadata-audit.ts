import type { Catalog } from "@conf/contracts"

export interface MetadataPage {
  readonly editionId: string
  readonly sourceUrl: string
  readonly html?: string
}

export interface MetadataFinding {
  readonly editionId: string
  readonly sourceUrl: string
  readonly kind: "missing-location" | "missing-dates" | "source-year-mismatch"
}

export function auditConferenceMetadata(
  catalog: Catalog,
  pages: readonly MetadataPage[],
): MetadataFinding[] {
  const findings: MetadataFinding[] = []
  for (const edition of catalog.editions) {
    const common = { editionId: edition.id, sourceUrl: edition.officialUrl }
    if (
      !edition.location.trim() ||
      /미정|발표 대기|검수|\b(?:tba|tbd|unknown)\b/i.test(edition.location)
    )
      findings.push({ ...common, kind: "missing-location" })
    if (!edition.conferenceStart || !edition.conferenceEnd)
      findings.push({ ...common, kind: "missing-dates" })
    for (const page of pages.filter((page) => page.editionId === edition.id)) {
      // Limit year evidence to the title: footer/copyright years are not event years.
      const title = page.html?.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
      const years: readonly string[] = title.match(/\b20\d{2}\b/g) ?? []
      if (years.length > 0 && !years.includes(String(edition.year)))
        findings.push({ ...common, sourceUrl: page.sourceUrl, kind: "source-year-mismatch" })
    }
  }
  return findings
}
