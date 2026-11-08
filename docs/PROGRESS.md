# BranchSuite 2 rebuild: progress

Last updated: 2026-11-08, about 08:35 UTC. Branch: `rebuild-v2`. Status: **ready to test locally.**

## Built

The board is the main screen. Lines are blank (open), penciled (tentative), initialed (committed) or checked (started). Each line is colored with the marker of the person who wrote on it.

| Area | What it does |
| --- | --- |
| **Job order board** | Shows each order's lines. Sort by need, start date, age or account. Filter, use a list view, and review draft orders. |
| **Wall mode** | `/wall` on a lobby TV, paired with a code. The server codes everything: wall codes and glyphs, no names, pay or initials. It pages, recovers by itself after power loss, and keeps the screen awake. |
| **Morning whiteboard** | A huddle board prepared ahead of time with talking points, assignments, priority orders, screenshots, notes and live numbers. It takes over every display during the window and returns to the coded board afterwards. Images are served only while the board is live. |
| **Mail intake** | Reads Graph delta from branch and personal mailboxes. One Azure OpenAI call per message, with strict structured output. Routing is deterministic. Draft orders are created only when an email states an exact headcount. Messages the model filters out can be reviewed. |
| **Pipeline** | Kanban by stage. Candidates are tentatively placed on order lines, and the line state follows the candidate's stage. |
| **Inbox and setup** | Tasks by category, with carryover. Branches, people, accounts and units, contacts, wall codes, mailboxes, displays, wall settings, account import, and a routing tester. |
| **Azure** | Bicep files for Static Web Apps, Functions (Flex Consumption), Cosmos DB, Azure OpenAI, Web PubSub, Key Vault and Blob Storage. Managed identity is used throughout, and private endpoints are optional. Includes CI and a manual deploy workflow. |

## Last verification (08:35 UTC)

- `npm run typecheck`: clean.
- `npm test`: 649 tests pass (254 shared, 150 API, 245 web).
- `npm run build`: clean.
- Visual QA in headless Chromium: all screens in three themes, at 320px, on a 1080p TV, and on a 4K TV. Screenshots are in `docs/screenshots/`.
- Review round:
  - **Security:** fixed a manager promoting or deactivating people in branches they don't manage, and hardened a short GCM tag.
  - **Correctness:** fixed a candidate's line start date being lost on the next stage change, account changes while candidates hold lines, and stale media reuse.
  - **Visual:** fixed the pipeline overflowing sideways, mobile headers, the huddle wall layout, and the pipeline filter defaulting to an empty view.

## Not yet verified

1. Bicep has not been compiled in this session: the classifier blocked the binary download. CI (`.github/workflows/ci.yml`) runs `bicep build`.
2. Nothing has been deployed to Azure. Cosmos DB, Blob Storage, Web PubSub, Graph and Azure OpenAI are unit-tested against fakes only. See ROADMAP item 1.1.
3. Linking a Flex Consumption Function App as the Static Web Apps backend (SECURITY.md, residual risks).

## Open decisions for the owner

- **Pairing rate limit.** It trusts the first `x-forwarded-for` entry, so a spoofer could exhaust the 200 active pairing slots. This blocks new pairings only and exposes no data. The fix depends on which client-IP header Static Web Apps guarantees, and should be confirmed during the pilot.
- **"Start now" has no automatic end.** If nobody presses End, the whiteboard stays on displays until midnight. Option: a maximum live duration.
- **Purge `BranchSuite-main.zip` from git history.** It contains real client data and is in commit `1002fff`. Keep the session transcript `.txt` in the repo root out of git.

## Run locally

```bash
npm install
npm run dev                         # API :7071 (memory data, mock AI) + web :5173
DEV_WHITEBOARD_LIVE=on npm run dev  # force the huddle takeover for testing
npm test
```

Open http://localhost:5173 and pick a seed user (Morgan is a manager, Casey a member). Open http://localhost:5173/wall for the TV. The dev display token is in `docs/WALL.md`.

## Next

See [ROADMAP.md](ROADMAP.md).
