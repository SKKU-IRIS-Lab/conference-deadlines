import {
  conferenceRequestInputSchema,
  editionQuerySchema,
  managementRequestKindSchema,
  managementRequestStatusSchema,
  managementReviewInputSchema,
  scheduleOverrideInputSchema,
} from "@conf/contracts"
import { findEdition, getCatalog } from "@conf/storage"
import { Hono } from "hono"
import { cors } from "hono/cors"
import {
  authenticateLocalAdmin,
  deleteSession,
  getSession,
  type ManagementAuthConfig,
  readCookie,
  readManagementAuthConfig,
  sessionCookie,
} from "./admin-auth"
import { type ChatDependencies, registerChat } from "./chat"
import { dispatchWeeklySourceMonitor, readGitHubAppConfig } from "./github-app"
import { ManagementStore } from "./management-store"

function problem(status: number, slug: string, title: string, detail: string) {
  return {
    type: `https://conf.local/problems/${slug}`,
    title,
    status,
    detail,
  }
}

export interface AppOptions {
  readonly managementStore?: ManagementStore
  readonly managementAuth?: ManagementAuthConfig
  readonly managementSyncToken?: string
  readonly chat?: ChatDependencies
}

function defaultManagementStore(): ManagementStore {
  return new ManagementStore(Bun.env.MANAGEMENT_DB_PATH ?? ".local/runtime/management.sqlite")
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono()
  const failedLogins = new Map<string, { attempts: number; retryAfter: number }>()
  const managementStore = options.managementStore ?? defaultManagementStore()
  const managementAuth = options.managementAuth ?? readManagementAuthConfig()
  const managementSyncToken = options.managementSyncToken ?? Bun.env.MANAGEMENT_SYNC_TOKEN
  const githubApp = readGitHubAppConfig()
  if (managementAuth) {
    managementStore.bootstrapAdmin(
      managementAuth.initialAdminUsername,
      managementAuth.initialAdminPasswordHash,
    )
    app.use(
      "/api/v1/admin/*",
      cors({
        origin: managementAuth.publicWebOrigin,
        credentials: true,
        allowHeaders: ["content-type"],
        allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
      }),
    )
  }
  app.get("/api/v1/health", (context) => context.json({ status: "ok" }))
  registerChat(
    app,
    async (request) =>
      managementAuth
        ? getSession(managementStore, readCookie(request, "conference_admin_session"))
        : undefined,
    managementAuth?.publicWebOrigin,
    options.chat,
  )

  app.get("/api/v1/catalog/meta", (context) => {
    const lastCheckedAt = getCatalog().evidence.reduce<string | null>(
      (latest, item) => (!latest || item.checkedAt > latest ? item.checkedAt : latest),
      null,
    )
    return context.json({ lastCheckedAt })
  })

  app.get("/api/v1/editions", (context) => {
    const parsed = editionQuerySchema.safeParse(context.req.query())
    if (!parsed.success) {
      return context.json(
        problem(400, "invalid-query", "잘못된 요청", "검색 조건을 확인해 주세요."),
        400,
      )
    }
    const query = parsed.data.q?.toLocaleLowerCase("ko")
    const category = parsed.data.category?.toLocaleLowerCase("ko")
    const filtered = getCatalog().editions.filter((edition) => {
      const matchesQuery =
        !query || `${edition.acronym} ${edition.name}`.toLocaleLowerCase("ko").includes(query)
      const matchesCategory =
        !category || edition.categories.some((value) => value.toLocaleLowerCase("ko") === category)
      return matchesQuery && matchesCategory
    })
    return context.json({ items: filtered.slice(0, parsed.data.limit ?? 50) })
  })

  app.get("/api/v1/editions/:editionId", (context) => {
    const edition = findEdition(context.req.param("editionId"))
    if (!edition)
      return context.json(
        problem(404, "not-found", "찾을 수 없음", "학회가 존재하지 않습니다."),
        404,
      )
    return context.json(edition)
  })

  app.get("/api/v1/editions/:editionId/evidence", (context) => {
    const editionId = context.req.param("editionId")
    if (!findEdition(editionId)) {
      return context.json(
        problem(404, "not-found", "찾을 수 없음", "학회가 존재하지 않습니다."),
        404,
      )
    }
    return context.json({
      items: getCatalog().evidence.filter((item) => item.editionId === editionId),
    })
  })

  app.get("/api/v1/editions/:editionId/history", (context) => {
    const editionId = context.req.param("editionId")
    if (!findEdition(editionId)) {
      return context.json(
        problem(404, "not-found", "찾을 수 없음", "학회가 존재하지 않습니다."),
        404,
      )
    }
    return context.json({
      items: getCatalog().history.filter((item) => item.editionId === editionId),
    })
  })

  app.get("/api/v1/admin/session", async (context) => {
    if (!managementAuth)
      return context.json(
        problem(
          503,
          "management-unconfigured",
          "관리 서버 미설정",
          "관리자 로그인이 아직 설정되지 않았습니다.",
        ),
        503,
      )
    const session = await getSession(
      managementStore,
      readCookie(context.req.raw, "conference_admin_session"),
    )
    if (!session)
      return context.json(
        problem(401, "not-authenticated", "로그인 필요", "관리자 로그인이 필요합니다."),
        401,
      )
    return context.json({ username: session.username, expiresAt: session.expiresAt })
  })

  app.post("/api/v1/admin/auth/login", async (context) => {
    if (!managementAuth)
      return context.json(
        problem(
          503,
          "management-unconfigured",
          "관리 서버 미설정",
          "관리자 로그인이 아직 설정되지 않았습니다.",
        ),
        503,
      )
    const body = await context.req.json().catch(() => undefined)
    const username = typeof body?.username === "string" ? body.username.trim() : ""
    const password = typeof body?.password === "string" ? body.password : ""
    const address = context.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? "unknown"
    const attemptKey = `${address}:${username.toLocaleLowerCase("en-US")}`
    const savedFailure = failedLogins.get(attemptKey)
    if (savedFailure && savedFailure.retryAfter > Date.now())
      return context.json(
        problem(429, "login-rate-limited", "로그인 잠시 제한", "잠시 후 다시 시도해 주세요."),
        429,
      )
    if (savedFailure?.retryAfter) failedLogins.delete(attemptKey)
    const previousFailure = savedFailure?.retryAfter ? undefined : savedFailure
    if (!username || !password)
      return context.json(
        problem(400, "invalid-login", "로그인 입력 오류", "아이디와 비밀번호를 입력해 주세요."),
        400,
      )
    const result = await authenticateLocalAdmin(managementStore, username, password)
    if (!result) {
      const attempts = (previousFailure?.attempts ?? 0) + 1
      failedLogins.set(attemptKey, {
        attempts,
        retryAfter: attempts >= 5 ? Date.now() + 15 * 60_000 : 0,
      })
      return context.json(
        problem(401, "login-failed", "로그인 실패", "아이디 또는 비밀번호가 올바르지 않습니다."),
        401,
      )
    }
    failedLogins.delete(attemptKey)
    context.header("set-cookie", sessionCookie(result.sessionToken, managementAuth))
    return context.json({ username: result.session.username, expiresAt: result.session.expiresAt })
  })

  app.post("/api/v1/admin/auth/logout", async (context) => {
    if (!managementAuth)
      return context.json(
        problem(
          503,
          "management-unconfigured",
          "관리 서버 미설정",
          "관리자 로그인이 아직 설정되지 않았습니다.",
        ),
        503,
      )
    await deleteSession(managementStore, readCookie(context.req.raw, "conference_admin_session"))
    context.header("set-cookie", sessionCookie("", managementAuth, 0))
    return context.body(null, 204)
  })

  app.post("/api/v1/admin/actions/weekly-source-monitor", async (context) => {
    const session = await authenticatedEmail(context)
    if (!session)
      return context.json(
        problem(401, "not-authenticated", "로그인 필요", "관리자 로그인이 필요합니다."),
        401,
      )
    if (!githubApp)
      return context.json(
        problem(
          503,
          "github-app-unconfigured",
          "GitHub App 미설정",
          "검수 PR 생성 권한이 설정되지 않았습니다.",
        ),
        503,
      )
    try {
      await dispatchWeeklySourceMonitor(githubApp)
      return context.json({ status: "started" }, 202)
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "GitHub 검수 workflow를 시작하지 못했습니다."
      return context.json(problem(502, "workflow-dispatch-failed", "검수 시작 실패", detail), 502)
    }
  })

  async function authenticatedEmail(context: { readonly req: { readonly raw: Request } }) {
    if (!managementAuth) return undefined
    return getSession(managementStore, readCookie(context.req.raw, "conference_admin_session"))
  }

  app.get("/api/v1/admin/conference-requests", async (context) => {
    const session = await authenticatedEmail(context)
    if (!session)
      return context.json(
        problem(401, "not-authenticated", "로그인 필요", "관리자 로그인이 필요합니다."),
        401,
      )
    const status = context.req.query("status")
    const parsedStatus =
      status === undefined ? undefined : managementRequestStatusSchema.safeParse(status)
    if (parsedStatus && !parsedStatus.success)
      return context.json(
        problem(400, "invalid-status", "잘못된 상태", "요청 상태를 확인해 주세요."),
        400,
      )
    return context.json({ items: managementStore.listConferenceRequests(parsedStatus?.data) })
  })

  app.post("/api/v1/admin/conference-requests", async (context) => {
    const session = await authenticatedEmail(context)
    if (!session)
      return context.json(
        problem(401, "not-authenticated", "로그인 필요", "관리자 로그인이 필요합니다."),
        401,
      )
    const parsed = conferenceRequestInputSchema.safeParse(
      await context.req.json().catch(() => undefined),
    )
    if (!parsed.success)
      return context.json(
        problem(400, "invalid-request", "입력 오류", "학회 추가 요청을 확인해 주세요."),
        400,
      )
    return context.json(managementStore.createConferenceRequest(parsed.data, session.username), 201)
  })

  app.get("/api/v1/admin/schedule-overrides", async (context) => {
    const session = await authenticatedEmail(context)
    if (!session)
      return context.json(
        problem(401, "not-authenticated", "로그인 필요", "관리자 로그인이 필요합니다."),
        401,
      )
    const status = context.req.query("status")
    const parsedStatus =
      status === undefined ? undefined : managementRequestStatusSchema.safeParse(status)
    if (parsedStatus && !parsedStatus.success)
      return context.json(
        problem(400, "invalid-status", "잘못된 상태", "요청 상태를 확인해 주세요."),
        400,
      )
    return context.json({ items: managementStore.listScheduleOverrides(parsedStatus?.data) })
  })

  app.post("/api/v1/admin/schedule-overrides", async (context) => {
    const session = await authenticatedEmail(context)
    if (!session)
      return context.json(
        problem(401, "not-authenticated", "로그인 필요", "관리자 로그인이 필요합니다."),
        401,
      )
    const parsed = scheduleOverrideInputSchema.safeParse(
      await context.req.json().catch(() => undefined),
    )
    if (!parsed.success)
      return context.json(
        problem(400, "invalid-request", "입력 오류", "일정 수정 요청을 확인해 주세요."),
        400,
      )
    return context.json(managementStore.createScheduleOverride(parsed.data, session.username), 201)
  })

  app.patch("/api/v1/admin/requests/:kind/:id/review", async (context) => {
    const session = await authenticatedEmail(context)
    if (!session)
      return context.json(
        problem(401, "not-authenticated", "로그인 필요", "관리자 로그인이 필요합니다."),
        401,
      )
    const kind = managementRequestKindSchema.safeParse(context.req.param("kind"))
    const review = managementReviewInputSchema.safeParse(
      await context.req.json().catch(() => undefined),
    )
    if (!kind.success || !review.success)
      return context.json(
        problem(400, "invalid-review", "검수 입력 오류", "승인 또는 반려 정보를 확인해 주세요."),
        400,
      )
    const updated = managementStore.reviewRequest(
      kind.data,
      context.req.param("id"),
      review.data,
      session.username,
    )
    if (!updated)
      return context.json(
        problem(
          404,
          "request-not-found",
          "요청을 찾을 수 없음",
          "이미 처리되었거나 존재하지 않는 요청입니다.",
        ),
        404,
      )
    return context.body(null, 204)
  })

  app.get("/api/v1/internal/conference-requests", (context) => {
    const authorized =
      managementSyncToken && context.req.header("authorization") === `Bearer ${managementSyncToken}`
    if (!authorized)
      return context.json(
        problem(401, "sync-unauthorized", "동기화 권한 없음", "서버 동기화 토큰이 필요합니다."),
        401,
      )
    return context.json({ items: managementStore.listConferenceRequests("approved") })
  })

  return app
}
