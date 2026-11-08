# BranchSuite 2 — Architecture

BranchSuite 2 is a ground-up rebuild of the BranchSuite proof of concept. It is designed to run entirely inside the
Employbridge Azure tenant.

| Priority | Feature |
| --- | --- |
| 1 | **Job order board**, the primary screen, with a public-safe **wall mode** for lobby displays. The **morning whiteboard** (huddle board) takes over the displays during each branch's scheduled huddle window. |
| 2 | **Mail intake**: branch shared mailboxes and opt-in personal mailboxes become actionable tasks, and a staffing request becomes a draft order. |
| 3 | **Candidate pipeline**: candidates are tentatively placed on order openings and tracked by stage. This is a stretch feature, built behind the `pipeline` feature flag. |

## 1. Azure topology

```
 Browser (staff)                       Lobby TV (wall display)
   │  Entra ID sign-in (single tenant)     │  display token (no user session)
   ▼                                       ▼
 Azure Static Web Apps (Standard) ── staticwebapp.config.json: /wall + /api/wall/* anonymous, everything else "authenticated"
   │  linked backend (x-ms-client-principal forwarded)
   ▼
 Azure Functions (Flex Consumption, Node 22, system-assigned managed identity)
   ├─ http  "api"      catch-all /api/{*path} → internal router
   ├─ timer "mailSync" every 2 min → Microsoft Graph delta per mailbox
   └─ timer "maintenance" daily → reopen-on-resume of paused orders, etc.
        │ managed identity (no keys anywhere)
        ├─ Azure Cosmos DB for NoSQL (serverless, disableLocalAuth)    data
        ├─ Azure OpenAI (disableLocalAuth)                             mail triage, structured outputs
        ├─ Azure Web PubSub (disableLocalAuth)                         "invalidate" push to boards/walls
        ├─ Microsoft Graph (Mail.Read via Exchange RBAC for Applications, scoped to a mail-enabled group)
        ├─ Key Vault                                                   HMAC secret for wall keys / pairing
        ├─ Storage (stmedia<token>, private container whiteboard-media) whiteboard screenshots; no keys, no SAS, 90-day lifecycle
        └─ Application Insights + Log Analytics
 Optional: VNet + private endpoints for Cosmos, OpenAI, Key Vault, Storage (host + media), Web PubSub (param enablePrivateNetworking).
```

Tenant containment:

- All data stays in the subscription's resources.
- Every data-plane call uses Entra ID with managed identity. Local and key auth is disabled on Cosmos DB, OpenAI, Web PubSub and Storage.
- Whiteboard images live in a separate media storage account. The Function App identity has Storage Blob Data Contributor on the `whiteboard-media` container only. Browsers never get a blob URL: every image is streamed through the API (`MEDIA_BLOB_ENDPOINT`, `MEDIA_CONTAINER`).
- Static Web Apps sign-in uses a custom single-tenant Entra provider, with "assignment required" on the enterprise app.
- The API also requires an active roster record (`users` in Cosmos DB). A tenant user with no roster record gets 403 `not_provisioned`.

## 2. Repository layout and ownership

```
packages/shared/   @branchsuite/shared — zod schemas, constants, API contract, pure domain rules (+ vitest)
apps/api/          Azure Functions app (TypeScript, esbuild bundle) + framework-free router + dev server
  src/http/        router, request/response helpers, error mapping
  src/auth/        SWA principal parsing, dev auth, display-token auth
  src/data/        Repository interfaces + CosmosRepo + MemoryRepo (dev/tests, optional JSON persistence)
  src/routes/      one module per resource (orders, accounts, candidates, tasks, wall, displays, users, branches, mailboxes, me, realtime, whiteboards)
  src/media/       MediaStore: BlobMediaStore (managed identity), MemoryMediaStore (dev/tests), Unconfigured (refuses uploads)
  src/realtime/    Web PubSub publisher (+ no-op)
  src/mail/        Graph client, delta sync, sanitizer, prefilter, classifier (Azure OpenAI), ingest pipeline
  src/functions/   Azure Functions registrations (thin adapters)
  src/dev/         local dev server (node:http) + seed data (fictional only)
apps/web/          React 19 + Vite + TypeScript + Tailwind 4 SPA
  src/app/         shell, router, providers, auth/dev-user, theme
  src/lib/         api client, query hooks, realtime hook, formatting
  src/ui/          shared primitives (Button, Dialog, Popover, Menu, Chip, Field, Toast, EmptyState, MarkerDot, WallGlyph)
  src/features/board/     job order board (primary)
  src/features/wall/      wall display (/wall) + pairing + staff preview + legend
  src/features/whiteboard/ morning whiteboard (/whiteboard): editor, member view, presenter, WhiteboardSlide
  src/features/pipeline/  candidate pipeline
  src/features/inbox/     mail tasks (branch / personal / combined)
  src/features/setup/     branches, people, accounts, mailboxes, displays, wall settings, import
infra/             Bicep (main.bicep + modules), azure.yaml (azd), scripts (Entra app, Exchange RBAC), GitHub Actions
docs/              ARCHITECTURE.md (this), DEPLOYMENT.md, SECURITY.md, MAIL.md, WALL.md, WHITEBOARD.md
```

## 3. Data (Cosmos DB, database `branchsuite`)

| Container | Partition key | Documents (`type` field) |
| --- | --- | --- |
| `directory` | `/pk` | `branch` (pk `branch`), `user` (pk `user`), `display` (pk `display`), `mailbox` (pk `mailbox`), `pairing` (pk `pairing`, TTL 600 s), `lock` (pk `lock`) |
| `board` | `/scopeId` | `account`, `order`, `candidate`, `task`, `event` (audit, TTL about 400 days), `whiteboard` (id `wb_<branchId>_<date>`, one per branch-local day), `media` (image metadata: type, size, sha256; TTL 90 days, bytes in Blob Storage). `scopeId` is the branch id, or `personal:<userId>` for private tasks. |
| `mail` | `/scopeId` | `message` (EmailMessage), `filtered` (TTL 30 days), `receipt` (idempotency, TTL 120 days), `thread` (conversationId → taskId), `mailboxState` (pk `mailbox:<id>`: delta links) |

How the data layout works:

- **One partition per branch.**
  - Orders, accounts, candidates and tasks for a branch share the partition `scopeId = branchId`.
  - Linking a candidate to an opening updates two documents in one **transactional batch** with ETag preconditions. The batch is atomic.
- **Personal privacy by partition.**
  - Personal tasks and mail live in `personal:<userId>`.
  - Only the owner's API calls ever read that partition.
  - The wall and branch queries never touch it.
- **Optimistic concurrency.**
  - Every update is read → mutate (pure domain function) → replace with `ifMatch: _etag`.
  - On 412 the server retries up to 5 times, then returns 409.
  - Line writes are therefore safe when two recruiters write on the same order at once.
- **Server stamps time.** Server code sets every `createdAt` / `updatedAt` / `*By` field. Client-supplied values are ignored.
- **Archival over deletion.** Accounts, users, branches and candidates are archived. Closed orders keep their history.
- **Audit.** Order, candidate, account, user, whiteboard and media mutations write an `event` document with a short summary.
- **Whiteboard media.** Uploads are raw `image/*` bodies (PNG, JPEG, WebP; 8 MB cap). The server checks the magic bytes against the declared type, dedupes by sha256, and stores bytes at `<branchId>/<mediaId>` in the private container. The blob lifecycle rule and the metadata TTL both expire images after 90 days.

Repository API (`apps/api/src/data/repo.ts`) exposes intent-level methods, not generic CRUD. Two implementations exist:

- `CosmosRepo` (production).
- `MemoryRepo` (tests and `npm run dev`; optional persistence to `apps/api/.data/dev.json`).

## 4. Authorization

`computePermissions` in shared is the model. The API is authoritative and the UI only hides controls.

| Role | Can do |
| --- | --- |
| admin | Every branch. Can manage branches, mailboxes, users of any role, and account import. |
| manager | The branches in `branchIds`. Can create, edit, pause, close and publish orders; add and remove openings; manage accounts, units, contacts and wall codes; set up displays and wall settings; manage users (member or manager) in those branches; review filtered mail; create orders from tasks. |
| member | Read their branches. Can write on lines (fill, clear, pencil, start); create, claim and complete tasks; create and move pipeline candidates; link candidates. |

Further rules:

- Members never receive account `contacts`.
- The roster is visible only for people who share a branch with the caller. Managers and admins see full user records; members see `PersonLite`.
- Inactive users get nothing.

## 5. Wall mode (public display)

- **Device identity, not a person.**
  1. A TV opens `/wall`. It calls `POST /api/wall/pair/start` and shows a 6-character code (`K7Q-29M`).
  2. A manager types the code in Setup → Displays → Pair a display.
  3. The server creates a `display` document holding only `sha256(token)`, and hands the token to the polling device once.
  4. The device stores the token in localStorage and sends it as `x-display-token`.
  5. A manager can revoke the display at any time. Revocation takes effect on the device's next request.
- **Coding happens on the server.** `/api/wall/feed` returns `toWallFeed(...)` output only. The default settings work as follows:
  - **Client:** a wall code + color + glyph, e.g. a blue ◆ **K7**, never the client name.
  - **Pay:** hidden. A branch can show exact pay or pay bands (`$`, `$$`, `$$$`).
  - **Candidates:** symbols only. ○ open, ◌ pencil, ● committed, ✓ started. No initials.
  - **Location:** hidden. **Notes:** never shown.
  - **Order keys:** HMAC of the order id, not the id itself.
- **Staff legend.** `/api/branches/:b/wall/legend` maps codes to accounts, for signed-in staff only. A manager can **rotate codes**, which regenerates all codes for the branch.
- **Never color-only.** Glyph and code shapes carry meaning together with color, and states use distinct symbols.
- **Paging.** When orders overflow the screen, the wall pages every `pageSeconds` with a page indicator. Font size and column count also adapt to the viewport.
- **Self-recovering.**
  - `/wall` is a deep link that starts on its own after a power cycle.
  - It shows a "Reconnecting…" banner on network loss and falls back to polling every 60 seconds.
  - It has no navigation out and offers no staff controls.
- **Staff preview.** In the app, Board → Wall preview shows exactly the feed the TV gets, with a legend toggle. A Board / Whiteboard toggle (`?mode=whiteboard`, staff only) previews today's huddle board even outside its window.
- **Whiteboard takeover.** While today's whiteboard is live, `/api/wall/feed` returns `mode: 'whiteboard'` with the resolved `WhiteboardView`. Live means `isWhiteboardLive`: `'auto'` inside the branch-local window (start inclusive, end exclusive), `'on'` all day, `'off'` never. The view shows full detail, as the owner approved for the huddle. Outside the window the feed returns `mode: 'board'`, and the TV cross-fades back.
  - **Invariant:** outside the live window a display gets *no* whiteboard content at all. The feed omits `whiteboard`, and `GET /api/wall/media/:id` returns 404 (`Cache-Control: no-store`) unless today's board for the display's branch is live and references that image. Every non-live case gets the same 404. The feed ignores `?mode`.
  - `nextModeChangeAt` names the next scheduled switch (window start or end), and the display refetches then, with 0.5–2.5 s of jitter. Manual Start now and End changes arrive over realtime.
  - Images reach the TV only through `/api/wall/media/<id>`, fetched with `x-display-token` and shown through object URLs. The staff preview and editor use `/api/branches/:b/media/<id>`.
  - Dev only: `DEV_WHITEBOARD_LIVE=on` makes today's board live all day (refused unless `AUTH_MODE=dev` and outside Azure).

## 6. Realtime

- Clients receive `RealtimeMessage {type:'invalidate', scopeId, entities}` and refetch with TanStack Query invalidation. The messages carry no business data.
- Staff tokens join the groups `scope:<branchId>` for readable branches and `scope:personal:<userId>`.
- Display tokens join only `wall:<branchId>`.
- Whiteboard changes publish entity `whiteboard` to both `scope:<b>` and `wall:<b>`. Staff clients refresh that branch's whiteboards and wall preview, and displays refetch the gated feed. Nothing is pushed at window start or end; displays use `nextModeChangeAt` for that.
- Groups are set at token issue time. Clients get no join/leave role, so they cannot subscribe to other groups.
- If Web PubSub is not configured, negotiate returns `{url:null}`. Clients then poll: 30 s for staff and 60 s for the wall.

## 7. Mail intake

- **Microsoft Graph replaces Power Automate.** No premium connectors and no pasted secrets.
  - The Function App's managed identity is granted *Application Mail.Read* through **Exchange RBAC for Applications**.
  - The grant is scoped to a management scope that matches a mail-enabled security group (`BranchSuite-Mailboxes`).
  - No tenant-wide Mail.Read consent is given in Entra.
  - Personal mailboxes join the same group once an admin approves the user's opt-in.
- **Sync.** A timer runs every 2 minutes and takes a Cosmos lease (`lock` document) so overlapping runs never double-process. For each enabled mailbox it pulls Graph **delta** for:
  - Inbox, for branch and personal mailboxes.
  - SentItems, for branch mailboxes only (team replies sent from the shared box).
- **Per-message pipeline** (`src/mail/ingest.ts`):
  1. **Receipt:** an idempotency check on `mailboxId + graphId`. A changed payload with the same id is logged and skipped.
  2. **Prefilter:** auto-replies (the `Auto-Submitted` header and subject prefixes), NDRs, no-reply senders, and configured ignore rules. The message is stored as `filtered`.
  3. **Direction:** a sender in the tenant or branch internal domains, or the mailbox itself, is an outbound/team message.
  4. **Content:** use Graph `uniqueBody` (quoted history already removed). Then run the fallback quote/signature stripper and cap the text at 12k characters.
  5. **Thread:** find the open task for `conversationId` in this scope.
  6. **Route:** run `routeEmail` (deterministic), for branch scope only.
  7. **Classify:** one Azure OpenAI call with **strict JSON schema** structured output.
     - A new inbound message gets triage: actionable, title, summary, category, priority, deadline, staffingRequest.
     - A follow-up gets an update decision: escalate, priority, refreshed summary, resolved.
     - A team reply gets a resolution check: does it resolve the open request?
  8. **Write:**
     - Create or update the task, and store the message.
     - If the message has an exact headcount and an unambiguous route, create a **draft order** in the same transactional batch. The order id is deterministic: `eo_<sha256(scopeId|internetMessageId)>`.
     - A draft becomes active only if the branch setting `autoPublishEmailOrders` is on.
     - Write the receipt last.
     - Notify through Web PubSub.
- Non-actionable mail is kept as `filtered` for 30 days. Managers can review it and promote a message to a task.
- Personal scope works the same way with these differences: tasks are private, no orders are created, and no team-reply closure happens.

## 8. AI

- Azure OpenAI, using the `openai` npm `AzureOpenAI` client with `DefaultAzureCredential` and no API keys. The deployment name is set in config (`AZURE_OPENAI_DEPLOYMENT`).
- Responses use structured outputs (`response_format: { type: 'json_schema', strict: true }`). The result is validated again with zod before any write.
- The model never chooses an account. Routing is deterministic, and the model may only *suggest*, with the suggestion stored as text.
- Prompts live in `apps/api/src/mail/prompts.ts`. The model receives sanitized text only.
- `AI_MODE=mock` gives deterministic heuristic output for dev and tests.

## 9. Local development

- `npm run dev` starts:
  - The API dev server on :7071 (`tsx src/dev/server.ts`). It uses MemoryRepo with fictional seed data, `AUTH_MODE=dev`, `AI_MODE=mock`, and realtime off.
  - The Vite dev server on :5173, which proxies `/api` to :7071.
- Dev auth: the web app shows a "Sign in as…" picker and sends `x-dev-user: <email>`.
  - The API honors that header **only** when `AUTH_MODE=dev`.
  - The API refuses to start in dev auth mode if `WEBSITE_SITE_NAME` or `FUNCTIONS_WORKER_RUNTIME`+`WEBSITE_INSTANCE_ID` indicate it is running in Azure.
- No Azure Functions Core Tools are needed for development. Handlers are framework-free: `(req: ApiRequest, ctx: AppContext) => Promise<ApiResponse>`.
- `npm test` runs vitest across shared, api and web.

## 10. Conventions

- TypeScript strict throughout, with ESM modules. Imports use `.js` extensions within packages.
- Validate every input with the shared zod schema. Keep domain rules in `@branchsuite/shared` so web and API agree.
- Seed and test data must be fictional. Do not use real client names, mailbox addresses or pay data from the PoC.
- Business days are branch-local day keys (`branch.timeZone`, default `America/Chicago`).
- Accessibility:
  - Keyboard reachable controls, visible focus, and labels on icon buttons.
  - Never color-only meaning.
  - WCAG AA contrast in all three themes and both wall themes.
- Fonts are self-hosted (`@fontsource/barlow`, `@fontsource/barlow-condensed`), so no third-party CDNs are called at runtime.
- Package versions (pinned majors): react 19, react-router 7, @tanstack/react-query 5, vite 8, @vitejs/plugin-react 6, tailwindcss 4 (+ @tailwindcss/vite), vitest 5, zod 4, typescript 5.9, @azure/functions 4, @azure/cosmos 4, @azure/identity 4, @azure/web-pubsub 1, openai (latest major), lucide-react (latest), esbuild, tsx.
