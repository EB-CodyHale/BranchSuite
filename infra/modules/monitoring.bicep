// Log Analytics workspace + workspace-based Application Insights.
// Local (instrumentation-key) ingestion is disabled: the Function App sends telemetry with
// its managed identity (APPLICATIONINSIGHTS_AUTHENTICATION_STRING=Authorization=AAD) and
// needs the Monitoring Metrics Publisher role, which roles.bicep assigns.

@description('Azure region.')
param location string

@description('Tags applied to every resource.')
param tags object

@description('Log Analytics workspace name.')
param logAnalyticsName string

@description('Application Insights component name.')
param appInsightsName string

@description('Log retention in days.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: retentionInDays
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    DisableLocalAuth: true
    IngestionMode: 'LogAnalytics'
  }
}

output logAnalyticsId string = logAnalytics.id
output appInsightsName string = appInsights.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
