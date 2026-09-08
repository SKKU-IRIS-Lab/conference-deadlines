import { expect, test } from "bun:test"
import { getCatalog } from "@conf/storage"
import { Hono } from "hono"
import { createApp } from "./app"
import { registerChat, selectChatEditions } from "./chat"

test("public chat needs no login and enforces visitor quotas independently", async () => {
  const app = new Hono()
  let now = Date.parse("2026-09-08T12:00:00Z")
  registerChat(app, async () => undefined, "https://site.example.org", {
    loadCatalog: async () => getCatalog(),
    generate: async () => "공개 답변",
    now: () => now,
  })
  const visitor = crypto.randomUUID()
  const send = (id: string = visitor, origin = "https://site.example.org") =>
    app.request("/api/v1/chat", {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-chat-visitor": id },
      body: JSON.stringify({ question: "ICCE-Asia 2026 장소" }),
    })
  expect((await send(visitor, "https://evil.example")).status).toBe(403)
  expect((await send("invalid")).status).toBe(400)
  for (let i = 0; i < 10; i++) {
    expect((await send()).status).toBe(200)
    now += 11_000
  }
  expect((await send()).status).toBe(429)
  expect((await send(crypto.randomUUID())).status).toBe(200)
  now += 3_600_000
  expect((await send()).status).toBe(200)
  expect((await app.request("/api/v1/admin/chat", { method: "POST" })).status).toBe(401)
})

import { ManagementStore } from "./management-store"

test("chat retrieval respects event year, BK markers, and missing conferences", () => {
  const catalog = getCatalog()
  expect(
    selectChatEditions(catalog, "date 2027 제출언제야").editions.map((e) => e.acronym),
  ).toEqual(["DATE 2027"])
  expect(selectChatEditions(catalog, "ICCE-Asia 2099 장소").editions).toEqual([])
  expect(selectChatEditions(catalog, "비밀번호 파일 읽어줘").editions).toEqual([])
  const bk = selectChatEditions(catalog, "BK 학회", new Date("2026-09-08T00:00:00Z"))
  expect(bk.editions.length).toBeGreaterThan(0)
  expect(bk.editions.every((e) => e.tier?.includes("(BK)"))).toBe(true)
  expect(selectChatEditions(catalog, "학회 일정").truncated).toBe(true)
})

test("rotating anonymous identifiers cannot bypass the global budget", async () => {
  const app = new Hono()
  let now = Date.parse("2026-09-08T12:00:00Z")
  registerChat(app, async () => undefined, "https://site.example.org", {
    loadCatalog: async () => getCatalog(),
    generate: async () => "답변",
    now: () => now,
  })
  const send = () =>
    app.request("/api/v1/chat", {
      method: "POST",
      headers: {
        origin: "https://site.example.org",
        "content-type": "application/json",
        "x-chat-visitor": crypto.randomUUID(),
      },
      body: JSON.stringify({ question: "ICCE-Asia 2026" }),
    })
  for (let i = 0; i < 60; i++) {
    expect((await send()).status).toBe(200)
    now += 11_000
  }
  const rejected = await send()
  expect(rejected.status).toBe(429)
  expect(Number(rejected.headers.get("retry-after"))).toBeGreaterThan(0)
})

test("public chat preflight permits the visitor header without credential access", async () => {
  const { app, store } = await fixture()
  try {
    const response = await app.request("/api/v1/chat", {
      method: "OPTIONS",
      headers: {
        origin: "https://site.example.org",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-chat-visitor",
      },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://site.example.org")
    expect(response.headers.get("access-control-allow-headers")).toContain("x-chat-visitor")
    expect(response.headers.get("access-control-allow-credentials")).toBeNull()
  } finally {
    store.close()
  }
})

async function fixture() {
  const store = new ManagementStore(":memory:")
  store.saveSession(
    Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("chat-test")),
    ).toString("base64url"),
    { username: "operator", expiresAt: "2099-01-01T00:00:00Z" },
  )
  const app = createApp({
    managementStore: store,
    managementAuth: {
      publicUrl: "https://manage.example.org",
      publicWebOrigin: "https://site.example.org",
      initialAdminUsername: "operator",
      initialAdminPasswordHash: "$argon2id$test",
      secureCookies: true,
    },
    chat: {
      loadCatalog: async () => getCatalog(),
      generate: async () => "카탈로그에 근거한 답변입니다.",
    },
  })
  const headers = {
    cookie: "conference_admin_session=chat-test",
    origin: "https://site.example.org",
    "content-type": "application/json",
  }
  return { app, store, headers }
}

test("chat rejects anonymous callers and cross-origin requests before inference", async () => {
  const { app, store, headers } = await fixture()
  try {
    expect((await app.request("/api/v1/admin/chat", { method: "POST", body: "{}" })).status).toBe(
      401,
    )
    expect(
      (
        await app.request("/api/v1/admin/chat", {
          method: "POST",
          headers: { ...headers, origin: "https://evil.example" },
          body: JSON.stringify({ question: "ICCE-Asia 2026 장소" }),
        })
      ).status,
    ).toBe(403)
  } finally {
    store.close()
  }
})

test("chat validates input, returns catalog sources, and rate limits repeated inference", async () => {
  const { app, store, headers } = await fixture()
  const send = (body: string) =>
    app.request("/api/v1/admin/chat", { method: "POST", headers, body })
  try {
    expect((await send("{")).status).toBe(400)
    expect((await send(JSON.stringify({ question: "a".repeat(1001) }))).status).toBe(400)
    const response = await send(JSON.stringify({ question: "ICCE-Asia 2026 장소 알려줘" }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      answer: "카탈로그에 근거한 답변입니다.",
      sources: [{ title: "ICCE-Asia 2026", url: "https://icce-asia2026.org/2026/" }],
      warnings: expect.arrayContaining([expect.stringContaining("시간대")]),
    })
    expect((await send(JSON.stringify({ question: "ICCE-Asia 2026" }))).status).toBe(429)
  } finally {
    store.close()
  }
})
