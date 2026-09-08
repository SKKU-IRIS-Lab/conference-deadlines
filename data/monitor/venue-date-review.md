# Venue and event-date audit — 2026-09-08

Checked all 112 catalog entries for missing location or event dates. Sixteen
entries needed review; ten were corrected using official event pages. This was
not an external revalidation of the other 96 entries. The expanded placeholder
check additionally flagged MLSys 2027 (location `TBA`), leaving seven entries for review.

## Officially verified corrections

| Editions | Location | Event dates | Source |
| --- | --- | --- | --- |
| ICCE-Asia 2026 | SAINT JOHN’S Hotel, Gangwon-do, South Korea | 2026-10-28–30 | https://icce-asia2026.org/2026/ |
| VLSI 2027 | Rihga Royal Hotel Kyoto, Japan | 2027-06-20–24 | https://www.vlsisymposium.org/ |
| KDD 2027, first and second cycles | San Jose McEnery Convention Center, San Jose, USA | 2027-08-01–05 | https://kdd2027.kdd.org/ |
| SenSys 2027, first and second cycles | Boulder, Colorado, USA (replaces New York) | 2027-05-17–20 | https://sensys.acm.org/2027/ |
| CVPR 2027 | Seattle, Washington, USA | 2027-06-20–25 | https://cvpr.thecvf.com/ |
| WACV 2026 | JW Marriott Starr Pass, Tucson, Arizona, USA | 2026-03-06–10 | https://wacv.thecvf.com/Conferences/2026 |

## Still needs verification — do not infer values

- ESSCIRC 2027: registered source could not be verified during this audit.
- PCS 2026: registered source could not be verified during this audit.
- COLING 2026: registered domain displayed a parking/sale page.
- ISCA 2027: registered root displayed the 2026 edition, not verified 2027 details.
- ICCV 2026: registered root displayed ICCV 2025; edition identity needs review.
- ACM MM Asia 2026: registered source is ACM MM, not an Asia-specific source.
- MLSys 2027: location is `TBA`; official venue still needs verification.

## Recurrence safeguards

Every monitored edition is checked for missing location/start/end even if its
source fingerprint is unchanged or fetching fails. These findings appear in the
normal review report and prevent automatic merging for that run. Weekly scans
cover the whole catalog; daily scans cover imminent-deadline editions only.

If an HTML title contains event years but not the catalog edition year, deadline
proposals from that edition are withheld. Titles without years, parked domains,
event identity mismatches, and incorrect but populated locations are not reliably
identified by this conservative check. Source changes still require review.
Venue/date extraction is not automated: verified corrections require review.
Refreshing a managed request with newly available deadlines now preserves its
existing venue, event dates, identity, and other manually curated metadata.
