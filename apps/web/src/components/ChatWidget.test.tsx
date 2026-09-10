// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { ChatWidget } from "./ChatWidget"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

test("Enter sends once, while Shift+Enter and IME confirmation do not send", async () => {
  vi.stubEnv("VITE_MANAGEMENT_API_URL", "https://manage.example.org")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        answer: "키보드로 전송했습니다.",
        sources: [],
        truncated: false,
        matchedCount: 0,
      }),
    ),
  )
  render(<ChatWidget />)
  fireEvent.click(screen.getByRole("button", { name: "학회 AI 열기" }))
  const input = screen.getByRole("textbox", { name: "학회 질문" })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: "ICCE-Asia 2026 장소" } })
  expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true)
  expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(true)
  expect(fireEvent.keyDown(input, { key: "Enter", keyCode: 229 })).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false)
  fireEvent.keyDown(input, { key: "Enter", repeat: true })
  expect(await screen.findByText("키보드로 전송했습니다.")).toBeTruthy()
  expect(fetch).toHaveBeenCalledTimes(1)
})

test("floating chat opens without login or session requests and closes with Escape", async () => {
  vi.stubEnv("VITE_MANAGEMENT_API_URL", "https://manage.example.org")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  )
  render(<ChatWidget />)
  fireEvent.click(screen.getByRole("button", { name: "학회 AI 열기" }))
  expect(await screen.findByRole("textbox", { name: "학회 질문" })).toBeTruthy()
  expect(screen.queryByRole("link", { name: "관리자 로그인" })).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
  expect(screen.queryByRole("dialog")).toBeNull()
})

test("public chat sends no credentials and renders text safely with catalog links", async () => {
  vi.stubEnv("VITE_MANAGEMENT_API_URL", "https://manage.example.org")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.pathname).toBe("/api/v1/chat")
      expect(init?.credentials).toBe("omit")
      expect(new Headers(init?.headers).get("x-chat-visitor")).toMatch(/^[0-9a-f-]{36}$/)
      return Response.json({
        answer: "<script>bad()</script> 강원도에서 개최됩니다.",
        sources: [{ title: "ICCE-Asia 2026", url: "https://icce-asia2026.org/2026/" }],
        truncated: false,
        matchedCount: 1,
      })
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
