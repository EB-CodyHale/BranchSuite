# BranchSuite 2 rebuild: progress and resume notes

Last updated: 2026-11-08, about 07:40 UTC. Branch: `rebuild-v2`.

## Done

| Round | Result |
| --- | --- |
| Foundation | Shared domain rules in `packages/shared`; API in `apps/api` (Functions, Cosmos/memory repos, auth, wall pairing, realtime); web shell in `apps/web`; Azure IaC in `infra/` |
| Features | Job order board, wall mode (pairing, coded feed, paging), mail intake (Graph delta, Azure OpenAI triage, draft orders), pipeline, inbox, setup screens |
| Integration | Code-split routes, CSP check, live smoke tests |

At the last full check, 547 tests passed, and `npm run typecheck` and `npm run build` were clean.

## In progress: morning whiteboard (huddle) mode

- **Contract:** `packages/shared/src/whiteboard.ts`, with stubs in `packages/shared/src/domain/whiteboard.ts`.
- **Product decisions (owner):**
  - During the huddle window (default 07:30–08:15, branch-local), every display shows the whiteboard.
  - Real names are allowed during the window.
  - Outside the window, the API never sends whiteboard content or media to displays.
- **Build round:** a background workflow with three builders and one integrator:
  - Shared rules plus API and media storage.
  - Web editor, presenter view and wall takeover.
  - Infra for Blob media storage.
- **If it was interrupted:** check `packages/shared/src/domain/whiteboard.ts` for remaining `NI()` stubs, and look for `apps/web/src/features/whiteboard/`. Re-run the round from the workflow script under `~/.claude/projects/-workspaces-BranchSuite/.../workflows/scripts/branchsuite-whiteboard-*.js`, or finish by hand using that file's builder briefs.

## Remaining

1. Finish the whiteboard round, then run `npm run typecheck && npm test && npm run build`.
2. **Review:** correctness, security and privacy review (wall coding, display tokens, personal mail) with verification of each finding, then fixes.
3. **Visual QA:**
   - Playwright Chromium is installed outside the repo, in the session scratchpad.
   - Steps: `npm run dev`, sign in with the dev picker, then screenshot `/`, `/pipeline`, `/inbox`, `/setup/*`, `/whiteboard`, and `/wall`. Get the `/wall` dev token from `docs/WALL.md`.
4. **Owner actions (not done by the agent):**
   - Purge `BranchSuite-main.zip` from git history before sharing. It contains real client names, pay rates and mailbox addresses, and is in commit `1002fff`.
   - Do not commit the session transcript `.txt` in the repo root.
   - Deploy steps are in `docs/DEPLOYMENT.md`. Nothing has been deployed to Azure yet.

## Run locally

```bash
npm install
npm run dev          # API :7071 (memory data, mock AI) + web :5173
npm test
```
