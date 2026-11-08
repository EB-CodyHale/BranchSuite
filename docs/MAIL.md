# BranchSuite 2 — Mail intake

Mail intake turns email to branch shared mailboxes, and to approved personal mailboxes, into tasks on the Day board. When a client asks for workers with one exact headcount, intake also creates a draft job order.

This page explains how intake works, how to set it up, what staff see, and how to fix common problems. The design is in [ARCHITECTURE.md §7–§8](ARCHITECTURE.md#7-mail-intake). The security controls are in [SECURITY.md §7–§8](SECURITY.md#7-mail-scoping).

Code: `apps/api/src/mail/`.

| File | Job |
| --- | --- |
| `graph.ts` | Microsoft Graph client: delta requests, retries, typed errors |
| `sync.ts` | Timer run: lease, mailboxes, folders, delta links, mailbox status |
| `ingest.ts` | Per-message pipeline (steps 1–8 below) |
| `prefilter.ts` | Drops auto-replies, bounces and no-reply senders |
| `sanitize.ts` | Removes quoted history, footers and banners; caps the text |
| `prompts.ts` / `classify.ts` | Azure OpenAI prompts, strict JSON schemas, validation, fallback, mock |
| `mailStore.ts` | Receipts, thread links, delta state and the sync lease |
| `service.ts` | Wiring for the timer and the "Sync now" button; `ingestTestMessage` for tests |
| `dev-ingest.ts` | Dev-only script that pushes sample mail through the pipeline |

## 1. How intake works

### The timer

1. The `mailSync` timer runs every 2 minutes.
2. It takes a lease: the `lock` document `mail-sync` in the `directory` container. The lease uses an ETag and expires after 5 minutes. When another run holds the lease, this run does nothing.
3. It lists enabled mailboxes. Personal mailboxes are included only when `FEATURE_PERSONAL_MAIL` is on.
4. It syncs up to 4 mailboxes at a time:
   - **Inbox** for every mailbox.
   - **Sent Items** for branch mailboxes only, to see team replies sent from the shared box.
5. For each folder it calls Graph delta (`/users/{address}/mailFolders/{inbox|sentitems}/messages/delta`), follows `@odata.nextLink`, and saves `@odata.deltaLink` in the `mailboxState` document for that mailbox and folder.
6. One run processes at most 400 messages. When it reaches that limit, it saves the current `nextLink`, and the next run continues from there.
7. It sets the mailbox `status` (`ok`, `no_access` or `error`), `lastSyncAt` and `lastError`.

**No history backfill.** The first sync of a folder asks Graph only for mail received in the last hour. Intake then processes only messages received after the mailbox was enabled (its last admin change), or after the start of that hour if that is later. Older mail is never imported.

An admin can press **Sync now** (Setup → Mailboxes). That runs one mailbox at once, unless the timer holds the lease. In that case the next timer run picks it up within 2 minutes.

### The per-message pipeline

| Step | What happens |
| --- | --- |
| 1. Receipt | Intake skips a message it already processed (key `sha256(mailboxId|graphId)`). Drafts and deleted-message entries are ignored. |
| 2. Prefilter | Auto-replies (`Auto-Submitted`, `X-Auto-Response-Suppress`, subjects such as "Automatic reply", "Out of Office", "Undeliverable"), no-reply and system senders, bulk mail and empty mail are stored as **filtered** mail. |
| 3. Direction | Mail in Sent Items, mail from the mailbox itself, and mail from `TENANT_DOMAINS` or the branch's internal domains is **team** mail. |
| 4. Content | Intake uses Graph `uniqueBody` (the new text only). It also strips quoted history, "Get Outlook for…" footers, signatures after `--`, disclaimers and "CAUTION: external email" banners, then caps the text at 12,000 characters. |
| 5. Thread | Intake looks for an **open** task for the same Graph conversation in the mailbox's branches (or the owner's personal scope). The task's board date does not matter, so work carries over across days. |
| 6. Route | `routeEmail` matches the sender and text to an account. This is deterministic; the model never picks an account. |
| 7. Classify | One Azure OpenAI call: **triage** for a new conversation, **follow-up** for client mail on an open task, **reply** for team mail on an open task. |
| 8. Write | Intake creates or updates the task, stores the message, writes the receipt last, and tells open boards to refresh. |

What each result does:

- **New actionable mail** creates a task. The task gets the board date of today in the branch time zone, the model's category and priority (a priority account raises "low" to "normal"), and the account owner as assignee when that person is active in the branch.
- **Staffing request with an exact headcount and a matched account** also creates a job order in the same transactional batch as the task. The order id is `eo_<sha256(scopeId|internetMessageId)>`, so the same email never makes two orders. The order is a **draft** unless the branch setting `autoPublishEmailOrders` is on.
- **Staffing request without that** keeps the request on the task. The task shows why no order was created, for example "The email does not state one exact headcount" or "The client account needs review before an order is created".
- **Client follow-up on an open task** adds to the message count and can raise the priority, refresh the summary and set a deadline. It never lowers a priority and never closes the task.
- **Team reply on an open task** closes the task as `reply_closed` when the reply completes the request (for example "Confirmed, 3 pickers start Monday"). An acknowledgment such as "On it" leaves the task open.
- **Mail on a completed task** never reopens it. If the new mail is actionable, intake creates a new open task and links the conversation to it.
- **Team mail with no open task** is ignored when it is in Sent Items. A teammate's new email to the shared inbox is triaged like any other mail (it routes to the branch's Internal account).
- **Non-actionable mail** is stored as filtered mail for 30 days.

### Mailboxes that serve several branches

Intake routes across the accounts of every branch the mailbox serves. A matched account decides the branch. When nothing matches, or matches span several branches, the task goes to the first branch in the mailbox's list with routing marked **ambiguous**, and no order is created. Routing candidates from other branches are dropped.

### Personal mailboxes

- Tasks live in `personal:<userId>`. Only the owner can read them. The wall and branch screens never read that partition.
- No routing, no orders and no reply closure. The owner's own mail is ignored.
- Colleagues' mail to the owner is treated as normal inbound mail.

## 2. Set up

You need an Exchange administrator for steps 1–2 and a BranchSuite admin for step 3.

1. **Mailbox group.** Create the mail-enabled security group `BranchSuite-Mailboxes` (or use the group name you chose) and add each branch shared mailbox to it.
2. **Exchange RBAC.** Run `infra/scripts/setup-exchange-rbac.ps1` once. It grants the Function App's managed identity **Application Mail.Read**, limited to members of that group. See [DEPLOYMENT.md §9](DEPLOYMENT.md#9-grant-scoped-mailbox-access-exchange-rbac). Do not grant Graph `Mail.Read` in Entra ID; that would give access to every mailbox in the tenant.
3. **BranchSuite.** In Setup → Mailboxes, add the mailbox address and choose the branch or branches it serves. The status starts as **pending** and changes to **ok** after the first sync.
4. **Internal domains.** Check `TENANT_DOMAINS` (deployment setting). Add any other staff domains per branch in the branch setting `internalDomains` (Setup → Branches).
5. **Accounts.** Add client domains, contacts and aliases so routing can match mail to accounts. Create the reserved Internal account per branch.
6. **Personal mailboxes.** A user opts in from their profile. An admin approves it and an Exchange administrator adds the user's mailbox to the same group.

Exchange RBAC changes can take 30 minutes to 2 hours to reach Graph.

### Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `TENANT_DOMAINS` | required | Staff email domains (team mail). |
| `AI_MODE` | `azure` | `mock` uses the keyword classifier (dev and tests only). |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | from Bicep | Azure OpenAI resource and deployment. |
| `AZURE_OPENAI_API_VERSION` | `2024-10-21` | API version. It must support `json_schema` structured outputs. |
| `FEATURE_PERSONAL_MAIL` | `true` | Sync personal mailboxes. |
| Branch `autoPublishEmailOrders` | off | Publish email orders as active instead of draft. |

### Local development

`npm run dev` uses memory data and mock AI and has no Graph access, so the timer logs "Microsoft Graph is not configured" and does nothing. To try the pipeline:

```bash
npx tsx apps/api/src/mail/dev-ingest.ts
```

The script loads the fictional seed in memory and prints what each sample message produced. To see the results in the app, stop `npm run dev`, run the script with `DEV_DATA_FILE=apps/api/.data/dev.json`, then start `npm run dev` again.

## 3. What staff see

- **Day board / Inbox.** Email tasks show the sender, subject, received time, message count, priority, category, routing status and assignee. A task opens the stored messages (new text only) and a link to the message in Outlook.
- **Draft orders.** A task that made an order links to it. Managers review the draft on the board and publish it.
- **Blocked requests.** A task with a staffing request but no order shows the reason. A manager can create the order from the task after choosing the account.
- **Reply-closed tasks.** These show the reply time, the replying address, a short excerpt and the reason.
- **Filtered mail.** Managers see filtered mail for their branches for 30 days, with the reason (prefilter or model), and can promote a message to a task.
- **Mailbox status.** Admins see status, last sync time and last error in Setup → Mailboxes.

## 4. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Status **no_access**, "Microsoft Graph denied access (403)" | The mailbox is not in the mailbox group, the RBAC grant is missing, or Exchange has not applied it yet. A 404 means the address has no Exchange Online mailbox. | Add the mailbox to the group. Run `Test-ServicePrincipalAuthorization -Identity <AppId> -Resource <mailbox>` (see the RBAC script). Wait up to 2 hours, then press Sync now. |
| Status **error** | Graph returned another error after retries, or a storage error stopped the run. | Read `lastError` and Application Insights traces ("Mailbox sync failed"). The next run retries from the last saved position. |
| Status stays **pending** | The mailbox is disabled, or the timer is not running. | Check that the mailbox is enabled and that the `mailSync` function runs (Function App → Functions → mailSync → Monitor). |
| Mail from before setup did not appear | By design: intake never backfills history. | Forward important older mail to the mailbox again, or create the tasks by hand. |
| A message appeared twice after a reset | Should not happen: receipts stop duplicates for 120 days. | Check the traces for "Mail message changed after it was processed". |
| "Mail delta state reset" in traces | Graph expired the stored delta link (for example after a long outage). | Nothing to do. Intake starts a new round from shortly before the last successful sync. Receipts skip messages it already processed. |
| Many tasks titled with the plain subject | The model call failed twice and intake used the safe fallback. | Check Azure OpenAI quota and health. Look for "Mail classifier fell back" in traces. |
| "Mail sync skipped: another run holds the lease" | A previous run is still working, or a host stopped mid-run. | Nothing to do. The lease expires after 5 minutes. |

To reset one folder completely, delete its `mailboxState` document (`mail` container, partition `mailbox:<mailboxId>`, id `state_inbox` or `state_sentitems`). The next run starts a new one-hour round.

## 5. Data retention

| Data | Where | Kept |
| --- | --- | --- |
| Stored messages (sanitized new text, capped at 12k characters) | `mail` container, task scope | With the task |
| Filtered mail | `mail` container | 30 days (TTL) |
| Receipts (idempotency, no body text) | `mail`, partition `mailbox:<id>` | 120 days (TTL) |
| Thread links (conversation id → task id) | `mail`, task scope | Until replaced |
| Delta state | `mail`, partition `mailbox:<id>` | Until reset |
| Tasks and orders | `board` container | See [SECURITY.md §12](SECURITY.md#12-data-retention) |

Intake never stores attachments, HTML bodies or quoted history.

## 6. AI data handling

- The model runs in Azure OpenAI in your subscription, called with the managed identity. No API keys exist.
- The model receives only the sender, subject, received time and the sanitized new text, plus the open task's title and summary for follow-ups and replies.
- The email is placed in a fenced block with a random boundary. The prompts tell the model that the email is untrusted data and that it must ignore instructions inside it.
- The model returns strict JSON. The API validates it again with zod and clamps long text before any write. Invalid output is retried once, then a safe fallback is used: an open task titled with the subject, no order, no closure.
- The model never chooses an account. Its account suggestion is stored as text in the message decision only.
- The model is told never to invent counts, rates or dates. An order is created only when the email states one exact headcount and routing matched one account.
- Logs at info level contain ids, outcomes and counts only. They never contain email addresses, subjects or bodies.
- See [SECURITY.md §8](SECURITY.md#8-ai-data-handling) for abuse monitoring and data zone settings.
