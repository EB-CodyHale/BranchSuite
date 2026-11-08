// Azure Functions on the Flex Consumption plan (FC1, Linux, Node 22) with a system-assigned
// managed identity. Every downstream call (Cosmos DB, OpenAI, Web PubSub, Key Vault, Storage,
// Application Insights, Microsoft Graph) authenticates with this identity; no keys are stored.

@description('Azure region.')
param location string

@description('Tags applied to every resource (the azd service tag is added here).')
param tags object

@description('Flex Consumption plan name.')
param planName string

@description('Function App name.')
param appName string

@description('Storage account used for AzureWebJobsStorage and the deployment package.')
param storageAccountName string

@description('Blob endpoint of the storage account (ends with a slash).')
param storageBlobEndpoint string

@description('Deployment package container name.')
param deploymentContainerName string

@description('Application Insights connection string.')
param appInsightsConnectionString string

@description('Log Analytics workspace for platform logs.')
param logAnalyticsId string

@description('Subnet for regional VNet integration; empty disables VNet integration.')
param integrationSubnetId string = ''

@description('Maximum scale-out instance count.')
@minValue(1)
@maxValue(1000)
param maximumInstanceCount int = 40

@description('Memory per instance in MB.')
@allowed([512, 2048, 4096])
param instanceMemoryMB int = 2048

@description('Application settings consumed by apps/api/src/config.ts.')
param appSettings object

var vnetIntegrated = !empty(integrationSubnetId)

var platformSettings = {
  // Identity-based host storage (system-assigned identity): no connection string, no shared key.
  AzureWebJobsStorage__accountName: storageAccountName
  APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
  // App Insights local auth is disabled; the host authenticates with the managed identity.
  APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'Authorization=AAD'
}

resource plan 'Microsoft.Web/serverfarms@2025-03-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2025-03-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: 'Enabled'
    virtualNetworkSubnetId: vnetIntegrated ? integrationSubnetId : null
    // Route all outbound traffic (including Graph and Web PubSub calls) through the VNet.
    outboundVnetRouting: vnetIntegrated ? { allTraffic: true } : null
    siteConfig: {
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      appSettings: [for s in items(union(appSettings, platformSettings)): { name: s.key, value: s.value }]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageBlobEndpoint}${deploymentContainerName}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
}

// Basic-auth publishing (FTP and SCM user/password) is off. azd and the deploy workflow
// publish with Entra tokens.
resource ftpPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2025-03-01' = {
  parent: app
  name: 'ftp'
  properties: { allow: false }
}

resource scmPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2025-03-01' = {
  parent: app
  name: 'scm'
  properties: { allow: false }
}

// The newest GA version (2016-09-01) lacks categoryGroup; this preview is the documented current one.
#disable-next-line use-recent-api-versions
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: app
  properties: {
    workspaceId: logAnalyticsId
    logs: [{ category: 'FunctionAppLogs', enabled: true }]
  }
}

output appName string = app.name
output appId string = app.id
output location string = app.location
output principalId string = app.identity.principalId
output defaultHostName string = app.properties.defaultHostName
