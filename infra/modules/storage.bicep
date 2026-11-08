// Storage account for the Function App host (AzureWebJobsStorage) and the Flex Consumption
// deployment package. Shared key access is disabled: the host and the deployment both use the
// Function App's managed identity.

@description('Azure region.')
param location string

@description('Tags applied to every resource.')
param tags object

@description('Storage account name (3-24 lowercase letters and digits).')
param accountName string

@description('Blob container that holds the Flex Consumption deployment package.')
param deploymentContainerName string

@description('When false, the account accepts traffic only through private endpoints.')
param publicNetworkAccess bool

resource storage 'Microsoft.Storage/storageAccounts@2025-06-01' = {
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
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled'
    networkAcls: {
      defaultAction: publicNetworkAccess ? 'Allow' : 'Deny'
      bypass: 'AzureServices'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' = {
  parent: storage
  name: 'default'
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' = {
  parent: blobService
  name: deploymentContainerName
  properties: { publicAccess: 'None' }
}

output accountName string = storage.name
output accountId string = storage.id
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output deploymentContainerName string = deploymentContainer.name
