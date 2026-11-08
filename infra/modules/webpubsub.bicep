// Azure Web PubSub for "invalidate" pushes to boards and walls. Access keys are disabled; the
// API signs client tokens through the data plane with its managed identity. Public network
// access stays on because browsers and lobby TVs connect from outside the VNet
// (see docs/SECURITY.md, "Realtime").

@description('Azure region.')
param location string

@description('Tags applied to every resource.')
param tags object

@description('Web PubSub resource name.')
param name string

@description('Hub name (WEB_PUBSUB_HUB).')
param hubName string

@description('SKU. Free_F1 has no SLA and caps at 20 connections; use it only for test environments.')
@allowed(['Free_F1', 'Standard_S1', 'Premium_P1'])
param skuName string

@description('Units (each Standard unit carries 1,000 concurrent connections).')
@minValue(1)
param capacity int = 1

resource webPubSub 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    capacity: capacity
  }
  properties: {
    disableLocalAuth: true
    disableAadAuth: false
    publicNetworkAccess: 'Enabled'
    tls: { clientCertEnabled: false }
  }
}

// No event handlers: clients only receive server-sent messages. Anonymous connects are denied,
// so every connection needs a token that the API issued for a fixed set of groups.
resource hub 'Microsoft.SignalRService/webPubSub/hubs@2024-03-01' = {
  parent: webPubSub
  name: hubName
  properties: {
    anonymousConnectPolicy: 'deny'
    eventHandlers: []
  }
}

output name string = webPubSub.name
output id string = webPubSub.id
output endpoint string = 'https://${webPubSub.properties.hostName}'
output hubName string = hub.name
