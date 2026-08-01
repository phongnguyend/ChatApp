targetScope = 'resourceGroup'

@description('Short name used as the prefix for every resource.')
@minLength(2)
@maxLength(20)
param workloadName string = 'chatapp'

@description('Deployment environment name, such as dev, test, or prod.')
@minLength(2)
@maxLength(8)
param environmentName string = 'dev'

@description('Azure region for the App Service, Storage account, and SQL database.')
param location string = resourceGroup().location

@description('Azure region for the Static Web App. Static Web Apps are only available in selected regions.')
param staticWebAppLocation string = 'eastus2'

@description('Geography where Azure Communication Services stores data at rest.')
param communicationServicesDataLocation string = 'Asia Pacific'

@description('Administrator login for the Azure SQL logical server.')
param sqlAdministratorLogin string = 'chatappadmin'

@secure()
@description('Administrator password for the Azure SQL logical server.')
param sqlAdministratorPassword string

@description('Name of the private blob container used for application uploads.')
@minLength(3)
@maxLength(63)
param uploadsContainerName string = 'chatapp-uploads'

@description('Name of the Service Bus topic used for application messaging.')
@minLength(1)
@maxLength(260)
param serviceBusTopicName string = 'chatapp-messages'

@description('Name of the Service Bus subscription used by the API to receive messages.')
@minLength(1)
@maxLength(50)
param serviceBusSubscriptionName string = 'chatapp-messages-sub'

@description('Name of the Service Bus subscription that retains a copy of every topic message for auditing.')
@minLength(1)
@maxLength(50)
param serviceBusAuditSubscriptionName string = 'chatapp-messages-audit'

@secure()
@description('Contact URI used as the Web Push VAPID subject, such as mailto:admin@example.com.')
param browserPushSubject string

@secure()
@description('Private VAPID key used by Azure Notification Hubs for browser push.')
param browserPushVapidPrivateKey string

@secure()
@description('Public VAPID key exposed to browser clients by the API.')
param browserPushVapidPublicKey string

var uniqueSuffix = uniqueString(resourceGroup().id)
var resourceNamePrefix = toLower('${workloadName}-${environmentName}')
var appServicePlanName = '${resourceNamePrefix}-plan'
var apiAppName = take('${resourceNamePrefix}-api-${uniqueSuffix}', 60)
var staticWebAppName = take('${resourceNamePrefix}-web-${uniqueSuffix}', 60)
var storageAccountName = 'st${uniqueString(resourceGroup().id, workloadName, environmentName)}'
var sqlServerName = take('${resourceNamePrefix}-sql-${uniqueSuffix}', 63)
var sqlDatabaseName = 'chatapp'
var notificationHubNamespaceName = take('${resourceNamePrefix}-nh-${uniqueSuffix}', 50)
var notificationHubName = take('${resourceNamePrefix}-notifications', 265)
var communicationServiceName = take('${resourceNamePrefix}-acs-${uniqueSuffix}', 63)
var serviceBusNamespaceName = take('${resourceNamePrefix}-sb-${uniqueSuffix}', 50)
var communicationRecordingSystemTopicName = take('${resourceNamePrefix}-acs-recordings', 50)
var logAnalyticsWorkspaceName = take('${resourceNamePrefix}-law-${uniqueSuffix}', 63)
var appInsightsName = take('${resourceNamePrefix}-appi-${uniqueSuffix}', 260)
var blobDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
)
var serviceBusDataSenderRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'
)
var serviceBusDataReceiverRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'
)

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource uploadsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: uploadsContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdministratorLogin
    administratorLoginPassword: sqlAdministratorPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    restrictOutboundNetworkAccess: 'Disabled'
    version: '12.0'
  }
}

resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    endIpAddress: '0.0.0.0'
    startIpAddress: '0.0.0.0'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  properties: {
    maxSizeBytes: 2147483648
    zoneRedundant: false
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

resource notificationHubNamespace 'Microsoft.NotificationHubs/namespaces@2023-09-01' = {
  name: notificationHubNamespaceName
  location: location
  sku: {
    name: 'Free'
  }
  properties: {
    namespaceType: 'NotificationHub'
    publicNetworkAccess: 'Enabled'
  }
}

resource notificationHub 'Microsoft.NotificationHubs/namespaces/notificationHubs@2023-09-01' = {
  parent: notificationHubNamespace
  name: notificationHubName
  location: location
  properties: {
    #disable-next-line use-secure-value-for-secure-inputs
    browserCredential: {
      properties: {
        subject: browserPushSubject
        vapidPrivateKey: browserPushVapidPrivateKey
        vapidPublicKey: browserPushVapidPublicKey
      }
    }
  }
}

resource notificationHubApiAuthorizationRule 'Microsoft.NotificationHubs/namespaces/notificationHubs/authorizationRules@2023-09-01' = {
  parent: notificationHub
  name: 'ApiFullAccess'
  properties: {
    rights: [
      'Listen'
      'Manage'
      'Send'
    ]
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2025-05-01' = {
  name: communicationServiceName
  location: 'global'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dataLocation: communicationServicesDataLocation
    disableLocalAuth: false
    publicNetworkAccess: 'Enabled'
  }
}

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: serviceBusNamespaceName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    disableLocalAuth: false
    publicNetworkAccess: 'Enabled'
  }
}

resource serviceBusTopic 'Microsoft.ServiceBus/namespaces/topics@2024-01-01' = {
  parent: serviceBusNamespace
  name: serviceBusTopicName
}

resource serviceBusSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' = {
  parent: serviceBusTopic
  name: serviceBusSubscriptionName
}

resource serviceBusAuditSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2024-01-01' = {
  parent: serviceBusTopic
  name: serviceBusAuditSubscriptionName
}

resource communicationRecordingSystemTopic 'Microsoft.EventGrid/systemTopics@2025-02-15' = {
  name: communicationRecordingSystemTopicName
  location: 'global'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    source: communicationService.id
    topicType: 'Microsoft.Communication.CommunicationServices'
  }
}

resource communicationRecordingEventGridSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(
    serviceBusNamespace.id,
    communicationRecordingSystemTopic.id,
    serviceBusDataSenderRoleDefinitionId
  )
  scope: serviceBusNamespace
  properties: {
    principalId: communicationRecordingSystemTopic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceBusDataSenderRoleDefinitionId
  }
}

resource communicationRecordingEventSubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2025-02-15' = {
  parent: communicationRecordingSystemTopic
  name: 'recording-files-to-service-bus'
  properties: {
    deliveryWithResourceIdentity: {
      destination: {
        endpointType: 'ServiceBusTopic'
        properties: {
          resourceId: serviceBusTopic.id
        }
      }
      identity: {
        type: 'SystemAssigned'
      }
    }
    eventDeliverySchema: 'EventGridSchema'
    filter: {
      includedEventTypes: [
        'Microsoft.Communication.RecordingFileStatusUpdated'
      ]
      isSubjectCaseSensitive: false
    }
    retryPolicy: {
      eventTimeToLiveInMinutes: 1440
      maxDeliveryAttempts: 30
    }
  }
  dependsOn: [
    communicationRecordingEventGridSender
  ]
}

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

resource apiApp 'Microsoft.Web/sites@2023-12-01' = {
  name: apiAppName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    clientAffinityEnabled: false
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    serverFarmId: appServicePlan.id
    siteConfig: {
      alwaysOn: true
      appSettings: [
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: 'Production'
        }
        {
          name: 'UploadStorage__Provider'
          value: 'AzureBlob'
        }
        {
          name: 'UploadStorage__AzureBlob__UseManagedIdentity'
          value: 'true'
        }
        {
          name: 'UploadStorage__AzureBlob__StorageAccountName'
          value: storageAccount.name
        }
        {
          name: 'UploadStorage__AzureBlob__Container'
          value: uploadsContainer.name
        }
        {
          name: 'UploadStorage__AzureBlob__Path'
          value: 'uploads'
        }
        {
          name: 'UploadStorage__AzureBlob__LocalCacheFolder'
          value: 'upload-cache'
        }
        {
          name: 'AllowedOrigins__0'
          value: 'https://${staticWebApp.properties.defaultHostname}'
        }
        {
          name: 'Notification__Provider'
          value: 'AzureNotificationHub'
        }
        {
          name: 'Notification__AzureNotificationHub__FrontendBaseUrl'
          value: 'https://${staticWebApp.properties.defaultHostname}'
        }
        {
          name: 'Notification__AzureNotificationHub__ConnectionString'
          value: notificationHubApiAuthorizationRule.listKeys().primaryConnectionString
        }
        {
          name: 'Notification__AzureNotificationHub__HubName'
          value: notificationHub.name
        }
        {
          name: 'Notification__AzureNotificationHub__VapidPublicKey'
          value: browserPushVapidPublicKey
        }
        {
          name: 'Calling__Provider'
          value: 'AzureCommunicationServices'
        }
        {
          name: 'Calling__AzureCommunicationServices__ConnectionString'
          value: communicationService.listKeys().primaryConnectionString
        }
        {
          name: 'Messaging__Provider'
          value: 'AzureServiceBus'
        }
        {
          name: 'Messaging__AzureServiceBus__UseManagedIdentity'
          value: 'true'
        }
        {
          name: 'Messaging__AzureServiceBus__FullyQualifiedNamespace'
          value: '${serviceBusNamespace.name}.servicebus.windows.net'
        }
        {
          name: 'Messaging__AzureServiceBus__TopicName'
          value: serviceBusTopic.name
        }
        {
          name: 'Messaging__AzureServiceBus__SubscriptionName'
          value: serviceBusSubscription.name
        }
        {
          name: 'Monitoring__OpenTelemetry__IsEnabled'
          value: 'true'
        }
        {
          name: 'Monitoring__OpenTelemetry__AzureMonitor__IsEnabled'
          value: 'true'
        }
        {
          name: 'Monitoring__OpenTelemetry__AzureMonitor__ConnectionString'
          value: appInsights.properties.ConnectionString
        }
      ]
      connectionStrings: [
        {
          name: 'ChatDatabase'
          connectionString: 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${sqlDatabase.name};Persist Security Info=False;User ID=${sqlAdministratorLogin};Password=${sqlAdministratorPassword};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
          type: 'SQLAzure'
        }
      ]
      ftpsState: 'Disabled'
      http20Enabled: true
      linuxFxVersion: 'DOTNETCORE|10.0'
      minTlsVersion: '1.2'
      use32BitWorkerProcess: false
      webSocketsEnabled: true
    }
  }
}

resource apiBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, apiApp.id, blobDataContributorRoleDefinitionId)
  scope: storageAccount
  properties: {
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobDataContributorRoleDefinitionId
  }
}

resource communicationServiceBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, communicationService.id, blobDataContributorRoleDefinitionId)
  scope: storageAccount
  properties: {
    principalId: communicationService.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobDataContributorRoleDefinitionId
  }
}

resource apiServiceBusDataSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(serviceBusNamespace.id, apiApp.id, serviceBusDataSenderRoleDefinitionId)
  scope: serviceBusNamespace
  properties: {
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceBusDataSenderRoleDefinitionId
  }
}

resource apiServiceBusDataReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(serviceBusNamespace.id, apiApp.id, serviceBusDataReceiverRoleDefinitionId)
  scope: serviceBusNamespace
  properties: {
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceBusDataReceiverRoleDefinitionId
  }
}

output apiAppName string = apiApp.name
output apiUrl string = 'https://${apiApp.properties.defaultHostName}'
output staticWebAppName string = staticWebApp.name
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output storageAccountName string = storageAccount.name
output sqlServerFullyQualifiedDomainName string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name
output notificationHubNamespaceName string = notificationHubNamespace.name
output notificationHubName string = notificationHub.name
output communicationServiceName string = communicationService.name
output serviceBusNamespaceName string = serviceBusNamespace.name
output serviceBusTopicName string = serviceBusTopic.name
output serviceBusSubscriptionName string = serviceBusSubscription.name
output communicationRecordingSystemTopicName string = communicationRecordingSystemTopic.name
output logAnalyticsWorkspaceName string = logAnalyticsWorkspace.name
output appInsightsName string = appInsights.name
