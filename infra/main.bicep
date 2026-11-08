// BranchSuite 2: tenant-contained Azure infrastructure (see docs/ARCHITECTURE.md and
// docs/DEPLOYMENT.md). Deployed by `azd provision` at resource group scope.
targetScope = 'resourceGroup'

// ---------- azd parameters ----------

@minLength(1)
@maxLength(64)
@description('azd environment name; feeds resource names and the azd-env-name tag.')
param environmentName string

@minLength(1)
@description('Primary region for all resources except Static Web Apps (and OpenAI when openAiLocation is set).')
param location string

@description('Object ID of the deploying user or service principal (azd sets AZURE_PRINCIPAL_ID).')
param principalId string = ''

// ---------- application settings ----------

@description('Comma-separated tenant email domains, treated as internal senders by mail intake.')
param tenantDomains string

@description('Comma-separated emails that become admins on first sign-in, before any roster exists.')
param bootstrapAdminEmails string

@description('Enable the candidate pipeline feature (FEATURE_PIPELINE).')
param featurePipeline bool = true

@description('Enable opt-in personal mailbox intake (FEATURE_PERSONAL_MAIL).')
param featurePersonalMail bool = true

@description('Wall HMAC secret stored in Key Vault. azd generates it once per environment (infra/scripts/ensure-env.mjs).')
@secure()
@minLength(32)
param wallHmacSecret string

// ---------- networking ----------

@description('Put Cosmos DB, OpenAI, Key Vault and Storage behind private endpoints and disable their public access.')
param enablePrivateNetworking bool = true

// ---------- regions and SKUs ----------

@description('Static Web Apps region (supported: westus2, centralus, eastus2, westeurope, eastasia).')
@allowed(['westus2', 'centralus', 'eastus2', 'westeurope', 'eastasia'])
param staticWebAppLocation string = 'eastus2'

@description('Azure OpenAI region; empty uses the primary region. The model and SKU must be available there.')
param openAiLocation string = ''

@description('Azure OpenAI model. Use the newest model that your tenant has approved.')
param openAiModelName string = 'gpt-4.1-mini'

@description('Azure OpenAI model version.')
param openAiModelVersion string = '2025-04-14'

@description('Azure OpenAI deployment name (AZURE_OPENAI_DEPLOYMENT).')
param openAiDeploymentName string = 'triage'

@description('Azure OpenAI data-plane API version the API uses (AZURE_OPENAI_API_VERSION).')
param openAiApiVersion string = '2024-10-21'

@description('Azure OpenAI deployment SKU. DataZoneStandard keeps processing in the data zone (US or EU).')
@allowed(['Standard', 'DataZoneStandard', 'GlobalStandard'])
param openAiDeploymentSku string = 'DataZoneStandard'

@description('Azure OpenAI capacity in thousands of tokens per minute.')
@minValue(1)
param openAiDeploymentCapacity int = 30

@description('Web PubSub SKU.')
@allowed(['Free_F1', 'Standard_S1', 'Premium_P1'])
param webPubSubSku string = 'Standard_S1'

// ---------- sign-in (optional; normally set by infra/scripts/setup-entra-auth.sh) ----------

@description('Entra app registration client ID for Static Web Apps sign-in. Empty keeps the current value.')
param aadClientId string = ''

@description('Entra app registration client secret for Static Web Apps sign-in. Empty keeps the current value.')
@secure()
param aadClientSecret string = ''

@description('Grant the deploying principal Cosmos DB data access (support and troubleshooting only).')
param grantDeployerDataAccess bool = false

// ---------- naming ----------

var resourceToken = toLower(uniqueString(subscription().id, resourceGroup().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }
var databaseName = 'branchsuite'
var webPubSubHub = 'branchsuite'
var functionAppName = 'func-${resourceToken}'
var names = {
  logAnalytics: 'log-${resourceToken}'
  appInsights: 'appi-${resourceToken}'
  cosmos: 'cosmos-${resourceToken}'
  storage: 'st${resourceToken}'
  mediaStorage: 'stmedia${resourceToken}'
  plan: 'plan-${resourceToken}'
  openAi: 'oai-${resourceToken}'
  webPubSub: 'wps-${resourceToken}'
  keyVault: 'kv-${resourceToken}'
  staticWebApp: 'swa-${resourceToken}'
  vnet: 'vnet-${resourceToken}'
}
// Flex Consumption reads the package from a container named for the app.
var deploymentContainerName = 'app-package-${take(functionAppName, 32)}-${take(resourceToken, 7)}'
// Whiteboard screenshots (apps/api/src/media/store.ts); private, served only through the API.
var mediaContainerName = 'whiteboard-media'
var publicAccess = !enablePrivateNetworking

// ---------- modules ----------

module network 'modules/network.bicep' = if (enablePrivateNetworking) {
  name: 'network'
  params: {
    location: location
    tags: tags
    vnetName: names.vnet
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    tags: tags
    logAnalyticsName: names.logAnalytics
    appInsightsName: names.appInsights
  }
}

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: {
    location: location
    tags: tags
    accountName: names.cosmos
    databaseName: databaseName
    publicNetworkAccess: publicAccess
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    tags: tags
    accountName: names.storage
    deploymentContainerName: deploymentContainerName
    publicNetworkAccess: publicAccess
  }
}

module mediaStorage 'modules/media-storage.bicep' = {
  name: 'media-storage'
  params: {
    location: location
    tags: tags
    accountName: names.mediaStorage
    containerName: mediaContainerName
    publicNetworkAccess: publicAccess
    logAnalyticsId: monitoring.outputs.logAnalyticsId
  }
}

module openAi 'modules/openai.bicep' = {
  name: 'openai'
  params: {
    location: empty(openAiLocation) ? location : openAiLocation
    tags: tags
    accountName: names.openAi
    publicNetworkAccess: publicAccess
    deploymentName: openAiDeploymentName
    modelName: openAiModelName
    modelVersion: openAiModelVersion
    deploymentSku: openAiDeploymentSku
    deploymentCapacity: openAiDeploymentCapacity
  }
}

module webPubSub 'modules/webpubsub.bicep' = {
  name: 'webpubsub'
  params: {
    location: location
    tags: tags
    name: names.webPubSub
    hubName: webPubSubHub
    skuName: webPubSubSku
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    tags: tags
    name: names.keyVault
    publicNetworkAccess: publicAccess
    wallHmacSecret: wallHmacSecret
    logAnalyticsId: monitoring.outputs.logAnalyticsId
  }
}

// Private endpoints: one per sub-resource. Storage needs blob (host + deployment package),
// queue and table (Functions host features); media storage needs blob only. Targets are built
// from names because a loop needs values known at deployment start; dependsOn below orders them
// after the targets.
var cosmosId = resourceId('Microsoft.DocumentDB/databaseAccounts', names.cosmos)
var openAiId = resourceId('Microsoft.CognitiveServices/accounts', names.openAi)
var keyVaultId = resourceId('Microsoft.KeyVault/vaults', names.keyVault)
var storageId = resourceId('Microsoft.Storage/storageAccounts', names.storage)
var mediaStorageId = resourceId('Microsoft.Storage/storageAccounts', names.mediaStorage)
var privateEndpoints = [
  { name: 'pe-${names.cosmos}', target: cosmosId, groupId: 'Sql', zone: 'cosmos' }
  { name: 'pe-${names.openAi}', target: openAiId, groupId: 'account', zone: 'openai' }
  { name: 'pe-${names.keyVault}', target: keyVaultId, groupId: 'vault', zone: 'keyvault' }
  { name: 'pe-${names.storage}-blob', target: storageId, groupId: 'blob', zone: 'blob' }
  { name: 'pe-${names.storage}-queue', target: storageId, groupId: 'queue', zone: 'queue' }
  { name: 'pe-${names.storage}-table', target: storageId, groupId: 'table', zone: 'table' }
  { name: 'pe-${names.mediaStorage}-blob', target: mediaStorageId, groupId: 'blob', zone: 'blob' }
]

module endpoints 'modules/private-endpoint.bicep' = [
  for pe in privateEndpoints: if (enablePrivateNetworking) {
    name: pe.name
    dependsOn: [cosmos, openAi, keyVault, storage, mediaStorage]
    params: {
      location: location
      tags: tags
      name: pe.name
      subnetId: network!.outputs.privateEndpointSubnetId
      targetResourceId: pe.target
      groupId: pe.groupId
      privateDnsZoneId: network!.outputs.zoneIds[pe.zone]
    }
  }
]

module functions 'modules/functions.bicep' = {
  name: 'functions'
  // The host must resolve storage through its private endpoints before it starts.
  dependsOn: [endpoints]
  params: {
    location: location
    tags: tags
    planName: names.plan
    appName: functionAppName
    storageAccountName: storage.outputs.accountName
    storageBlobEndpoint: storage.outputs.blobEndpoint
    deploymentContainerName: storage.outputs.deploymentContainerName
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    logAnalyticsId: monitoring.outputs.logAnalyticsId
    integrationSubnetId: enablePrivateNetworking ? network!.outputs.functionsSubnetId : ''
    appSettings: {
      DATA_MODE: 'cosmos'
      AUTH_MODE: 'swa'
      AI_MODE: 'azure'
      COSMOS_ENDPOINT: cosmos.outputs.endpoint
      COSMOS_DATABASE: cosmos.outputs.databaseName
      AZURE_OPENAI_ENDPOINT: openAi.outputs.endpoint
      AZURE_OPENAI_DEPLOYMENT: openAi.outputs.deploymentName
      AZURE_OPENAI_API_VERSION: openAiApiVersion
      WEB_PUBSUB_ENDPOINT: webPubSub.outputs.endpoint
      WEB_PUBSUB_HUB: webPubSub.outputs.hubName
      KEY_VAULT_URI: keyVault.outputs.uri
      TENANT_DOMAINS: tenantDomains
      BOOTSTRAP_ADMIN_EMAILS: bootstrapAdminEmails
      FEATURE_PIPELINE: string(featurePipeline)
      FEATURE_PERSONAL_MAIL: string(featurePersonalMail)
      MEDIA_BLOB_ENDPOINT: mediaStorage.outputs.blobEndpoint
      MEDIA_CONTAINER: mediaStorage.outputs.containerName
    }
  }
}

module roles 'modules/roles.bicep' = {
  name: 'roles'
  params: {
    functionPrincipalId: functions.outputs.principalId
    deployerPrincipalId: principalId
    grantDeployerDataAccess: grantDeployerDataAccess
    cosmosAccountName: cosmos.outputs.accountName
    storageAccountName: storage.outputs.accountName
    openAiAccountName: openAi.outputs.accountName
    webPubSubName: webPubSub.outputs.name
    keyVaultName: keyVault.outputs.name
    appInsightsName: monitoring.outputs.appInsightsName
    mediaStorageAccountName: mediaStorage.outputs.accountName
    mediaContainerName: mediaStorage.outputs.containerName
  }
}

module staticWebApp 'modules/swa.bicep' = {
  name: 'staticwebapp'
  params: {
    location: staticWebAppLocation
    tags: tags
    name: names.staticWebApp
    backendResourceId: functions.outputs.appId
    backendLocation: functions.outputs.location
    aadClientId: aadClientId
    aadClientSecret: aadClientSecret
  }
}

// ---------- outputs (azd writes these into .azure/<env>/.env) ----------

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = resourceGroup().name
output AZURE_COSMOS_ENDPOINT string = cosmos.outputs.endpoint
output AZURE_COSMOS_DATABASE string = cosmos.outputs.databaseName
output AZURE_OPENAI_ENDPOINT string = openAi.outputs.endpoint
output AZURE_OPENAI_DEPLOYMENT string = openAi.outputs.deploymentName
output AZURE_KEY_VAULT_NAME string = keyVault.outputs.name
output AZURE_KEY_VAULT_ENDPOINT string = keyVault.outputs.uri
output AZURE_WEB_PUBSUB_ENDPOINT string = webPubSub.outputs.endpoint
output AZURE_FUNCTION_APP_NAME string = functions.outputs.appName
output AZURE_FUNCTION_PRINCIPAL_ID string = functions.outputs.principalId
output AZURE_MEDIA_STORAGE_NAME string = mediaStorage.outputs.accountName
output AZURE_STATIC_WEB_APP_NAME string = staticWebApp.outputs.name
output SERVICE_API_URI string = 'https://${functions.outputs.defaultHostName}'
output SERVICE_WEB_URI string = staticWebApp.outputs.uri
