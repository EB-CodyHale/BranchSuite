// Key Vault (RBAC authorization, soft delete, purge protection) holding the wall HMAC secret
// used for wall order keys and pairing-token encryption.

@description('Azure region.')
param location string

@description('Tags applied to every resource.')
param tags object

@description('Key Vault name.')
param name string

@description('When false, the vault accepts traffic only through private endpoints.')
param publicNetworkAccess bool

@description('Value of the wall-hmac-secret secret (at least 32 characters).')
@secure()
@minLength(32)
param wallHmacSecret string

@description('Log Analytics workspace for audit logs.')
param logAnalyticsId string

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled'
    networkAcls: {
      defaultAction: publicNetworkAccess ? 'Allow' : 'Deny'
      bypass: 'AzureServices'
    }
  }
}

// The secret name matches WALL_SECRET_NAME in apps/api/src/config.ts.
resource wallSecret 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = {
  parent: vault
  name: 'wall-hmac-secret'
  properties: {
    value: wallHmacSecret
    contentType: 'text/plain'
  }
}

// The newest GA version (2016-09-01) lacks categoryGroup; this preview is the documented current one.
#disable-next-line use-recent-api-versions
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: vault
  properties: {
    workspaceId: logAnalyticsId
    logs: [{ categoryGroup: 'audit', enabled: true }]
  }
}

output name string = vault.name
output id string = vault.id
output uri string = vault.properties.vaultUri
