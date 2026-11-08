// Data-plane role assignments. The Function App identity gets the least set of built-in roles
// it needs; the deploying principal optionally gets Cosmos DB data access for support work.
// Role definition IDs are Azure built-in roles (verified against the built-in roles reference).

@description('Function App managed identity principal ID.')
param functionPrincipalId string

@description('Deploying principal ID (azd AZURE_PRINCIPAL_ID). Empty skips deployer grants.')
param deployerPrincipalId string = ''

@description('Grant the deploying principal Cosmos DB Built-in Data Contributor.')
param grantDeployerDataAccess bool = false

param cosmosAccountName string
param storageAccountName string
param openAiAccountName string
param webPubSubName string
param keyVaultName string
param appInsightsName string

@description('App data (media) storage account.')
param mediaStorageAccountName string

@description('Whiteboard media container in the media storage account.')
param mediaContainerName string

var roles = {
  storageBlobDataOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  storageQueueDataContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  storageTableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  cognitiveServicesOpenAiUser: '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
  webPubSubServiceOwner: '12cf5a90-567b-43ae-8102-96cf46c7d9b4'
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  monitoringMetricsPublisher: '3913510d-42f4-4e42-8a64-420c390055eb'
}
// Cosmos DB data-plane role (not Azure RBAC): Cosmos DB Built-in Data Contributor.
var cosmosDataContributor = '00000000-0000-0000-0000-000000000002'

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' existing = {
  name: cosmosAccountName
}
resource storage 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: storageAccountName
}
resource openAi 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: openAiAccountName
}
resource webPubSub 'Microsoft.SignalRService/webPubSub@2024-03-01' existing = {
  name: webPubSubName
}
resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: keyVaultName
}
resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource mediaStorage 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: mediaStorageAccountName
}
resource mediaBlobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' existing = {
  parent: mediaStorage
  name: 'default'
}
resource mediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' existing = {
  parent: mediaBlobService
  name: mediaContainerName
}

// Read and write whiteboard images, scoped to the one container (not the account). Contributor,
// not Owner: the API never needs to change ACLs or blob ownership.
resource mediaAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(mediaContainer.id, functionPrincipalId, roles.storageBlobDataContributor)
  scope: mediaContainer
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

var storageRoles = [roles.storageBlobDataOwner, roles.storageQueueDataContributor, roles.storageTableDataContributor]

resource storageAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for roleId in storageRoles: {
    name: guid(storage.id, functionPrincipalId, roleId)
    scope: storage
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
      principalId: functionPrincipalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource openAiAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openAi.id, functionPrincipalId, roles.cognitiveServicesOpenAiUser)
  scope: openAi
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.cognitiveServicesOpenAiUser)
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource webPubSubAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webPubSub.id, functionPrincipalId, roles.webPubSubServiceOwner)
  scope: webPubSub
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.webPubSubServiceOwner)
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource keyVaultAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, functionPrincipalId, roles.keyVaultSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource appInsightsAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, functionPrincipalId, roles.monitoringMetricsPublisher)
  scope: appInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.monitoringMetricsPublisher)
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource cosmosFunctionAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmos
  name: guid(cosmos.id, functionPrincipalId, cosmosDataContributor)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributor}'
    principalId: functionPrincipalId
    scope: cosmos.id
  }
}

resource cosmosDeployerAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = if (grantDeployerDataAccess && !empty(deployerPrincipalId)) {
  parent: cosmos
  name: guid(cosmos.id, deployerPrincipalId, cosmosDataContributor)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributor}'
    principalId: deployerPrincipalId
    scope: cosmos.id
  }
}
