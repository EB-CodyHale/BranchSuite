# BranchSuite 2

BranchSuite is the staffing branch's whiteboard, rebuilt to run entirely inside the company's Azure tenant.

- **Job order board** (the main screen). Each order is a card with one line per opening. Recruiters write their initials on a line (pencil, committed, started), and managers create, pause, close and publish orders.
- **Wall mode.** A lobby TV paired to a branch shows a public-safe version of the board: client codes and glyphs instead of names, no pay, and symbols instead of initials. It pages automatically and recovers by itself after a power cut.
- **Mail intake.** Branch shared mailboxes, plus personal mailboxes users opt into, are read through Microsoft Graph. Azure OpenAI triages each message into a task in the **Inbox**. A request with an exact headcount and a clear account becomes a **draft order** for a manager to review.
- **Candidate pipeline.** A kanban from Sourced to Started. A candidate can pencil onto an opening on the board. This feature sits behind the `pipeline` flag.

The design, data model and security model are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

> **Before sharing this repository:** `BranchSuite-main.zip` is the archived proof of concept. It contains **real client data** and is in this repository's git history (commit `1002fff`). Remove it from the history (for example with `git filter-repo --path BranchSuite-main.zip --invert-paths`), then force-push and ask collaborators to re-clone. Do this before anyone outside the project gets access. Deleting the file in a new commit is not enough. Also check any notes or transcripts in the repo root that quote the zip.

## Quick start

You need Node 22 or later. Local development needs no Azure resources and no Azure Functions Core Tools.

```bash
npm install
npm run dev          # API on :7071 (in-memory fictional seed, dev auth, mock AI) + Vite on :5173
```

1. Open http://localhost:5173 and choose a seed user in **Sign in as…**. For example:
   - Avery Quinn (admin)
   - Morgan Reyes (manager, Riverside)
   - Casey Brooks (member)
2. Open http://localhost:5173/wall for the lobby display. To skip pairing, run this in the browser console, then reload:
   ```js
   localStorage.setItem('bs.wall.token', 'dev-wall-token-riverside-do-not-use-in-azure')
   ```
   Or pair the display for real: the TV shows a code, which you enter in **Setup → Displays → Pair a display**.
3. To feed sample mail through the intake pipeline, run `npx tsx apps/api/src/mail/dev-ingest.ts`. See [docs/MAIL.md](docs/MAIL.md) for how to see the results in the running app.

API calls need a dev user. In dev mode, `curl -H 'x-dev-user: morgan@branchsuite.example.com' http://localhost:7071/api/me` works. The API accepts `x-dev-user` only when `AUTH_MODE=dev`, and it refuses to start in that mode on Azure.

All seed data is fictional. Keep it that way: never copy client names, mailboxes or pay rates from the proof of concept.

## Repository layout

```
packages/shared/   @branchsuite/shared: zod schemas, API contract, pure domain rules (orders, wall feed, permissions, pipeline, tasks)
apps/api/          Azure Functions app with a framework-free router; src/dev/server.ts runs the same router on node:http
  src/routes/      one module per resource
  src/mail/        Graph client, delta sync, prefilter, sanitizer, classifier, ingest
  src/data/        Repo interface: CosmosRepo (Azure) and MemoryRepo (dev and tests)
apps/web/          React 19 + Vite + Tailwind 4 SPA
  src/app/         shell, router (each feature is a lazily loaded chunk), auth, theme
  src/lib/         API client, TanStack Query hooks, realtime
  src/ui/          shared primitives
  src/features/    board, wall, inbox, pipeline, setup
infra/             Bicep (main.bicep + modules), setup scripts (Entra app, Exchange RBAC)
.github/workflows/ ci.yml, deploy.yml
docs/              architecture, deployment, security, mail and wall guides
```

## Scripts (run from the repo root)

| Script | What it does |
| --- | --- |
| `npm run dev` | API dev server and Vite together (`dev:api`, `dev:web` run one each) |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | Vitest in shared, api and web |
| `npm run build` | Typechecks shared, bundles the API with esbuild (`apps/api/dist/functions.js`), and builds the SPA (`apps/web/dist`) |
| `npm run lint` | Runs `lint` in any workspace that defines it (none does yet) |

## Testing

- **`packages/shared`**: unit tests for the domain rules. Examples: line writes, board metrics, wall-feed redaction, permissions.
- **`apps/api/test`**: route tests against `MemoryRepo` through the real router. They cover authorization, privacy, wall tokens and pairing, and candidates. `test/mail/` tests the mail pipeline with a fake Graph client and a mock classifier.
- **`apps/web`**: component tests with Testing Library and jsdom, kept next to each feature (`*.test.tsx`), plus `src/lib` hook tests.

Run one workspace with `npm --workspace apps/web test`, or one file with `npx vitest run <path>` inside that workspace.

The built SPA works under a strict CSP (`script-src 'self'; style-src 'self'`). It has no inline scripts or `<style>` elements. Keep it that way: put styles in CSS files and dynamic values in React `style` props.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): Azure topology, data layout, authorization, wall mode, realtime, mail and AI
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): deploying to a tenant, step by step, and first-branch setup
- [docs/SECURITY.md](docs/SECURITY.md): threat model and controls
- [docs/MAIL.md](docs/MAIL.md): how mail intake works, how to set up mailboxes, troubleshooting
- [docs/WALL.md](docs/WALL.md): wall settings, pairing and revoking displays, kiosk hardware, troubleshooting
