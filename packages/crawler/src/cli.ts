import { catalogSchema } from "@conf/contracts"
import { fetchConferenceRequestSource, syncConferenceRequests } from "./conference-request-sync"
import { crawlFixture, crawlLive } from "./crawl"
import { readManagementConferenceRequests } from "./management-requests"
import { auditFutureEditionSchedules, formatScheduleAuditReport } from "./schedule-audit"
import {
  isAutoMergeEligible,
  runSourceMonitor,
  writeMonitorReview,
  writeScheduleUpdates,
} from "./source-monitor"

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args[0] === "sync-requests") {
    const apiUrl = process.env.MANAGEMENT_API_URL?.trim()
    const syncToken = process.env.MANAGEMENT_SYNC_TOKEN?.trim()
    if (!apiUrl || !syncToken)
      throw new Error("MANAGEMENT_API_URL과 MANAGEMENT_SYNC_TOKEN이 필요합니다.")
    const catalogPath = "data/seed/catalog-state.json"
    const catalog = catalogSchema.parse(await Bun.file(catalogPath).json())
    const requests = await readManagementConferenceRequests(apiUrl, syncToken)
    const run = await syncConferenceRequests(catalog, requests, {
      now: new Date(),
      fetchSource: fetchConferenceRequestSource,
    })
    if (run.imported.length > 0)
      await Bun.write(catalogPath, `${JSON.stringify(run.catalog, null, 2)}\n`)
    await Bun.write("data/monitor/conference-request-review.md", `${run.report}\n`)
    console.log(
      JSON.stringify(
        {
          requestCount: requests.length,
          importedCount: run.imported.length,
          skippedCount: run.skipped.length,
          failedCount: run.failed.length,
        },
        null,
      ),
    )
    return
  }
  if (args[0] === "monitor") {
    const withinDaysIndex = args.indexOf("--deadline-within-days")
    const withinDaysValue = withinDaysIndex >= 0 ? Number(args[withinDaysIndex + 1]) : undefined
    if (
      withinDaysIndex >= 0 &&
      (withinDaysValue === undefined ||
        !Number.isInteger(withinDaysValue) ||
        withinDaysValue < 1 ||
        withinDaysValue > 90)
    )
      throw new Error("--deadline-within-days는 1부터 90 사이의 정수여야 합니다.")
    const catalog = catalogSchema.parse(await Bun.file("data/seed/catalog-state.json").json())
    const run = await runSourceMonitor(
      "data/seed/catalog-state.json",
      "data/monitor/source-state.json",
      withinDaysValue === undefined ? {} : { deadlineWithinDays: withinDaysValue },
    )
    // Future-edition audits are meaningful for the weekly full scan. Running
    // them during every narrow daily scan would reopen the same review PR.
    const findings = withinDaysValue === undefined ? auditFutureEditionSchedules(catalog) : []
    if (
      run.changes.length > 0 ||
      findings.length > 0 ||
      run.scheduleProposals.length > 0 ||
      run.metadataFindings?.length
    ) {
      await writeMonitorReview(
        "data/monitor/source-state.json",
        "data/monitor/monthly-review.md",
        run,
      )
      await writeScheduleUpdates("data/seed/catalog-state.json", catalog, run)
      await Bun.write(
        "data/monitor/future-edition-safety-review.md",
        `${formatScheduleAuditReport(findings)}\n`,
      )
    }
    console.log(
      JSON.stringify(
        {
          sourceCount: run.sources.length,
          changeCount: run.changes.length,
          scheduleProposalCount: run.scheduleProposals.length,
          metadataFindingCount: run.metadataFindings?.length ?? 0,
          autoMergeEligible: isAutoMergeEligible(run),
          staleFutureScheduleCount: findings.length,
        },
        null,
      ),
    )
    return
  }
  if (args[0] !== "crawl")
    throw new Error(
      "사용법: crawl --source <registered-id> [--live] | monitor [--deadline-within-days 1..90] | sync-requests",
    )
  const sourceIndex = args.indexOf("--source")
  const sourceId = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined
  if (!sourceId) throw new Error("--source에는 등록된 소스 ID가 필요합니다.")
  const result = args.includes("--live") ? await crawlLive(sourceId) : await crawlFixture(sourceId)
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.main) {
  await main().catch((reason: unknown) => {
    console.error(
      reason instanceof Error ? reason.message : "수집 중 알 수 없는 오류가 발생했습니다.",
    )
    process.exitCode = 1
  })
}
