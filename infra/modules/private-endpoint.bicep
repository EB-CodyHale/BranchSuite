// One private endpoint for one sub-resource (group) of a PaaS resource, registered in the
// matching private DNS zone.

@description('Azure region.')
param location string

@description('Tags applied to every resource.')
param tags object

@description('Private endpoint name.')
param name string

@description('Subnet that hosts the private endpoint NIC.')
param subnetId string

@description('Resource ID of the target PaaS resource.')
param targetResourceId string

@description('Target sub-resource, for example Sql, account, vault, blob, queue or table.')
param groupId string

@description('Private DNS zone resource ID for the sub-resource.')
param privateDnsZoneId string

resource endpoint 'Microsoft.Network/privateEndpoints@2025-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    subnet: { id: subnetId }
    privateLinkServiceConnections: [
      {
        name: name
        properties: {
          privateLinkServiceId: targetResourceId
          groupIds: [groupId]
        }
      }
    ]
  }
}

resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2025-05-01' = {
  parent: endpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: groupId
        properties: { privateDnsZoneId: privateDnsZoneId }
      }
    ]
  }
}
