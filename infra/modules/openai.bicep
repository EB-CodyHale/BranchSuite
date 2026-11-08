// Azure OpenAI account with Entra-only access (disableLocalAuth) and one chat model deployment.
// Pick the newest model and version that your tenant has approved; the defaults are a baseline.

@description('Azure region. The model and SKU must be available here.')
param location string

@description('Tags applied to every resource.')
param tags object

@description('Azure OpenAI account name; also used as the custom subdomain.')
param accountName string

@description('When false, the account accepts traffic only through private endpoints.')
param publicNetworkAccess bool

@description('Deployment name the API calls (AZURE_OPENAI_DEPLOYMENT).')
param deploymentName string

@description('Model name.')
param modelName string

@description('Model version.')
param modelVersion string

@description('Deployment SKU. Standard keeps processing in the account region; DataZoneStandard keeps it in the data zone (US or EU); GlobalStandard may process in any region.')
@allowed(['Standard', 'DataZoneStandard', 'GlobalStandard'])
param deploymentSku string

@description('Deployment capacity in thousands of tokens per minute.')
@minValue(1)
param deploymentCapacity int

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: accountName
    disableLocalAuth: true
    publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled'
    networkAcls: {
      defaultAction: publicNetworkAccess ? 'Allow' : 'Deny'
    }
  }
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: deploymentName
  sku: {
    name: deploymentSku
    capacity: deploymentCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

output accountName string = account.name
output accountId string = account.id
output endpoint string = account.properties.endpoint
output deploymentName string = deployment.name
