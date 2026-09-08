import { useEffect, useId, useRef, useState } from "react"
import { z } from "zod"
import { getManagementAdminSession, getManagementApiConfig } from "../admin/management-api"
import "../styles/chat.css"

const replySchema = z.object({
  answer: z.string().max(8000),
  warnings: z.array(z.string()).default([]),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z
          .string()
          .url()
          .refine((url) => new URL(url).protocol === "https:"),
      }),
    )
    .max(12),
  truncated: z.boolean(),
  matchedCount: z.number(),
})
type Reply = z.infer<typeof replySchema>
interface Turn {
  readonly question: string
  readonly reply: Reply
}

export function ChatWidget() {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [auth, setAuth] = useState<"checking" | "signed-out" | "ready" | "error">("checking")
  const [question, setQuestion] = useState("")
  const [turns, setTurns] = useState<readonly Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const request = useRef<AbortController | null>(null)
  const config = getManagementApiConfig()
  const apiUrl = config?.apiUrl

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setAuth("checking")
    setError("")
    closeButton.current?.focus()
    if (!apiUrl) {
      setAuth("error")
      setError("AI 관리 서버가 아직 설정되지 않았습니다.")
      return
    }
    getManagementAdminSession({ apiUrl })
      .then((session) => {
        if (!cancelled) {
          setAuth(session ? "ready" : "signed-out")
          if (!session) setTurns([])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuth("error")
          setError("관리 서버에 연결하지 못했습니다. 잠시 후 다시 열어 주세요.")
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, apiUrl])
  useEffect(() => {
    if (open && (turns.length || busy)) bottom.current?.scrollIntoView?.({ block: "nearest" })
  }, [turns, busy, open])

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }
  async function submit() {
    if (!apiUrl || busy || request.current || auth !== "ready" || question.trim().length < 2) return
    const submitted = question.trim()
    const controller = new AbortController()
    request.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 75_000)
    setBusy(true)
    setError("")
    try {
      const response = await fetch(new URL("/api/v1/admin/chat", apiUrl), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: submitted }),
        signal: controller.signal,
      })
      if (response.status === 401) {
        setAuth("signed-out")
        setTurns([])
        throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.")
      }
      const body: unknown = await response.json()
      if (!response.ok) {
        const problem = z.object({ detail: z.string() }).safeParse(body)
        throw new Error(problem.success ? problem.data.detail : "답변 요청에 실패했습니다.")
      }
      const reply = replySchema.parse(body)
      setTurns((current) => [...current.slice(-7), { question: submitted, reply }])
      setQuestion("")
    } catch (reason) {
      setError(
        controller.signal.aborted
          ? "답변 대기 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : reason instanceof Error
            ? reason.message
            : "답변을 가져오지 못했습니다.",
      )
    } finally {
      window.clearTimeout(timeout)
      request.current = null
      setBusy(false)
    }
  }

  return (
    <div className="chat-widget">
      {open ? (
        <section
          aria-label="학회 AI 도우미"
          aria-modal="false"
          role="dialog"
          id={panelId}
          className="chat-panel"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation()
              close()
            }
          }}
        >
          <header className="chat-heading">
            <div>
              <strong>IRIS 학회 AI</strong>
              <span>로컬 AI · 카탈로그 기반</span>
            </div>
            <button ref={closeButton} type="button" onClick={close} aria-label="학회 AI 닫기">
              ×
            </button>
          </header>
          <div className="chat-content">
            <p className="chat-notice">
              학회 일정·장소·Tier를 물어보세요. 질문마다 학회명과 연도를 적어 주세요. 답변은 공식
              사이트에서 다시 확인해 주세요.
            </p>
            {auth === "checking" ? <output>로그인 확인 중…</output> : null}
            {auth === "signed-out" ? (
              <div className="chat-login">
                <p>현재는 관리자 로그인 후 이용할 수 있어요.</p>
                <a href={`${window.location.pathname}#/manage`} onClick={close}>
                  관리자 로그인
                </a>
                <p>로그인한 뒤 이 채팅창을 다시 열어 주세요.</p>
              </div>
            ) : null}
            <div role="log" aria-label="학회 AI 대화" aria-live="polite">
              {turns.map((turn, index) => (
                <div className="chat-turn" key={`${index}-${turn.question}`}>
                  <p className="chat-question">{turn.question}</p>
                  <p className="chat-answer">{turn.reply.answer}</p>
                  {turn.reply.warnings.map((warning) => (
                    <p className="chat-notice" key={warning}>
                      {warning}
                    </p>
                  ))}
                  {turn.reply.truncated ? (
                    <p className="chat-notice">
                      후보 {turn.reply.matchedCount}개 중 최대 12개를 참고했습니다. 조건을 좁혀
                      주세요.
                    </p>
                  ) : null}
                  <nav aria-label="답변 참고 공식 사이트" className="chat-sources">
                    {turn.reply.sources.map((source) => (
                      <a key={source.title} href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                    ))}
                  </nav>
                </div>
              ))}
            </div>
            {busy ? <output>학회 데이터를 확인하며 답변 중…</output> : null}
            {error ? (
              <p role="alert" className="chat-error">
                {error}
              </p>
            ) : null}
            <div ref={bottom} />
          </div>
          {auth === "ready" ? (
            <form
              className="chat-form"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <label className="chat-label" htmlFor={`${panelId}-input`}>
                학회 질문
              </label>
              <textarea
                id={`${panelId}-input`}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={1000}
                rows={2}
                disabled={busy}
                placeholder="ICCE-Asia 2026 어디서 열려?"
              />
              <div>
                <small>서버에 대화 기록을 저장하지 않습니다.</small>
                <button type="submit" disabled={busy || question.trim().length < 2}>
                  {busy ? "답변 중…" : "보내기"}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
      <button
        className="chat-trigger"
        ref={trigger}
        type="button"
        aria-label={open ? "학회 AI 접기" : "학회 AI 열기"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z" />
          <path d="M7 9h8M7 13h5" />
        </svg>
        <span>학회 AI</span>
      </button>
    </div>
  )
}
