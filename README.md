# Analogy Tutor — milestone 2

A scripted query/key/value learning demo with a plain HTML/CSS/JavaScript frontend and a small Express backend. No LLM, API key, database, accounts or API charges. The navy-and-amber design and library story are retained.

## Run

Use Node.js 22 or newer. In PowerShell:

```powershell
Set-Location C:\Users\caden\Downloads\analogy-tutor
npm install
npm start
```

Then open **http://localhost:3000** in your browser. Do not open the HTML file directly or use Live Server: the frontend needs Express at the same origin. Stop with Ctrl+C. For automatic server restarts while editing, use `npm run dev` instead of `npm start` (a restart clears all sessions).

The server binds to this computer only (`127.0.0.1`). If port 3000 is occupied:

```powershell
$env:PORT = '3001'
npm start
```

Open http://localhost:3001 instead. No `.env` file is required or loaded in this milestone.

## Files and responsibilities

```text
public/
  index.html        Page structure, original illustration and network status
  styles.css        Existing design plus loading/disabled states
  app.js            Fetch requests, rendering and interactions
server/
  content.js        Scripted teaching text (server-only)
  provider.js       Scripted reply selection (server-only)
server.js           Express routes, validation and in-memory sessions
package.json        npm commands and the Express dependency
package-lock.json   Exact dependency versions for repeatable installs
tests/backend.test.js    HTTP tests and a lightweight frontend DOM harness
```

Only `public/` is served as static files. `server.js`, teaching source, tests, package files, `.env` and `.git` cannot be downloaded through the app. The lesson content remains visible as replies, but its source files are not browser assets.

## How a message travels

1. The learner clicks a sample or submits text. `public/app.js` creates a request ID and disables the demo controls while waiting.
2. On the first request, `fetch` calls `POST /api/session`. Express creates a random session ID and an empty history. The browser holds that ID in a JavaScript variable, not local storage or a cookie.
3. The browser sends JSON to `POST /api/chat`, with the session ID in the `X-Session-Id` header. `await` waits for the response without freezing the page.
4. Express validates the input, finds only that session's history and passes it to `server/provider.js`. The provider selects text from `server/content.js`; there is no AI model.
5. Express appends the learner message and scripted reply to that history, then returns `{ scripted: true, reply: { key, text } }` as JSON.
6. The frontend checks the response and builds DOM elements using `textContent`. A message containing HTML is displayed as text, never inserted as executable markup.

The provider remains separate from the server routes so a future milestone can replace it without rewriting the interface.

## Session and retry behaviour

- Each page load gets a distinct server-generated ID. Two tabs do not share histories, even in the same browser. Treat the temporary session ID as a bearer secret; this is not an account system.
- `POST /api/reset` clears that session's server history and retry cache. Only then does the frontend clear its visible conversation. Other sessions are unaffected.
- Refreshing starts a new page/session; it does not immediately erase the abandoned history. Old sessions expire after 30 minutes of inactivity. A once-per-minute cleanup removes idle sessions; requests also check expiry. Restarting Node erases everything immediately.
- Each history keeps at most 100 messages (50 turns), with at most 1,000 active sessions. Each session caches the last 20 successful request results so an immediate retry with the same request ID does not append another turn.
- Requests time out after 10 seconds. On failure, input stays in its textbox and an error offers **Retry request**. Resolve that failed request by retrying or choosing **Start again** before sending another message. If the server already processed it but the reply was lost, retry reuses the cached result.
- Session expiry or a server restart produces a clear message to start again. A reset failure preserves the visible conversation and offers retry.

## API summary

All routes return JSON. No cookies or cross-origin access are needed.

| Route | Body | Behaviour |
| --- | --- | --- |
| `POST /api/session` | `{}` | Creates a session; returns `{ sessionId }` |
| `POST /api/chat` | `{ requestId, message?, action? }` | Returns a scripted reply; requires a valid `X-Session-Id` |
| `POST /api/reset` | `{ requestId }` | Clears the identified session; returns `{ scripted: true, reset: true }` |

`requestId` must be a UUID v4. Chat requires a message or a supported action. Actions: `story`, `check`, `explain`, `technical`, `correction`, `partial`, `answer`, `definition`. Messages must be non-empty strings of at most 2,000 characters. Unknown fields/actions and invalid types are rejected. JSON bodies are limited to 8 KB. Session IDs and request IDs have different roles: a session groups turns; a request ID identifies one operation for retry.

## Automated checks

```powershell
npm test
```

Uses Node's built-in test runner, with no extra testing packages. Tests start their own servers on temporary ports. They check the teaching flow, action replies, two-session isolation, reset, retry deduplication, validation, body-size limits, expiration, bounded history, private-file access, loading locks, retained input and text rendering. Frontend tests use a small DOM harness; this is not a complete browser or screen-reader test.

## Verification recorded for this milestone

- All 7 automated tests passed with npm test.
- A separate headless Edge smoke run against Express passed the story, sample actions, technical/worked examples, prior-knowledge note, literal HTML rendering, simulated offline error, retry and reset.
- The expanded demo had no horizontal overflow at 1440px, 768px and 390px.
- The offline browser check deliberately replaced fetch with a rejection, then restored it; the lost-response deduplication scenario was tested separately in the integration suite.
- Manual screen-reader use, full keyboard navigation, real mobile devices and long-running load behaviour were not verified.

## Manual success checks

1. Click **Try the QKV demo**, then **Explain from scratch**. Expect the library story, concept mapping and analogy limitation, labelled as scripted.
2. Choose **Sample: Is the value the score?**, then the partly correct explain-back sample. Expect a targeted correction. Open the technical explanation and confirm the supplied example produces `[8, 2]`.
3. Choose **Give me a quick check**, type `[1, 6]`, then reveal the worked answer. Try a definition, review/skip and **Ask a question**. Unsupported text should receive the honest fallback.
4. Open the app in a second tab. Start a story there but do not ask for a check. `[1, 6]` receives a fallback there even after it was recognised in the first tab. This demonstrates that histories are separate.
5. In the first tab, choose **Start again**, start the story and submit `[1, 6]` without asking for a check. Expect a fallback: the old server-side check context was cleared. The other tab should retain its context.
6. After starting a story, use browser DevTools Network throttling to select **Offline**. Type a message and send it. Expect an error, retained input and a retry button. Return to **No throttling**, click **Retry request** and expect exactly one learner turn and reply. With a slow network selected, rapid clicks must not submit twice.
7. Submit `<img src=x onerror=alert(1)>`. Expect the literal text and a fallback, with no image or alert.
8. Try http://localhost:3000/server.js and http://localhost:3000/.env. Both must return 404. The page and its CSS/JavaScript must still load.
9. Test both **I know a little** paths (with a note and skipped), keyboard focus and narrow layouts.

## Limitations and next milestone

Only selected QKV replies are scripted. Arbitrary topics, general explain-back assessment and story personalisation are unsupported. This is a local learning prototype, not a production multi-user service. There are no accounts or durable storage, and no learner study or model comparison has been performed.

Technical reference: [Attention Is All You Need, sections 3.2 and 3.4](https://arxiv.org/html/1706.03762v7#S3.SS2). The weighted-value example is supplied, not derived from query/key vectors. Express setup follows the [official Express 5 API](https://expressjs.com/en/5x/api/).

Next milestone, after testing: backend LLM integration with current provider documentation, pricing and budget controls. No LLM integration is included here.

Suggested commit message: `Add Express backend with isolated scripted tutor sessions`
