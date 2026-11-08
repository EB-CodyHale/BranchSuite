# BranchSuite 2 — Deployment runbook

This runbook takes an empty Azure subscription to a first working branch with a paired wall display. Do the steps in order. Each step names who does it and how to check the result.

Related documents: [ARCHITECTURE.md](ARCHITECTURE.md) (design), [SECURITY.md](SECURITY.md) (threat model and controls).

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Create the sign-in group](#2-create-the-sign-in-group)
3. [Create the azd environment](#3-create-the-azd-environment)
4. [Provision the infrastructure](#4-provision-the-infrastructure)
5. [Set up Entra sign-in](#5-set-up-entra-sign-in)
6. [Deploy the application](#6-deploy-the-application)
7. [Check the deployment](#7-check-the-deployment)
8. [Sign in as the bootstrap admin](#8-sign-in-as-the-bootstrap-admin)
9. [Grant scoped mailbox access (Exchange RBAC)](#9-grant-scoped-mailbox-access-exchange-rbac)
10. [Set up the first branch](#10-set-up-the-first-branch)
11. [Pair a wall display](#11-pair-a-wall-display)
12. [Set up the GitHub deploy pipeline](#12-set-up-the-github-deploy-pipeline)
13. [Pilot checklist](#13-pilot-checklist)
14. [Rollback](#14-rollback)
15. [Cost notes](#15-cost-notes)
16. [Reference: parameters, outputs and app settings](#16-reference)

---

## 1. Prerequisites

### Tools (operator workstation)

| Tool | Version | Used for |
| --- | --- | --- |
| Azure CLI (`az`) | 2.60 or later | Entra script, checks |
| Azure Developer CLI (`azd`) | 1.10 or later (needs `remoteBuild` support for Flex Consumption) | provision and deploy |
| Node.js | 22 (see `.nvmrc`) | build, azd hooks |
| PowerShell | 7.x | Exchange RBAC script |
| ExchangeOnlineManagement module | 3.x | Exchange RBAC script |

### Permissions

| Who | Needs |
| --- | --- |
| Infrastructure operator | **Owner** on the target resource group, or **Contributor + Role Based Access Control Administrator**. The template creates role assignments for the Function App identity. |
| Entra administrator | **Application Administrator** or **Cloud Application Administrator**, to create the app registration and assign the sign-in group. **Privileged Role Administrator** only if you use `--grant-consent`. |
| Exchange administrator | **Exchange Administrator** (or Organization Management), to run the RBAC for Applications script. |

### Tenant and subscription

- **Microsoft Entra ID P1 or P2.** You need it to assign a *group* to the enterprise app. Without P1 you must assign users one by one.
- **Region.** Choose one region that offers all of these:
  - Azure Functions Flex Consumption.
  - Azure OpenAI with your chosen model and deployment SKU. If the primary region lacks the model, set `AZURE_OPENAI_LOCATION`.
  - Cosmos DB serverless.
- **Static Web Apps** runs in `westus2`, `centralus`, `eastus2`, `westeurope` or `eastasia`. The default is `eastus2`.
- **Azure OpenAI quota.** Check that you have quota for the model in the region (Azure AI Foundry → Quotas). The default is 30k tokens per minute.
- **Resource providers.** Register them once per subscription:

  ```bash
  for ns in Microsoft.Web Microsoft.App Microsoft.DocumentDB Microsoft.CognitiveServices \
            Microsoft.SignalRService Microsoft.KeyVault Microsoft.Storage Microsoft.Network \
            Microsoft.OperationalInsights Microsoft.Insights; do
    az provider register --namespace "$ns"
  done
  ```

### Choose the OpenAI model

The defaults are `gpt-4.1-mini`, version `2025-04-14`, SKU `DataZoneStandard`. Use the **newest model that your organization has approved** and that supports structured outputs (`json_schema`, strict). To list what the region offers:

```bash
az cognitiveservices model list -l <region> \
  --query "[?model.format=='OpenAI'].{name:model.name, version:model.version, skus:model.skus[].name}" -o table
```

Then set `AZURE_OPENAI_MODEL` and `AZURE_OPENAI_MODEL_VERSION` (step 3). The deployment uses `NoAutoUpgrade`, so a model version changes only when you change these values and provision again.

## 2. Create the sign-in group

**Who:** Entra administrator.

Create a security group, for example `BranchSuite-Users`. Add the pilot staff to it. Only members of this group can sign in, because the enterprise app requires assignment.

```bash
az ad group create --display-name BranchSuite-Users --mail-nickname BranchSuite-Users
az ad group show --group BranchSuite-Users --query id -o tsv   # keep this object ID
```

Membership in this group is only the first gate. A person also needs an active roster record in BranchSuite, which an admin or manager creates (step 10).

## 3. Create the azd environment

**Who:** infrastructure operator.

```bash
az login
azd auth login
az group create --name rg-branchsuite-prod --location eastus2

azd env new prod
azd env set AZURE_SUBSCRIPTION_ID <subscription-id>
azd env set AZURE_LOCATION eastus2
azd env set AZURE_RESOURCE_GROUP rg-branchsuite-prod

# Required application values
azd env set TENANT_DOMAINS "contoso.com,contoso-staffing.com"
azd env set BOOTSTRAP_ADMIN_EMAILS "it.admin@contoso.com"
```

Optional overrides (defaults shown):

| azd variable | Default | Effect |
| --- | --- | --- |
| `ENABLE_PRIVATE_NETWORKING` | `true` | Private endpoints for Cosmos DB, OpenAI, Key Vault and Storage, and public access off on those resources. |
| `AZURE_STATIC_WEB_APP_LOCATION` | `eastus2` | Static Web Apps region. |
| `AZURE_OPENAI_LOCATION` | primary region | OpenAI region. |
| `AZURE_OPENAI_MODEL` / `AZURE_OPENAI_MODEL_VERSION` | `gpt-4.1-mini` / `2025-04-14` | Model. |
| `AZURE_OPENAI_DEPLOYMENT_SKU` | `DataZoneStandard` | `Standard` (regional), `DataZoneStandard` (US or EU data zone) or `GlobalStandard`. |
| `AZURE_OPENAI_CAPACITY` | `30` | Thousands of tokens per minute. |
| `AZURE_WEB_PUBSUB_SKU` | `Standard_S1` | Use `Free_F1` only for a test environment (20 connections, no SLA). |
| `FEATURE_PIPELINE` | `true` | Candidate pipeline (stretch feature). |
| `FEATURE_PERSONAL_MAIL` | `true` | Opt-in personal mailbox intake. |
| `GRANT_DEPLOYER_DATA_ACCESS` | `false` | Gives your own identity Cosmos DB data access for support work. |

`TENANT_DOMAINS` lists every email domain that your staff send from. Mail intake treats senders in these domains as team members, not clients.

`BOOTSTRAP_ADMIN_EMAILS` applies only when no roster record exists for that email. The first sign-in of a listed address creates a global admin. After that, the roster record controls the person's access.

## 4. Provision the infrastructure

**Who:** infrastructure operator.

```bash
azd provision
```

The `preprovision` hook (`infra/scripts/ensure-env.mjs`) does two things:

- It stops the run when `TENANT_DOMAINS` or `BOOTSTRAP_ADMIN_EMAILS` is missing.
- It generates `AZURE_WALL_HMAC_SECRET` once and stores it in `.azure/prod/.env`, which Git ignores. Later provision runs reuse it, so the secret does not rotate on every run. If another operator provisions from another machine, copy the value to that machine first with `azd env set AZURE_WALL_HMAC_SECRET <value>`.

The first run takes about 10 to 15 minutes. It creates the resources below. `<token>` is a stable hash of the subscription, resource group, environment and region.

| Resource | Name | Notes |
| --- | --- | --- |
| Log Analytics + Application Insights | `log-<token>`, `appi-<token>` | Local auth off; the Function App sends telemetry with its identity. |
| Cosmos DB (serverless) | `cosmos-<token>` | Database `branchsuite`; containers `directory`, `board`, `mail`; local auth off; 7-day point-in-time restore. |
| Storage | `st<token>` | Shared key off; Functions host and deployment package. |
| Function App (Flex Consumption FC1) | `func-<token>` | Node 22, system-assigned identity, basic-auth publishing off. |
| Azure OpenAI | `oai-<token>` | Local auth off; deployment `triage`. |
| Web PubSub | `wps-<token>` | Local auth off; hub `branchsuite` denies anonymous connects. |
| Key Vault | `kv-<token>` | RBAC, purge protection; secret `wall-hmac-secret`. |
| Static Web App (Standard) | `swa-<token>` | Linked backend: the Function App. |
| VNet, private endpoints, private DNS zones | `vnet-<token>`, `pe-*` | Only with private networking on. |

Check: `azd env get-values` shows `SERVICE_WEB_URI`, `AZURE_FUNCTION_APP_NAME` and `AZURE_FUNCTION_PRINCIPAL_ID`.

> **Private networking and operators.** With private networking on, Cosmos DB, Key Vault, OpenAI and Storage refuse data-plane calls from the internet. Portal Data Explorer and the Key Vault secrets blade fail from your workstation. That is intended. For support work, connect through a VNet-connected path (VPN gateway, Bastion jump host) or use the application itself. Control-plane operations (`azd provision`, role assignments) still work.

## 5. Set up Entra sign-in

**Who:** Entra administrator.

```bash
eval "$(azd env get-values | grep -E '^(AZURE_RESOURCE_GROUP|AZURE_STATIC_WEB_APP_NAME)=')"
export AZURE_RESOURCE_GROUP AZURE_STATIC_WEB_APP_NAME

infra/scripts/setup-entra-auth.sh \
  --group-id <BranchSuite-Users object ID> \
  --secret-days 180
# Add --extra-host branchsuite.contoso.com for each custom domain.
# Add --grant-consent to grant tenant-wide consent for User.Read if user consent is off in your tenant.
```

The script:

- Creates (or updates) the single-tenant app registration `BranchSuite`, with the redirect URI `https://<swa-host>/.auth/login/aad/callback`, ID tokens on, and no group claims.
- Sets **Assignment required** on the enterprise app and assigns the sign-in group.
- Creates a client secret (default lifetime 180 days) and stores `AAD_CLIENT_ID` and `AAD_CLIENT_SECRET` as Static Web App app settings. The secret is never written to disk or to azd.

**Secret rotation.** Run the script again with `--rotate` before the secret expires. Put a calendar reminder 2 weeks before the expiry date that the script prints. The script creates the new secret, updates the SWA settings, then deletes the old secrets that it created. Sign-ins in progress during the switch retry once.

## 6. Deploy the application

**Who:** infrastructure operator (first time). Later deployments use the GitHub workflow (step 12).

```bash
azd deploy --all
```

- **web:** azd runs `npm run build` in `apps/web`. The `prepackage` hook (`infra/scripts/stamp-tenant.mjs`) then replaces `__TENANT_ID__` in `dist/staticwebapp.config.json` with `AZURE_TENANT_ID`. The source file keeps the placeholder. The hook fails the deployment if the tenant ID is not a GUID or the placeholder is missing.
- **api:** azd runs `npm run build` in `apps/api` (esbuild bundle). The `prepackage` hook (`infra/scripts/stage-api.mjs`) assembles `build/package` with `host.json`, a minimal `package.json` and `dist/`. azd uploads that package; no remote build runs.

## 7. Check the deployment

| Check | Expected result |
| --- | --- |
| `curl https://<swa-host>/api/health` | `200` with `{"ok":true,"version":"…"}` |
| Open `https://<swa-host>/` in a private window | Redirect to the Microsoft sign-in page for your tenant only. |
| Sign in as a tenant user who is **not** in `BranchSuite-Users` | Entra error AADSTS50105 ("not assigned"). |
| Open `https://<swa-host>/wall` in a private window | The pairing screen with a 6-character code. No sign-in prompt. |
| Open `https://<swa-host>/.auth/login/github` | `404` |
| `curl -I https://<swa-host>/` | `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY` headers present. |
| Application Insights → Live metrics | Requests from the Function App appear. |

## 8. Sign in as the bootstrap admin

**Who:** the person listed in `BOOTSTRAP_ADMIN_EMAILS`. That person must be in `BranchSuite-Users`.

1. Open `https://<swa-host>/` and sign in.
2. The API finds no roster record for the email, sees it in `BOOTSTRAP_ADMIN_EMAILS`, and creates a global admin record.
3. Check that the **Setup** menu is visible.

A user in the sign-in group with no roster record and not in the bootstrap list sees "not provisioned" (HTTP 403 `not_provisioned`). That is the roster gate working.

## 9. Grant scoped mailbox access (Exchange RBAC)

**Who:** Exchange administrator, with the Entra administrator for the IDs.

Mail intake reads mail with the Function App's managed identity through Microsoft Graph. Access is limited to the members of one mail-enabled security group by **Exchange RBAC for Applications**.

> **Do not** grant the Microsoft Graph `Mail.Read` *application* permission to the Function App identity in Entra ID. Entra application permissions cover every mailbox in the tenant and bypass the Exchange scope.

1. Get the identity's IDs:

   ```bash
   OBJECT_ID="$(azd env get-value AZURE_FUNCTION_PRINCIPAL_ID)"
   APP_ID="$(az ad sp show --id "$OBJECT_ID" --query appId -o tsv)"
   ```

2. Run the script in PowerShell 7:

   ```powershell
   ./infra/scripts/setup-exchange-rbac.ps1 -AppId <APP_ID> -ObjectId <OBJECT_ID> `
     -CreateGroup -GroupPrimarySmtpAddress branchsuite-mailboxes@contoso.com `
     -AddMailbox branch-0412@contoso.com `
     -TestMailbox branch-0412@contoso.com, someone.not.in.group@contoso.com
   ```

3. Check the `Test-ServicePrincipalAuthorization` output. Expect `InScope = True` for the branch mailbox and `InScope = False` for the other mailbox.

4. Wait 30 minutes to 2 hours before you expect Graph calls to succeed. Exchange caches RBAC data.

**Add a mailbox later.** A mailbox can be a shared branch mailbox or a person's own mailbox after an admin approves the person's opt-in:

```powershell
Add-DistributionGroupMember -Identity BranchSuite-Mailboxes -Member <mailbox address>
Test-ServicePrincipalAuthorization -Identity <APP_ID> -Resource <mailbox address>
```

Then create the mailbox record in BranchSuite (step 10). To remove access, use `Remove-DistributionGroupMember` and disable the mailbox record in BranchSuite.

## 10. Set up the first branch

**Who:** the bootstrap admin, in the BranchSuite web app.

1. **Setup → Branches → New branch.** Enter the name, branch code and time zone (default `America/Chicago`). Business days and "today" use this time zone.
2. **Setup → People.** Add the branch manager and recruiters, with their branch, role, initials and marker color. Their sign-in email must match their Entra account. Add each person to `BranchSuite-Users` as well.
3. **Setup → Accounts.** Add client accounts (**New account**), or admins can bulk-load them with **Setup → Import accounts**. Each account gets a wall code, color and glyph automatically.
4. **Setup → Mailboxes.** Bind the branch shared mailbox from step 9 to the branch. Bind a mailbox only when its mapping to one branch is unambiguous.
5. **Setup → Wall settings.** Check the defaults: pay hidden, location hidden, candidate symbols only. Change them only on purpose.

Check: the manager signs in, sees the branch board, and can create an order.

## 11. Pair a wall display

**Who:** a branch manager, with physical access to the lobby screen.

1. On the lobby screen, open `https://<swa-host>/wall` in a full-screen (kiosk) browser. Set the browser to open this URL on start, so the wall recovers after a power cycle.
2. The screen shows a pairing code such as `K7Q-29M`. The code expires after 10 minutes.
3. In BranchSuite, open **Setup → Displays**, pick the branch in the Setup header, then choose **Pair a display** and type the code.
4. The screen loads the wall feed within a few seconds.

Check: the wall shows wall codes and symbols, not client names, pay or candidate initials. **Board → Wall preview** shows the same feed.

To retire or replace a screen, use **Setup → Displays → Revoke**. With realtime on, the screen drops back to pairing within seconds; without it, within about a minute.

## 12. Set up the GitHub deploy pipeline

**Who:** infrastructure operator, with a GitHub repository admin.

`ci.yml` runs on every push to `main` and on pull requests: typecheck, tests, build, and Bicep build and lint. It never deploys.

`deploy.yml` runs only when started by hand (**Actions → deploy → Run workflow**). It deploys application code with `azd deploy`. Infrastructure changes stay with an operator running `azd provision` (step 4), so the pipeline identity never needs rights to create role assignments.

1. **Create the deploy identity** with a federated credential that trusts only the `production` environment:

   ```bash
   DEPLOY_APP_ID="$(az ad app create --display-name branchsuite-github-deploy --query appId -o tsv)"
   az ad sp create --id "$DEPLOY_APP_ID"
   az ad app federated-credential create --id "$DEPLOY_APP_ID" --parameters '{
     "name": "github-production",
     "issuer": "https://token.actions.githubusercontent.com",
     "subject": "repo:<org>/<repo>:environment:production",
     "audiences": ["api://AzureADTokenExchange"]
   }'
   ```

2. **Grant it the least roles it needs:**

   ```bash
   RG_ID="$(az group show -n rg-branchsuite-prod --query id -o tsv)"
   FUNC_ID="$(az functionapp show -g rg-branchsuite-prod -n "$(azd env get-value AZURE_FUNCTION_APP_NAME)" --query id -o tsv)"
   SWA_ID="$(az staticwebapp show -g rg-branchsuite-prod -n "$(azd env get-value AZURE_STATIC_WEB_APP_NAME)" --query id -o tsv)"
   az role assignment create --assignee "$DEPLOY_APP_ID" --role Reader --scope "$RG_ID"
   az role assignment create --assignee "$DEPLOY_APP_ID" --role "Website Contributor" --scope "$FUNC_ID"
   az role assignment create --assignee "$DEPLOY_APP_ID" --role Contributor --scope "$SWA_ID"
   ```

3. **Create the GitHub environment `production`** (Settings → Environments):
   - Required reviewers: at least one person other than the person who starts the run.
   - Deployment branches: `main` only.
   - Environment variables (not secrets; they are IDs): `AZURE_CLIENT_ID` (= `DEPLOY_APP_ID`), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_ENV_NAME` (`prod`), `AZURE_LOCATION`, `AZURE_RESOURCE_GROUP`.

4. Start a run. After approval it runs tests, deploys, checks that the tenant ID was stamped into the SWA config, and calls `/api/health`.

## 13. Pilot checklist

Run this with one branch before you add more. The checklist reuses the proof of concept's pilot practice.

- [ ] **Tag test messages.** Send test emails to the branch mailbox with a unique tag in the subject, for example `[BS-PILOT-0412-001]`. Check that each one becomes exactly one task, or is filtered with a visible reason.
- [ ] **Replay for idempotency.** Mark a processed test message unread, or move it out of and back into the Inbox, so Graph delta returns it again. Check that no duplicate task, order or receipt appears.
- [ ] **Staffing request to draft order.** Send a request with an exact headcount for an account with an unambiguous route. Check that one draft order appears and that a replay does not create a second one.
- [ ] **Team reply.** Reply from the shared mailbox to a client thread. Check that the task closes as `reply_closed` only when the reply resolves the request.
- [ ] **Around branch-local midnight.** Look at the board and the wall a few minutes before and after midnight in the branch time zone (not UTC, not your own time zone). Check "today", "starting soon" and order ages.
- [ ] **Concurrent edits.** Two recruiters fill lines on the same order at the same time. Check that both writes survive.
- [ ] **Wall privacy.** On the paired wall, check that no client name, pay (unless the branch chose it), location, note, initials or personal task appears. Revoke the display and check that it stops.
- [ ] **Network loss.** Unplug the wall's network for 2 minutes. Check that it shows "Reconnecting…" and recovers on its own.
- [ ] **Access.** A member cannot see account contacts. A user from another branch cannot open this branch. A tenant user outside the sign-in group cannot sign in.
- [ ] **Add branches only when the mailbox mapping is unambiguous.** One mailbox maps to one branch. Resolve brand or shared-mailbox overlaps before onboarding the next branch.

## 14. Rollback

| What | How |
| --- | --- |
| Application code | Run `deploy.yml` from the last good tag or commit (**Run workflow → Use workflow from**). Tag every production deployment (`git tag deploy-YYYYMMDD-HHMM`). |
| Infrastructure | Check out the last good commit and run `azd provision`. Bicep deploys in incremental mode and never deletes resources; remove an unwanted resource by hand. |
| Data | Cosmos DB continuous backup allows point-in-time restore for the last 7 days. Restore into a **new** account (portal → Cosmos DB → Point In Time Restore), check it, then change `COSMOS_ENDPOINT` on the Function App and add the Function App identity's data role on the new account. |
| Wall HMAC secret | Key Vault keeps old secret versions. To roll back, enable the earlier version or set `AZURE_WALL_HMAC_SECRET` to its value and provision. Restart the Function App so it rereads the secret. |
| Sign-in secret | Run `setup-entra-auth.sh --rotate`. |
| Deleted Key Vault | Soft delete keeps it for 90 days: `az keyvault recover --name kv-<token>`. Purge protection prevents permanent deletion during that time. |

## 15. Cost notes

Approximate US list prices at the time of writing. Check the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) for your region and agreement.

| Resource | SKU | Cost driver | Rough monthly cost for one to five branches |
| --- | --- | --- | --- |
| Static Web Apps | Standard | Flat per app | about $9 |
| Azure Functions | Flex Consumption FC1 | Executions and GB-seconds beyond the monthly free grant; no always-ready instances | a few dollars (the mail timer runs about 21,600 times a month) |
| Cosmos DB | Serverless | Request units and stored GB | a few dollars |
| Azure OpenAI | Model deployment (default `gpt-4.1-mini`, Data Zone) | Input and output tokens; one call per actionable message | low tens of dollars at a few hundred emails a day |
| Web PubSub | Standard_S1, 1 unit | Flat per unit (1,000 concurrent connections) | about $50 |
| Key Vault | Standard | Operations | under $1 |
| Storage | Standard LRS | Host leases and deployment package | under $1 |
| Log Analytics + App Insights | Pay as you go | GB ingested beyond the free allowance; 30-day retention | depends on volume; sampling is on |
| Private networking | 6 private endpoints + 6 private DNS zones | Per endpoint-hour and per zone | about $45 to $50 |

Savings for test environments: `ENABLE_PRIVATE_NETWORKING=false` and `AZURE_WEB_PUBSUB_SKU=Free_F1`. Do not use these settings in production.

## 16. Reference

### Function App settings (set by Bicep)

| Setting | Value |
| --- | --- |
| `DATA_MODE` / `AUTH_MODE` / `AI_MODE` | `cosmos` / `swa` / `azure` |
| `COSMOS_ENDPOINT`, `COSMOS_DATABASE` | Cosmos DB account endpoint, `branchsuite` |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | OpenAI endpoint, `triage` |
| `WEB_PUBSUB_ENDPOINT`, `WEB_PUBSUB_HUB` | Web PubSub endpoint, `branchsuite` |
| `KEY_VAULT_URI` | Key Vault URI (the API reads `wall-hmac-secret`) |
| `TENANT_DOMAINS`, `BOOTSTRAP_ADMIN_EMAILS` | From the azd environment |
| `FEATURE_PIPELINE`, `FEATURE_PERSONAL_MAIL` | From the azd environment |
| `AzureWebJobsStorage__accountName` | Storage account (identity-based) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING`, `APPLICATIONINSIGHTS_AUTHENTICATION_STRING` | App Insights; `Authorization=AAD` |

To change an application setting, change the azd value and run `azd provision`. Settings changed by hand in the portal are overwritten on the next provision.

### Static Web App settings (set by `setup-entra-auth.sh`)

`AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`. `azd provision` leaves them unchanged unless you pass both `aadClientId` and `aadClientSecret` as parameters.

### Role assignments for the Function App identity (set by Bicep)

| Scope | Role |
| --- | --- |
| Cosmos DB account | Cosmos DB Built-in Data Contributor (data-plane role `00000000-0000-0000-0000-000000000002`) |
| Storage account | Storage Blob Data Owner, Storage Queue Data Contributor, Storage Table Data Contributor |
| Azure OpenAI | Cognitive Services OpenAI User |
| Web PubSub | Web PubSub Service Owner |
| Key Vault | Key Vault Secrets User |
| Application Insights | Monitoring Metrics Publisher |
| Exchange Online (step 9) | Application Mail.Read, scoped to `BranchSuite-Mailboxes` members |

### Validate the Bicep locally

```bash
az bicep build --file infra/main.bicep --stdout > /dev/null
az bicep lint --file infra/main.bicep
```

`infra/bicepconfig.json` turns the security-relevant linter rules into errors.
