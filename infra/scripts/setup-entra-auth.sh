#!/usr/bin/env bash
# Creates or updates the single-tenant Entra app registration that Azure Static Web Apps uses
# for BranchSuite sign-in, and stores its credentials as SWA app settings.
#
# Idempotent: a re-run updates redirect URIs and settings, and creates a new client secret only
# when the SWA settings are missing or point at another app, or when --rotate is given.
#
# Requires: az CLI signed in (az login) as a user who can create app registrations, assign
# users and groups to enterprise apps, and write SWA app settings. Group assignment needs
# Microsoft Entra ID P1 or P2.
#
# Usage:
#   infra/scripts/setup-entra-auth.sh --resource-group <rg> --swa-name <name> --group-id <objectId>
#       [--display-name BranchSuite] [--extra-host branchsuite.contoso.com]... [--secret-days 180]
#       [--rotate] [--grant-consent]
#
# Values from `azd env get-values` work: AZURE_RESOURCE_GROUP and AZURE_STATIC_WEB_APP_NAME.
set -euo pipefail

GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"
USER_READ_SCOPE_ID="e1fe6dd8-ba31-4d61-89e7-88639da4683d"   # Microsoft Graph delegated User.Read
DEFAULT_ACCESS_ROLE_ID="00000000-0000-0000-0000-000000000000" # "Default Access" app role
SECRET_PREFIX="swa-signin"

resource_group="${AZURE_RESOURCE_GROUP:-}"
swa_name="${AZURE_STATIC_WEB_APP_NAME:-}"
group_id=""
display_name="BranchSuite"
secret_days=180
rotate=false
grant_consent=false
extra_hosts=()

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resource-group) resource_group="$2"; shift 2 ;;
    --swa-name) swa_name="$2"; shift 2 ;;
    --group-id) group_id="$2"; shift 2 ;;
    --display-name) display_name="$2"; shift 2 ;;
    --extra-host) extra_hosts+=("$2"); shift 2 ;;
    --secret-days) secret_days="$2"; shift 2 ;;
    --rotate) rotate=true; shift ;;
    --grant-consent) grant_consent=true; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown argument: $1" >&2; usage 2 ;;
  esac
done

[[ -n "$resource_group" ]] || die "--resource-group is required"
[[ -n "$swa_name" ]] || die "--swa-name is required"
[[ "$group_id" =~ ^[0-9a-fA-F-]{36}$ ]] || die "--group-id must be the object ID of the security group allowed to sign in"
[[ "$secret_days" =~ ^[0-9]+$ ]] && (( secret_days >= 1 && secret_days <= 365 )) || die "--secret-days must be 1-365"
command -v az >/dev/null || die "az CLI not found"

tenant_id="$(az account show --query tenantId -o tsv)"
swa_host="$(az staticwebapp show -n "$swa_name" -g "$resource_group" --query defaultHostname -o tsv)"
[[ -n "$swa_host" ]] || die "Static Web App $swa_name not found in $resource_group"

redirect_uris=("https://${swa_host}/.auth/login/aad/callback")
for host in "${extra_hosts[@]}"; do redirect_uris+=("https://${host}/.auth/login/aad/callback"); done
log "Tenant $tenant_id; redirect URIs: ${redirect_uris[*]}"

# ---------- app registration ----------
app_id="$(az ad app list --display-name "$display_name" --query "[?signInAudience=='AzureADMyOrg'].appId | [0]" -o tsv)"
if [[ -z "$app_id" ]]; then
  log "Creating app registration '$display_name'"
  app_id="$(az ad app create \
    --display-name "$display_name" \
    --sign-in-audience AzureADMyOrg \
    --web-redirect-uris "${redirect_uris[@]}" \
    --enable-id-token-issuance true \
    --query appId -o tsv)"
else
  log "Updating app registration '$display_name' ($app_id)"
  az ad app update --id "$app_id" \
    --web-redirect-uris "${redirect_uris[@]}" \
    --enable-id-token-issuance true
fi

# Single tenant, no group claims (authorization comes from the BranchSuite roster, not token
# groups), front-channel logout through SWA, and only User.Read for sign-in.
az ad app update --id "$app_id" \
  --sign-in-audience AzureADMyOrg \
  --set groupMembershipClaims=None \
  --set "web.logoutUrl=https://${swa_host}/.auth/logout/aad/callback"
if ! az ad app permission list --id "$app_id" --query "[?resourceAppId=='$GRAPH_APP_ID'].resourceAccess[] | [?id=='$USER_READ_SCOPE_ID'] | [0].id" -o tsv | grep -q .; then
  az ad app permission add --id "$app_id" --api "$GRAPH_APP_ID" --api-permissions "${USER_READ_SCOPE_ID}=Scope" >/dev/null
fi
if [[ "$grant_consent" == true ]]; then
  log "Granting tenant-wide admin consent for User.Read"
  az ad app permission admin-consent --id "$app_id"
fi

# ---------- enterprise app: assignment required ----------
sp_id="$(az ad sp list --filter "appId eq '$app_id'" --query "[0].id" -o tsv)"
if [[ -z "$sp_id" ]]; then
  log "Creating service principal"
  sp_id="$(az ad sp create --id "$app_id" --query id -o tsv)"
fi
az ad sp update --id "$sp_id" --set appRoleAssignmentRequired=true
log "Assignment required is on; only assigned users and groups can sign in"

assigned="$(az rest --method GET \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/${sp_id}/appRoleAssignedTo" \
  --query "length(value[?principalId=='${group_id}'])" -o tsv)"
if [[ "$assigned" == "0" ]]; then
  log "Assigning group $group_id to the enterprise app"
  az rest --method POST \
    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/${sp_id}/appRoleAssignedTo" \
    --headers "Content-Type=application/json" \
    --body "{\"principalId\":\"${group_id}\",\"resourceId\":\"${sp_id}\",\"appRoleId\":\"${DEFAULT_ACCESS_ROLE_ID}\"}" >/dev/null
else
  log "Group $group_id is already assigned"
fi

# ---------- client secret -> SWA app settings ----------
current_client_id="$(az staticwebapp appsettings list -n "$swa_name" -g "$resource_group" --query "properties.AAD_CLIENT_ID" -o tsv 2>/dev/null || true)"
current_secret_set="$(az staticwebapp appsettings list -n "$swa_name" -g "$resource_group" --query "properties.AAD_CLIENT_SECRET != null" -o tsv 2>/dev/null || echo false)"

if [[ "$rotate" == false && "$current_client_id" == "$app_id" && "$current_secret_set" == "true" ]]; then
  log "SWA already has AAD_CLIENT_ID/AAD_CLIENT_SECRET for this app; use --rotate to issue a new secret"
else
  end_date="$(date -u -d "+${secret_days} days" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+"${secret_days}"d +%Y-%m-%dT%H:%M:%SZ)"
  secret_name="${SECRET_PREFIX}-$(date -u +%Y%m%d%H%M%S)"
  log "Creating client secret $secret_name (expires $end_date)"
  secret="$(az ad app credential reset --id "$app_id" --append \
    --display-name "$secret_name" --end-date "$end_date" --query password -o tsv)"
  new_key_id="$(az ad app credential list --id "$app_id" --query "[?displayName=='$secret_name'].keyId | [0]" -o tsv)"

  az staticwebapp appsettings set -n "$swa_name" -g "$resource_group" \
    --setting-names "AAD_CLIENT_ID=${app_id}" "AAD_CLIENT_SECRET=${secret}" >/dev/null
  unset secret
  log "Stored AAD_CLIENT_ID and AAD_CLIENT_SECRET in the Static Web App settings"

  # Remove older sign-in secrets that this script created, so only one is valid.
  for key_id in $(az ad app credential list --id "$app_id" \
      --query "[?starts_with(displayName, '${SECRET_PREFIX}-') && keyId!='${new_key_id}'].keyId" -o tsv); do
    log "Deleting old client secret $key_id"
    az ad app credential delete --id "$app_id" --key-id "$key_id"
  done
fi

cat <<EOF

Done.
  App (client) ID : $app_id
  Tenant ID       : $tenant_id
  Sign-in URL     : https://${swa_host}/.auth/login/aad
Next: deploy the web app so staticwebapp.config.json carries tenant $tenant_id (azd deploy web).
Rotate the secret before it expires: re-run this script with --rotate.
EOF
