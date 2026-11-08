// Azure Static Web Apps (Standard) hosting the SPA, with the Function App linked as its API
// backend. Linking configures the Function App to accept only requests that SWA forwards,
// with the signed-in user in x-ms-client-principal.

@description('Azure region. Static Web Apps is available only in a few regions.')
param location string

@description('Tags applied to every resource (the azd service tag is added here).')
param tags object

@description('Static Web App name.')
param name string

@description('Function App resource ID to link as the backend.')
param backendResourceId string

@description('Function App region.')
param backendLocation string

@description('Entra app registration client ID. Leave empty to keep the value that infra/scripts/setup-entra-auth.sh set.')
param aadClientId string = ''

@description('Entra app registration client secret. Leave empty to keep the value that infra/scripts/setup-entra-auth.sh set.')
@secure()
param aadClientSecret string = ''

resource site 'Microsoft.Web/staticSites@2025-03-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    allowConfigFileUpdates: true
    // Pull-request preview environments would expose unreviewed builds; they stay off.
    stagingEnvironmentPolicy: 'Disabled'
    enterpriseGradeCdnStatus: 'Disabled'
    publicNetworkAccess: 'Enabled'
  }
}

resource backend 'Microsoft.Web/staticSites/linkedBackends@2025-03-01' = {
  parent: site
  name: 'api'
  properties: {
    backendResourceId: backendResourceId
    region: backendLocation
  }
}

// Written only when both values are supplied, so a later `azd provision` never blanks the
// credentials that the Entra setup script stored.
resource authSettings 'Microsoft.Web/staticSites/config@2025-03-01' = if (!empty(aadClientId) && !empty(aadClientSecret)) {
  parent: site
  name: 'appsettings'
  properties: {
    AAD_CLIENT_ID: aadClientId
    AAD_CLIENT_SECRET: aadClientSecret
  }
}

output name string = site.name
output defaultHostName string = site.properties.defaultHostname
output uri string = 'https://${site.properties.defaultHostname}'
