// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { ChatWidget } from "./ChatWidget"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test("floating chat opens, requires login, and closes with Escape", async () => {
  vi.stubEnv("VITE_MANAGEMENT_API_URL", "https://manage.example.org")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  )
  render(<ChatWidget />)
  fireEvent.click(screen.getByRole("button", { name: "학회 AI 열기" }))
  expect(await screen.findByRole("link", { name: "관리자 로그인" })).toBeTruthy()
  expect(screen.queryByRole("textbox")).toBeNull()
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
  expect(screen.queryByRole("dialog")).toBeNull()
})

test("authenticated chat submits a question and renders text safely with catalog links", async () => {
  vi.stubEnv("VITE_MANAGEMENT_API_URL", "https://manage.example.org")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST")
        return Response.json({
          answer: "<script>bad()</script> 강원도에서 개최됩니다.",
          sources: [{ title: "ICCE-Asia 2026", url: "https://icce-asia2026.org/2026/" }],
          truncated: false,
          matchedCount: 1,
        })
      return Response.json({ username: "operator", expiresAt: "2099-01-01T00:00:00Z" })
    }),
  )
  const { container } = render(<ChatWidget />)
  fireEvent.click(screen.getByRole("button", { name: "학회 AI 열기" }))
  fireEvent.change(await screen.findByRole("textbox", { name: "학회 질문" }), {
    target: { value: "ICCE-Asia 2026 장소" },
  })
  fireEvent.click(screen.getByRole("button", { name: "보내기" }))
  expect(await screen.findByText(/강원도에서 개최됩니다/)).toBeTruthy()
  expect(container.querySelector("script")).toBeNull()
  expect(screen.getByRole("link", { name: "ICCE-Asia 2026" }).getAttribute("href")).toBe(
    "https://icce-asia2026.org/2026/",
  )
})
