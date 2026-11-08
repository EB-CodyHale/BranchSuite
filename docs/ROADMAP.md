# BranchSuite 2: recommended improvements

This builds on the November 2026 rebuild: the job order board, wall mode, the morning whiteboard, mail intake, the pipeline, and setup. Items are grouped by when they pay off. Effort is a rough estimate for one engineer: S is under 2 days, M is about a week, L is two or more weeks.

## 1. Before the pilot (finish what is built)

| # | Item | Why | Effort |
| --- | --- | --- | --- |
| 1.1 | **Run against real Azure in a sandbox subscription.** Run `azd provision`, then test Cosmos DB, Blob Storage, Web PubSub, Graph delta and Azure OpenAI end to end. | The Cosmos, Blob, Web PubSub and Graph code paths have passed type checks and mocked tests only; none has run against real Azure resources. Bicep validation still needs to run in CI. | M |
| 1.2 | **Confirm that the Static Web Apps linked backend works with Flex Consumption** (see SECURITY.md, residual risks). | If linking is not supported, the API needs another way to accept only traffic coming through SWA before go-live. | S |
| 1.3 | **Purge `BranchSuite-main.zip` from git history**, then rotate anything it exposed. | It contains real client names, pay rates and mailbox addresses. | S |
| 1.4 | **A branch-level default huddle window and weekday template.** Today the window is set on each day's board. | Managers would set "07:30–08:15, Mon–Fri" once. Each new day's board would start from a weekday template (standing talking points, a safety moment slot) instead of a copy of yesterday. | S |
| 1.5 | **Edit detection on the whiteboard.** Add `expectedUpdatedAt` to the upsert input. | Two managers editing the same board currently overwrite each other, because the last save wins. | S |
| 1.6 | **A pilot runbook check at branch-local midnight and at the huddle window edges.** | This confirms that inbox carryover, the wall switching to the whiteboard and back, and the media 404 behaviour work on real displays. | S |

## 2. Next (high value, builds directly on the new foundation)

| # | Item | Why | Effort |
| --- | --- | --- | --- |
| 2.1 | **Live charts on the whiteboard instead of screenshots.** Add chart blocks drawn from BranchSuite data: openings vs. filled this week, starts by day, time-to-fill by account, pipeline by stage. | This removes the daily screenshot step and keeps the numbers current. Screenshot upload stays for outside reports such as Workday or Adaptive. | M |
| 2.2 | **A start-date alert digest.** Each morning, list who starts today and tomorrow, lines due with no start date, and orders open 7 or more days. Post it to a Teams channel, or add it as a whiteboard block. | It turns the board's "starting ≤48h" and "aging" signals into actions before the huddle. A Teams webhook or the Graph Teams API avoids the Mail.Send permission. | S–M |
| 2.3 | **A market rollup view** for leaders over several branches: to fill, starts, aging and pipeline depth by branch, with drill-down to a branch board. | The data model already supports reading across branches. Market managers currently have to open each branch one at a time. | M |
| 2.4 | **A public "Now hiring" wall section with a QR code** linking to the branch's apply page. It shows role categories and shifts only, with pay according to the branch setting. | The lobby wall becomes a recruiting tool for walk-ins, and client names stay coded. | S |
| 2.5 | **A Microsoft Teams tab app.** Package the SPA as a Teams tab with Teams single sign-on (same Entra app). | Branch teams live in Teams. The tab adds no new hosting and keeps everything in the tenant. | M |
| 2.6 | **Order requests from attachments.** Use Azure AI Document Intelligence on PDF or Excel order forms attached to client emails, feeding the existing draft-order flow. | Many clients send headcount as attachments, not in the email body. The existing rule still applies: an order is created only when it states an exact headcount and the route is unambiguous. | M |
| 2.7 | **Pipeline quality-of-life features:** duplicate candidate detection (name plus phone), a quick-add from the board line popover, a "no-show" drop shortcut that reopens the line, and a stage SLA nudge (for example, 3 days or more in Submitted). | These reduce stale pipelines and keep the board's pencil marks accurate. | S–M |

## 3. Later (strategic)

| # | Item | Why | Effort |
| --- | --- | --- | --- |
| 3.1 | **ATS and front-office integration**, two-way sync of orders, candidates and starts with the system of record. The vendor and API still need to be confirmed. | It removes double entry. The board would become a live view on the system of record, not a second copy. | L |
| 3.2 | **Analytics through Microsoft Fabric.** Mirror Cosmos DB to Fabric (or use the analytical store) and build Power BI reports for fill rate, time-to-fill, and account and recruiter trends. | Leadership reporting without load on the operational database, and still inside the tenant. | M |
| 3.3 | **An installable PWA with a mobile line-writing flow.** It can show the board offline and queue line writes when the network drops. | Recruiters on the floor or at client sites can update lines from a phone. | M |
| 3.4 | **Spanish public wall text** (headline, symbol legend, "Now hiring" section). | Many walk-in associates read Spanish first, and the wall faces the public. | S |
| 3.5 | **Audit log viewer and data export for admins**, covering order history and whiteboard and display changes. | The audit events are already recorded; this gives admins somewhere to read them. It supports compliance questions and dispute resolution. | S |
| 3.6 | **Entra app roles and Conditional Access policy guidance.** Optionally source the admin and manager roles from Entra groups instead of the roster. | One place to manage access, and offboarding becomes automatic when a person leaves the group. | M |

## Suggested order

1. Items 1.1–1.6.
2. Pilot in one branch for two weeks.
3. Items 2.1, 2.2 and 2.4. These give the most visible wins for the morning huddle and the lobby.
4. Items 2.3 and 2.5 as more branches join.
