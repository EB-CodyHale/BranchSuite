// Optional private networking: a VNet with a Function App integration subnet and a private
// endpoint subnet, plus the private DNS zones that the private endpoints register in.

@description('Azure region.')
param location string

@description('Tags applied to every resource.')
param tags object

@description('Virtual network name.')
param vnetName string

@description('VNet address space.')
param addressPrefix string = '10.40.0.0/16'

@description('Function App integration subnet (Flex Consumption needs at least a /27 delegated to Microsoft.App/environments).')
param functionsSubnetPrefix string = '10.40.1.0/24'

@description('Private endpoint subnet.')
param privateEndpointSubnetPrefix string = '10.40.2.0/24'

// Zone names for the public cloud. Storage zones follow the cloud's storage suffix.
var storageSuffix = environment().suffixes.storage
var zoneNames = {
  cosmos: 'privatelink.documents.azure.com'
  openai: 'privatelink.openai.azure.com'
  keyvault: 'privatelink.vaultcore.azure.net'
  blob: 'privatelink.blob.${storageSuffix}'
  queue: 'privatelink.queue.${storageSuffix}'
  table: 'privatelink.table.${storageSuffix}'
}

resource vnet 'Microsoft.Network/virtualNetworks@2025-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [addressPrefix] }
    subnets: [
      {
        name: 'snet-functions'
        properties: {
          addressPrefix: functionsSubnetPrefix
          delegations: [
            {
              name: 'flex-consumption'
              properties: { serviceName: 'Microsoft.App/environments' }
            }
          ]
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'snet-private-endpoints'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource zones 'Microsoft.Network/privateDnsZones@2024-06-01' = [
  for z in items(zoneNames): {
    name: z.value
    location: 'global'
    tags: tags
  }
]

resource zoneLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [
  for (z, i) in items(zoneNames): {
    parent: zones[i]
    name: '${vnetName}-link'
    location: 'global'
    tags: tags
    properties: {
      registrationEnabled: false
      virtualNetwork: { id: vnet.id }
    }
  }
]

output vnetId string = vnet.id
output functionsSubnetId string = vnet.properties.subnets[0].id
output privateEndpointSubnetId string = vnet.properties.subnets[1].id
output zoneIds object = {
  cosmos: resourceId('Microsoft.Network/privateDnsZones', zoneNames.cosmos)
  openai: resourceId('Microsoft.Network/privateDnsZones', zoneNames.openai)
  keyvault: resourceId('Microsoft.Network/privateDnsZones', zoneNames.keyvault)
  blob: resourceId('Microsoft.Network/privateDnsZones', zoneNames.blob)
  queue: resourceId('Microsoft.Network/privateDnsZones', zoneNames.queue)
  table: resourceId('Microsoft.Network/privateDnsZones', zoneNames.table)
}
