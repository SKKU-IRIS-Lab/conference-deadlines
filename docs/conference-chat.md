# Floating conference assistant

The site displays a small lower-right launcher on catalog and management pages.
The panel uses the existing management session; anonymous visitors are directed
to management login. Each question is independent and should include the event
name/year. Up to eight replies remain in component memory, not a conversation DB.

## Data and inference

- Browser: `VITE_MANAGEMENT_API_URL` (existing management origin).
- Authenticated endpoint: `POST /api/v1/admin/chat`, JSON `{ "question": "…" }`.
- Catalog: the published Pages `catalog-state.json`, validated and cached for at
  most five minutes. Fetch failures fail closed after cache expiry.
- Inference: local Ollama at `http://127.0.0.1:11434/api/chat` only.
- Default model: `qwen3.5:9b`; optional server environment `CONFERENCE_CHAT_MODEL`
  selects an already-installed model. No automatic model downloads or Claude fallback.
- No filesystem, shell, search, management-write, or model tool calls are exposed.
- No question text is sent to an external LLM provider by this integration.

Retrieval recognizes catalog acronyms, years, BK markers, T1–T4, and explicit
N-day submission windows. Broad questions use up to twelve upcoming candidates;
the response discloses truncation. This is not exhaustive semantic search and does
not guarantee that every paraphrase or complex filter is interpreted correctly.
BK markers are not numeric BK scores. Sources are catalog URLs, rendered separately
from model output; all generated text is rendered as plain escaped text.
Past-submission/timezone warnings are computed by the server, not left to the model.

## Resource and security limits

Existing cookie authentication plus exact browser Origin checks are required.
The request body is limited to 8 KiB and questions to 2–1000 characters.
Per API process: one request in flight, at least ten seconds between starts,
at most sixty requests per hour. Limits reset on process restart; multiple API
processes would need shared rate-limit storage. Other Ollama clients share GPU
capacity but do not share these application-specific limits.

Catalog timeout is ten seconds, inference timeout sixty seconds, browser timeout
seventy-five seconds. Bun socket idle timeout is ninety seconds. Failures return
a user-safe 503; existing search and management features remain independent.

Restart `conference-deadlines@conference-deadlines` to load API changes. Push web
changes to main for the existing Pages deployment. Keep Ollama off the public
internet; only the authenticated management endpoint needs external access.

Ollama request contract: https://docs.ollama.com/api/chat
