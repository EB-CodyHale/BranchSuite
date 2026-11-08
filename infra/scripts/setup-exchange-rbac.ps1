<#
.SYNOPSIS
  Grants the BranchSuite Function App's managed identity read access to exactly the mailboxes in
  one mail-enabled security group, using Exchange Online RBAC for Applications.

.DESCRIPTION
  The Function App reads mail through Microsoft Graph with its system-assigned managed identity.
  Instead of a tenant-wide Graph Mail.Read consent, this script:
    1. Registers the managed identity as an Exchange Online service principal.
    2. Creates a management scope that matches members of the mailbox group.
    3. Assigns the "Application Mail.Read" role to the identity, limited to that scope.
  Then Test-ServicePrincipalAuthorization shows which mailboxes the identity can read.

  WARNING: Do NOT grant the Microsoft Graph "Mail.Read" application permission to this identity
  (or to any BranchSuite app) in Microsoft Entra ID. Entra application permissions apply to every
  mailbox in the tenant and are evaluated in addition to Exchange RBAC, so they would bypass the
  scope that this script sets. If such a grant exists, remove it.

  The script is idempotent: it creates only what is missing. Permission changes can take 30
  minutes to 2 hours to reach Graph, because Exchange caches RBAC data.

.PARAMETER AppId
  Application (client) ID of the Function App's managed identity. Find it with:
  az ad sp show --id <AZURE_FUNCTION_PRINCIPAL_ID> --query appId -o tsv

.PARAMETER ObjectId
  Object ID of the managed identity's service principal (enterprise app), the value of
  AZURE_FUNCTION_PRINCIPAL_ID from `azd env get-values`.

.PARAMETER DisplayName
  Display name for the Exchange service principal record.

.PARAMETER GroupIdentity
  Mail-enabled security group whose members BranchSuite can read. Default: BranchSuite-Mailboxes.

.PARAMETER CreateGroup
  Create the group when it does not exist. Requires -GroupPrimarySmtpAddress.

.PARAMETER GroupPrimarySmtpAddress
  Address for a new group, for example branchsuite-mailboxes@contoso.com.

.PARAMETER AddMailbox
  Mailboxes (shared or user) to add to the group in this run.

.PARAMETER TestMailbox
  Mailboxes to check with Test-ServicePrincipalAuthorization after the setup. Include one that
  is in the group (expect InScope True) and one that is not (expect InScope False).

.EXAMPLE
  ./setup-exchange-rbac.ps1 -AppId 1b2c... -ObjectId 9f8e... -CreateGroup `
    -GroupPrimarySmtpAddress branchsuite-mailboxes@contoso.com `
    -AddMailbox branch-0412@contoso.com -TestMailbox branch-0412@contoso.com,ceo@contoso.com
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$AppId,
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$ObjectId,
  [string]$DisplayName = 'BranchSuite Function App',
  [string]$GroupIdentity = 'BranchSuite-Mailboxes',
  [switch]$CreateGroup,
  [string]$GroupPrimarySmtpAddress,
  [string]$ScopeName = 'BranchSuite mailboxes',
  [string[]]$AddMailbox = @(),
  [string[]]$TestMailbox = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RoleName = 'Application Mail.Read'

if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
  throw 'Install the ExchangeOnlineManagement module first: Install-Module ExchangeOnlineManagement -Scope CurrentUser'
}
Import-Module ExchangeOnlineManagement
if (-not (Get-ConnectionInformation | Where-Object { $_.State -eq 'Connected' })) {
  Connect-ExchangeOnline -ShowBanner:$false
}

# ---------- 1. mailbox group ----------
$group = Get-DistributionGroup -Identity $GroupIdentity -ErrorAction SilentlyContinue
if (-not $group) {
  if (-not $CreateGroup) { throw "Group '$GroupIdentity' not found. Re-run with -CreateGroup -GroupPrimarySmtpAddress <address>." }
  if (-not $GroupPrimarySmtpAddress) { throw '-CreateGroup needs -GroupPrimarySmtpAddress.' }
  if ($PSCmdlet.ShouldProcess($GroupIdentity, 'Create mail-enabled security group')) {
    # Hidden from the address book and closed to joins: only Exchange admins change membership.
    $group = New-DistributionGroup -Name $GroupIdentity -Type Security -PrimarySmtpAddress $GroupPrimarySmtpAddress `
      -MemberJoinRestriction Closed -MemberDepartRestriction Closed
    Set-DistributionGroup -Identity $group.Identity -HiddenFromAddressListsEnabled $true -RequireSenderAuthenticationEnabled $true
  }
}
if ($group.RecipientTypeDetails -ne 'MailUniversalSecurityGroup') {
  throw "'$GroupIdentity' is $($group.RecipientTypeDetails); a mail-enabled security group is required."
}
$groupDn = $group.DistinguishedName
Write-Host "Mailbox group: $($group.PrimarySmtpAddress) ($groupDn)"

foreach ($mailbox in $AddMailbox) {
  $isMember = Get-DistributionGroupMember -Identity $group.Identity -ResultSize Unlimited |
    Where-Object { $_.PrimarySmtpAddress -eq $mailbox }
  if ($isMember) { Write-Host "Already a member: $mailbox"; continue }
  if ($PSCmdlet.ShouldProcess($mailbox, "Add to $GroupIdentity")) {
    Add-DistributionGroupMember -Identity $group.Identity -Member $mailbox -BypassSecurityGroupManagerCheck
    Write-Host "Added: $mailbox"
  }
}

# ---------- 2. Exchange service principal for the managed identity ----------
$sp = Get-ServicePrincipal -Identity $AppId -ErrorAction SilentlyContinue
if (-not $sp -and $PSCmdlet.ShouldProcess($AppId, 'Register Exchange service principal')) {
  $sp = New-ServicePrincipal -AppId $AppId -ObjectId $ObjectId -DisplayName $DisplayName
}
Write-Host "Service principal: $DisplayName (AppId $AppId)"

# ---------- 3. management scope limited to group members ----------
$filter = "MemberOfGroup -eq '$groupDn'"
$scope = Get-ManagementScope -Identity $ScopeName -ErrorAction SilentlyContinue
if (-not $scope) {
  if ($PSCmdlet.ShouldProcess($ScopeName, 'Create management scope')) {
    $scope = New-ManagementScope -Name $ScopeName -RecipientRestrictionFilter $filter
  }
} elseif ($scope.RecipientFilter -ne $filter) {
  if ($PSCmdlet.ShouldProcess($ScopeName, 'Update management scope filter')) {
    Set-ManagementScope -Identity $ScopeName -RecipientRestrictionFilter $filter
  }
}
Write-Host "Management scope: $ScopeName -> $filter"

# ---------- 4. scoped role assignment ----------
$assignee = if ($sp) { $sp.Identity } else { $AppId }
$assignment = Get-ManagementRoleAssignment -Role $RoleName -RoleAssignee $assignee -ErrorAction SilentlyContinue |
  Where-Object { $_.CustomResourceScope -eq $ScopeName }
if (-not $assignment -and $PSCmdlet.ShouldProcess($AppId, "Assign '$RoleName' scoped to '$ScopeName'")) {
  New-ManagementRoleAssignment -App $AppId -Role $RoleName -CustomResourceScope $ScopeName | Out-Null
}
$unscoped = Get-ManagementRoleAssignment -Role $RoleName -RoleAssignee $assignee -ErrorAction SilentlyContinue |
  Where-Object { -not $_.CustomResourceScope }
if ($unscoped) {
  Write-Warning "An unscoped '$RoleName' assignment exists for $AppId and grants every mailbox. Remove it: Remove-ManagementRoleAssignment -Identity '$($unscoped.Name)'"
}
Write-Host "Role assignment: $RoleName for $AppId, scope $ScopeName"

# ---------- 5. verification ----------
foreach ($mailbox in $TestMailbox) {
  Test-ServicePrincipalAuthorization -Identity $AppId -Resource $mailbox |
    Format-Table RoleName, GrantedPermissions, AllowedResourceScope, ScopeType, InScope -AutoSize
}

Write-Host @"

Next steps:
  - Add a mailbox later:   Add-DistributionGroupMember -Identity '$GroupIdentity' -Member <mailbox>
    (works for shared and user mailboxes; then create the mailbox record in BranchSuite Setup)
  - Remove a mailbox:      Remove-DistributionGroupMember -Identity '$GroupIdentity' -Member <mailbox>
  - Check access:          Test-ServicePrincipalAuthorization -Identity $AppId -Resource <mailbox>
  - Allow 30 minutes to 2 hours before Graph reflects a change.
  - Never grant Graph Mail.Read (application) in Entra ID; it would bypass this scope.
"@
