// Azure Cosmos DB for NoSQL, serverless, Entra-only data plane (disableLocalAuth).
// Containers follow docs/ARCHITECTURE.md section 3. defaultTtl -1 turns TTL on without a
// container default, so only documents that carry a `ttl` field expire.

@description('Azure region.')
param location string

@description('Tags applied to every resource.')
param tags object

@description('Cosmos DB account name.')
param accountName string

@description('SQL database name.')
param databaseName string = 'branchsuite'

@description('When false, the account accepts traffic only through private endpoints.')
param publicNetworkAccess bool

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: accountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [{ name: 'EnableServerless' }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    disableLocalAuth: true
    disableKeyBasedMetadataWriteAccess: true
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: publicNetworkAccess ? 'Enabled' : 'Disabled'
    networkAclBypass: 'None'
    // Point-in-time restore for 7 days at no extra storage cost (see docs/DEPLOYMENT.md, Rollback).
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: { tier: 'Continuous7Days' }
    }
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: account
  name: databaseName
  properties: {
    resource: { id: databaseName }
  }
}

// Large free-text fields are never filtered or sorted on, so they are excluded from the index
// to cut write RU cost. The system `_etag` path is excluded as Cosmos recommends.
var containers = [
  {
    name: 'directory'
    partitionKey: '/pk'
    excludedPaths: ['/"_etag"/?']
  }
  {
    name: 'board'
    partitionKey: '/scopeId'
    excludedPaths: ['/"_etag"/?', '/note/?', '/notes/?', '/summary/?', '/close/note/?', '/contacts/*']
  }
  {
    name: 'mail'
    partitionKey: '/scopeId'
    excludedPaths: ['/"_etag"/?', '/bodyText/?', '/summary/?', '/decision/?']
  }
]

resource sqlContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = [
  for c in containers: {
    parent: database
    name: c.name
    properties: {
      resource: {
        id: c.name
        partitionKey: {
          paths: [c.partitionKey]
          kind: 'Hash'
          version: 2
        }
        defaultTtl: -1
        indexingPolicy: {
          indexingMode: 'consistent'
          automatic: true
          includedPaths: [{ path: '/*' }]
          excludedPaths: [for p in c.excludedPaths: { path: p }]
        }
      }
    }
  }
]

output accountName string = account.name
output accountId string = account.id
output endpoint string = account.properties.documentEndpoint
output databaseName string = database.name
