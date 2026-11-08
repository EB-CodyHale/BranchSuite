// Private storage for application data: morning whiteboard screenshots (container
// `whiteboard-media`). Separate from the Functions host account (storage.bicep) so the host's
// broader roles (Blob Data Owner, queues, tables) never reach application media, and so retention
// and diagnostics apply to app data only.
//
// - No shared keys, no anonymous blob access, no SAS: the API reads and writes with the Function
//   App's managed identity (Storage Blob Data Contributor on the container, see roles.bicep) and is
//   the only way bytes reach a browser or a wall display.
// - Lifecycle management deletes blobs 90 days after creation (WHITEBOARD_LIMITS.mediaRetentionDays
//   in packages/shared/src/whiteboard.ts). Soft delete keeps a deleted blob 7 more days.

@description('Azure region.')
param location string

@description('Tags applied to every resource.')
param tags object

@description('Storage account name (3-24 lowercase letters and digits).')
param accountName string

@description('Blob container for whiteboard images (MEDIA_CONTAINER in apps/api/src/config.ts).')
param containerName string = 'whiteboard-media'

@description('When false, the account accepts traffic only through private endpoints.')
param publicNetworkAccess bool

@description('Days after creation when a whiteboard image is deleted.')
@minValue(1)
param retentionDays int = 90

@description('Soft delete retention for blobs and containers, in days.')
@minValue(1)
@maxValue(365)
param softDeleteDays int = 7

@description('Log Analytics workspace for blob access logs.')
param logAnalyticsId string

resource account 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    allowedCopyScope: 'AAD'
    defaultToOAuthAuthentication: true
    isLocalUserEnabled: false
    isSftpEnabled: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled'
    networkAcls: {
      defaultAction: publicNetworkAccess ? 'Allow' : 'Deny'
      // Nothing but the API (through the private endpoint) needs data access; lifecycle
      // management and diagnostics are platform features that do not use the network ACL.
      bypass: 'None'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: softDeleteDays
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: softDeleteDays
    }
  }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' = {
  parent: blobService
  name: containerName
  properties: { publicAccess: 'None' }
}

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2025-06-01' = {
  parent: account
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          // Rule names allow letters and digits only.
          name: 'deleteWhiteboardMedia'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['${container.name}/']
            }
            actions: {
              baseBlob: {
                delete: { daysAfterCreationGreaterThan: retentionDays }
              }
            }
          }
        }
      ]
    }
  }
}

// The newest GA version (2016-09-01) lacks categoryGroup; this preview is the documented current one.
#disable-next-line use-recent-api-versions
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: blobService
  properties: {
    workspaceId: logAnalyticsId
    // StorageRead, StorageWrite, StorageDelete: every upload and every image read, with the caller identity.
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
  }
}

output accountName string = account.name
output accountId string = account.id
// Ends with a slash; apps/api/src/config.ts strips it.
output blobEndpoint string = account.properties.primaryEndpoints.blob
output containerName string = container.name
