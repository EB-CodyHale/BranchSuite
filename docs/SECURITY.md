# BranchSuite 2 — Security

This document describes what BranchSuite protects, from whom, and which control does it. The controls are implemented in `infra/` (Azure), `apps/web/public/staticwebapp.config.json` (edge), `apps/api` (authorization and wall coding) and `infra/scripts` (Entra and Exchange setup).

Related documents: [ARCHITECTURE.md](ARCHITECTURE.md), [DEPLOYMENT.md](DEPLOYMENT.md).

## 1. Assets

| Asset | Where it lives | Sensitivity |
| --- | --- | --- |
| Client accounts, contacts, pay rates, job orders | Cosmos DB `board` | Confidential business data |
| Candidate names and pipeline stage | Cosmos DB `board` | Personal data |
| Email content (sanitized text, capped at 12k characters) and tasks | Cosmos DB `mail` and `board` | Confidential; may hold personal data |
| Personal mailbox tasks | `personal:<userId>` partitions | Private to one user |
| Staff roster (names, emails, roles) | Cosmos DB `directory` | Internal |
| Wall HMAC secret | Key Vault `wall-hmac-secret` | Secret |
| Sign-in client secret | Static Web App app setting `AAD_CLIENT_SECRET` | Secret |
| Wall display tokens | Lobby device `localStorage`; only `sha256(token)` on the server | Bearer credential for one branch's wall feed |
| Morning whiteboards (talking points, assignments with staff names, priority orders with account names, notes) | Cosmos DB `board` (type `whiteboard`) | Confidential business data; shown in full on the wall only during the huddle window (§6a) |
| Whiteboard screenshots (charts, reports) | Media storage account, private container `whiteboard-media`; metadata in Cosmos DB `board` (type `media`) | Confidential; may hold names or figures captured in the screenshot |

## 2. Threat model

| # | Threat | Actor | Main controls |
| --- | --- | --- | --- |
| T1 | Someone outside the company signs in | External attacker | Single-tenant Entra provider, other providers blocked (§3) |
| T2 | A tenant user who is not BranchSuite staff signs in | Insider | Assignment required + roster gate (§3) |
| T3 | Staff see another branch's data or a member sees contacts | Insider | Server-side authorization with `computePermissions` (§4) |
| T4 | A lobby visitor reads client names, pay or candidate names from the wall | Visitor | Server-side wall coding, no PII in the feed (§6) |
| T5 | A stolen or retired wall screen keeps reading data | Thief, ex-site | Hashed, revocable display tokens scoped to one branch (§6) |
| T6 | The app reads mailboxes it should not | Compromised app or misconfiguration | Exchange RBAC for Applications scoped to one group (§7) |
| T7 | A leaked key gives direct database or AI access | Attacker with a config dump | No keys exist: local auth off, managed identity (§5) |
| T8 | Direct network access to data services | Internet attacker | Private endpoints, public access off (§5) |
| T9 | Prompt injection in an email changes data | Email sender | Structured outputs, zod validation, deterministic routing, no tool calls (§8) |
| T10 | Cross-site scripting or clickjacking in the SPA | Web attacker | Strict CSP, frame-ancestors none, React escaping (§9) |
| T11 | A malicious or careless deployment | Insider, compromised CI | Manual deploy with required reviewers, OIDC, least privilege (§10) |
| T12 | Calls to the Function App that bypass Static Web Apps | Internet attacker | Linked backend restriction (§3) |
| T13 | A lobby visitor or associate reads whiteboard content (names, accounts, tasks) outside the huddle | Visitor | Server-side window gating of feed and media; whiteboard never cached on the device (§6a) |
| T14 | Whiteboard screenshots leak through a direct or shared storage URL | Anyone with a link | Private container, no public access, no SAS, no shared keys; bytes served only by the API (§6a) |
| T15 | A crafted upload (script disguised as an image, oversized file) attacks staff or wall browsers | Malicious or compromised manager account | Magic-byte validation, type allow-list, size cap, `nosniff`, strict CSP (§6a) |

## 3. Identity and sign-in

- **Single-tenant sign-in.** Static Web Apps uses a custom Entra ID provider whose issuer is `https://login.microsoftonline.com/<tenant-id>/v2.0`. Tokens from any other tenant fail validation. The deploy step stamps the tenant ID into `staticwebapp.config.json` and fails if it is missing.
- **Other providers are off.** `/.auth/login/github`, `twitter`, `apple`, `facebook` and `google` return 404.
- **Assignment required.** The enterprise app has `appRoleAssignmentRequired = true`. Only members of the assigned security group (`BranchSuite-Users`) get a token. Other tenant users get AADSTS50105.
- **Roster gate.** A signed-in user also needs an active `user` record in Cosmos DB. Without one, the API returns 403 `not_provisioned`. Inactive users get nothing. `BOOTSTRAP_ADMIN_EMAILS` creates the first admin only when no record exists for that email.
- **No group claims.** Tokens carry no group list. Roles and branches come from the roster, which the API reads on each request.
- **Everything is authenticated by default.** The route `/*` requires the `authenticated` role. Only `/wall`, `/wall/*`, `/api/wall/*`, `/api/health`, `/assets/*` and `/favicon.svg` are anonymous. An unauthenticated request gets a 302 to the Entra sign-in.
- **Linked backend.** The Function App is linked to the Static Web App. Linking configures the Function App to accept only requests that Static Web Apps forwards. The API trusts `x-ms-client-principal` only in `AUTH_MODE=swa`. The dev header `x-dev-user` works only in `AUTH_MODE=dev`, and the API refuses to start in dev mode on Azure.
- **Publishing credentials.** FTP and SCM basic authentication are disabled on the Function App. Deployments use Entra tokens.

## 4. Authorization

- The API is the only authority. The UI hides controls for convenience only.
- `computePermissions` in `@branchsuite/shared` defines admin, manager and member rights (see ARCHITECTURE.md §4). Every route checks it on the server.
- Members never receive account `contacts`. The roster shows only people who share a branch with the caller.
- **Partition isolation.** Branch data lives in partition `scopeId = branchId`. Personal tasks and mail live in `personal:<userId>`, and only the owner's calls read that partition. Wall and branch queries never touch it.
- **Server-stamped fields.** The server sets `createdAt`, `updatedAt` and every `*By` field. The server ignores client values for them.

## 5. No keys, and private networking

**Managed identity everywhere.** The Function App's system-assigned identity calls every service. Each service refuses key-based access:

| Service | Setting | Identity role |
| --- | --- | --- |
| Cosmos DB | `disableLocalAuth: true`, `disableKeyBasedMetadataWriteAccess: true` | Cosmos DB Built-in Data Contributor |
| Azure OpenAI | `disableLocalAuth: true` | Cognitive Services OpenAI User |
| Web PubSub | `disableLocalAuth: true` | Web PubSub Service Owner |
| Storage | `allowSharedKeyAccess: false` | Blob Data Owner, Queue and Table Data Contributor |
| Media storage (`stmedia<token>`) | `allowSharedKeyAccess: false`, `allowBlobPublicAccess: false`, `allowedCopyScope: AAD`, network bypass `None` | Storage Blob Data Contributor on the `whiteboard-media` container only |
| Key Vault | RBAC authorization (no access policies) | Key Vault Secrets User |
| Application Insights | `DisableLocalAuth: true` | Monitoring Metrics Publisher |
| Microsoft Graph | Exchange RBAC for Applications (§7) | Application Mail.Read, scoped |

All services require TLS 1.2 or later. The Function App is HTTPS only.

**Private networking** (`enablePrivateNetworking`, default on):

- A VNet holds a delegated Function App integration subnet and a private endpoint subnet.
- Cosmos DB, Azure OpenAI, Key Vault, Storage (blob, queue, table) and media storage (blob) have private endpoints and private DNS zones. Their public network access is **disabled**.
- The Function App routes all outbound traffic through the VNet.

**Web PubSub keeps public network access.** Browsers and lobby TVs connect to Web PubSub over WebSockets from the internet, outside the VNet. A private endpoint would make the service unreachable for them. The controls are:

- Access keys are off, so only the API identity can mint client tokens.
- Anonymous connects are denied on the hub.
- Each token fixes its groups at issue time (staff: their readable branches and their personal scope; displays: `wall:<branchId>` only). Clients get no join or leave rights.
- Messages carry no business data: only `{type:'invalidate', scopeId, entities}`. A client that receives one still has to call the authenticated API to read anything.

## 6. Wall privacy

The lobby wall is the only anonymous data surface. It is treated as public.

- **Device identity, not a person.** A screen pairs with a 6-character code that a manager confirms in the app. The code expires after 10 minutes. The server keeps only `sha256(token)` for the display; the token itself is handed to the device once, sealed with a key derived from the wall secret while it waits for pickup.
- **Scope.** A display token reads one branch's wall feed and joins only that branch's wall realtime group. It cannot call staff routes.
- **Revocation.** A manager revokes a display in Setup → Displays. The next request from that device fails.
- **Coding on the server.** `/api/wall/feed` returns the output of `toWallFeed` only. Raw orders never reach the device. Default settings:
  - Client: wall code + color + glyph, never the name.
  - Pay: hidden (a branch can choose bands or exact pay on purpose).
  - Candidates: symbols only, no initials or names.
  - Location: hidden. Notes: never sent.
  - Personal tasks: never part of the feed.
- **Opaque order keys.** The wall identifies orders by `HMAC-SHA256(wall secret, branchId:orderId)`, not by the order ID.
- **Legend is staff-only.** The code-to-account legend is at `/api/branches/:b/wall/legend`, which requires sign-in.
- **Code rotation.** A manager can regenerate all wall codes for a branch, for example after a legend printout leaks.
- **No navigation out.** The wall route has no links to staff screens and no controls.

## 6a. Morning whiteboard (huddle mode)

**Owner decision (2026-11-08).** Huddles happen before associates and visitors arrive. During the huddle window, every paired wall display of the branch switches from the coded order board to the whiteboard and may show **full detail**: staff names, account names, task assignments and screenshots. A board can set `orderLabels: 'code'` to show wall codes instead of account names for priority orders. Outside the window the wall shows only the coded order board (§6). This is a deliberate exception to the "wall is public" rule, limited in time, and enforced on the server.

**Server-side gating (the invariant).** Outside the live window the API never sends whiteboard content or media to a display.

- The window is branch-local (default 07:30–08:15, set per board) or a manager's **Start now** / **End**. The API decides "live" from its own clock and the branch time zone, never from the device.
- `/api/wall/feed` includes the `whiteboard` field only when the board is live. Otherwise the feed is the coded order board, with only `nextModeChangeAt` so the display knows when to refetch. A display that misses the end of the window still loses the whiteboard on its next poll or realtime invalidation.
- `/api/wall/media/:id` returns image bytes only when the display's branch board for today is live **and** one of its image blocks references that id. Every other case, including a wrong branch, an unknown id or a closed window, is the same `404`, so a display cannot probe which images exist or when a huddle is scheduled. Responses carry `Cache-Control: no-store`.
- Realtime messages stay data-free (`invalidate` with entity `whiteboard`); displays always refetch through the gated API.
- The wall renders images from in-memory object URLs (`blob:`, allowed by `img-src`), so no image URL is cached by the browser across the window boundary.

**Media storage.**

- A dedicated StorageV2 account for application data, separate from the Functions host account, so the host's broader roles never reach media and retention applies to app data only.
- Container `whiteboard-media` has public access `None`; the account disallows anonymous blob access and shared keys, so **no SAS or account-key URL can exist**. The API reads and writes with its managed identity and is the only path to the bytes: staff through `/api/branches/:b/media/:id` (branch staff only), displays through the gated wall route above. No `*.blob.core.windows.net` URL is ever sent to a browser.
- Public network access is disabled with private networking; the account is reachable only through its private endpoint from the Function App's VNet.
- Blob access logs (`StorageRead`, `StorageWrite`, `StorageDelete`) go to Log Analytics.

**Upload validation.** Only managers upload. The API accepts PNG, JPEG and WebP up to 8 MB, checks the file's **magic bytes** against the declared `Content-Type` (rejecting mismatches such as HTML or SVG renamed to `.png`), reads width and height from the header bytes, stores a SHA-256, and never overwrites an existing object. SVG is not accepted. Images are served with their verified content type and `X-Content-Type-Options: nosniff`.

**Retention.** A lifecycle management rule deletes whiteboard images **90 days** after upload. Blob and container soft delete keep a deleted image 7 more days for recovery, then it is gone. Whiteboard documents follow the board container's rules (§12).

## 7. Mail scoping

- The Function App identity reads mail through Microsoft Graph with the **Application Mail.Read** role from **Exchange RBAC for Applications**.
- The role assignment is limited by a management scope: `MemberOfGroup -eq '<BranchSuite-Mailboxes DN>'`. The identity can read only mailboxes in that mail-enabled security group.
- **No tenant-wide Graph `Mail.Read` is granted in Entra.** An Entra application permission would apply to all mailboxes and bypass the scope. `setup-exchange-rbac.ps1` warns when an unscoped assignment exists.
- Adding or removing a mailbox is an Exchange group membership change, which an Exchange administrator does and Exchange audits. Personal mailboxes join only after an admin approves the user's opt-in.
- `Test-ServicePrincipalAuthorization` shows the effective scope for any mailbox.
- The group is hidden from the address book, closed to self-join, and rejects external senders.

## 8. AI data handling

- **In-tenant service.** Azure OpenAI runs in your subscription. Prompts and completions are not used to train models. The default deployment SKU is `DataZoneStandard`, so processing stays in the US or EU data zone. `Standard` keeps it in the account region.
- **Sanitized input only.** The model receives the Graph `uniqueBody` text after quote and signature stripping, capped at 12k characters. No attachments are sent.
- **Structured outputs.** Every call uses a strict JSON schema. The API validates the result again with zod before any write and rejects anything that does not match.
- **The model cannot choose data.** Account routing is deterministic (`routeEmail`). The model's account suggestion is stored as text only. The model has no tools and makes no calls.
- **Draft, not publish.** An order created from email is a draft unless the branch turned on `autoPublishEmailOrders`.
- **Abuse monitoring.** By default, Microsoft may keep prompts and completions for up to 30 days for abuse monitoring, with human review in limited cases. For sensitive personal data, apply to Microsoft for **modified abuse monitoring** for the subscription (Azure OpenAI limited-access application). After approval, Microsoft stores no prompts or completions for abuse review. Record the approval in the pilot file.

## 9. Web application and edge headers

`staticwebapp.config.json` sets these headers on every response:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' wss://*.webpubsub.azure.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-Frame-Options` | `DENY` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

- No inline scripts and no inline `<style>` elements are allowed. React `style` props are set through the DOM and are not affected. Fonts are self-hosted, so no third-party origin is needed.
- `connect-src` allows only the app's own origin and Web PubSub WebSockets.
- `img-src` adds `blob:` for whiteboard images: the app fetches image bytes from the authenticated API and shows them through in-memory object URLs. `blob:` URLs can only be created by scripts already running on the app's own origin, so this adds no new source of content.

## 10. Deployment pipeline

- `ci.yml` builds and tests on every push and pull request. It has read-only repository permissions and no Azure access.
- `deploy.yml` runs only on manual dispatch, in the GitHub environment `production` with required reviewers and a `main`-only branch rule.
- Azure sign-in uses OIDC federated credentials bound to `repo:<org>/<repo>:environment:production`. The repository stores IDs only, no secrets.
- The deploy identity has Reader on the resource group, Website Contributor on the Function App, and Contributor on the Static Web App. It cannot create role assignments or change the infrastructure. An operator runs `azd provision` for infrastructure changes.
- Pull-request preview environments on Static Web Apps are disabled, so unreviewed builds never get a public URL.

## 11. Secrets

| Secret | Where | Rotation |
| --- | --- | --- |
| Sign-in client secret | SWA app setting `AAD_CLIENT_SECRET` only. The setup script never writes it to disk. | `setup-entra-auth.sh --rotate`, default lifetime 180 days. The script deletes the old secret after it stores the new one. |
| Wall HMAC secret | Key Vault `wall-hmac-secret`; the operator's azd environment file (`.azure/<env>/.env`, Git-ignored) keeps the value so provisioning does not rotate it by accident. | Set a new `AZURE_WALL_HMAC_SECRET` (at least 32 characters), run `azd provision`, then restart the Function App. Effect: wall order keys change (walls refetch) and pairings in progress fail. Paired displays keep working, because display tokens are stored as plain SHA-256 hashes. |

There are no other secrets. Data services have keys disabled.

The setup script passes the client secret to `az staticwebapp appsettings set` on the command line. Run it on a single-user workstation or in Cloud Shell.

## 12. Data retention

| Data | Retention |
| --- | --- |
| Pairing records | 600 seconds (Cosmos TTL) |
| Filtered (non-actionable) mail | 30 days (TTL) |
| Mail receipts (idempotency) | 120 days (TTL) |
| Audit events | about 400 days (TTL) |
| Orders, accounts, candidates, users, branches | Kept; archived, not deleted |
| Cosmos DB backups | Continuous, 7-day point-in-time restore |
| Log Analytics / App Insights | 30 days |
| Key Vault deleted objects | 90 days soft delete, purge protection on |
| Whiteboard images (blob) | 90 days after upload (lifecycle rule; runs once a day), then 7 days soft delete |

All containers have `defaultTtl: -1`: TTL is enabled, and only documents with a `ttl` field expire.

## 13. Audit and monitoring

- **Application audit.** Order, candidate, account and user changes write an `event` document with actor, time and a short summary.
- **Key Vault.** Audit logs (every secret read) go to Log Analytics.
- **Media storage.** Blob read, write and delete logs, with the caller identity, go to Log Analytics.
- **Function App.** `FunctionAppLogs` and Application Insights telemetry go to Log Analytics.
- **Entra.** Sign-in logs for the `BranchSuite` enterprise app show every sign-in and every blocked attempt.
- **Exchange.** The admin audit log records changes to the mailbox group, management scope and role assignment.

Suggested alerts: repeated 403 `not_provisioned`, Key Vault secret reads from an identity other than the Function App, and Function App failures above a baseline.

## 14. Residual risks

| Risk | Why it remains | Mitigation |
| --- | --- | --- |
| A wall screen shows coded data in a public lobby | That is the purpose of the wall | Defaults hide pay and location; codes rotate; displays revoke |
| A display token copied from a device reads one branch's coded feed until revoked | Bearer token on an unattended device | Revoke on loss; the feed holds no PII by design. During the huddle window the same token also reads that branch's whiteboard and its images. |
| A manager presses **Start now** (or sets the window) while associates or visitors are in the lobby, and full-detail whiteboard content appears on public screens | The owner chose full detail on all displays during the huddle; the API cannot see who is in the room | Window defaults to before opening hours; **End** takes effect on the next poll or realtime message (seconds); `orderLabels: 'code'` per board; manager training; every start/end is audited |
| Screenshots can contain anything the manager captured | Free-form images cannot be inspected for content | Manager-only upload, 90-day retention, served only through the gated API |
| Web PubSub is reachable from the internet | Browser clients need it | Keys off, anonymous denied, tokens with fixed groups, no data in messages |
| The Function App host name is public | Static Web Apps linked backends need it | Linked-backend restriction, Entra-only publishing, no anonymous staff routes |
| Microsoft abuse monitoring may keep AI prompts for up to 30 days | Default Azure OpenAI terms | Apply for modified abuse monitoring |
| Client secret on the Static Web App | Static Web Apps custom providers need a secret | Short lifetime, scripted rotation, stored only in the SWA setting |
| A Global or Exchange administrator can widen mailbox access | Tenant admins hold these rights | Exchange audit log; the script warns about unscoped assignments |
| Graph and Web PubSub calls leave the VNet | Microsoft Graph and browser-facing Web PubSub are public services | Entra authentication on every call, TLS 1.2 |
| Static Web Apps linked backend on Flex Consumption | Microsoft's support for linking a Flex Consumption app must be confirmed on the first deployment | Check that a direct call to `https://func-<token>.azurewebsites.net/api/me` is refused; if linking fails, stop and redesign the backend restriction before go-live |
