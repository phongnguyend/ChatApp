# Azure infrastructure

`main.bicep` creates the resources used by ChatApp:

- a Linux Azure App Service running the .NET 10 API;
- an Azure Static Web App for the Vite frontend;
- a private Azure Blob Storage container for uploads;
- an Azure SQL logical server and Basic database;
- an Azure Communication Services resource for calls and live streams;
- an Event Grid system topic that forwards ACS recording-ready events to
  Service Bus;
- an Azure Service Bus topic and API subscription for durable recording work;
- an Azure Notification Hubs namespace and browser-push notification hub.

The API receives its SQL connection string and application settings from App
Service. Its system-assigned managed identity is granted `Storage Blob Data
Contributor` on the storage account, so no storage access key is stored in the
application configuration. Azure Communication Services also receives a
system-assigned managed identity with `Storage Blob Data Contributor` on the
storage account, allowing Call Recording to export files to a configured blob
container through Bring Your Own Storage (BYOS). The Communication Services
primary connection string is injected into the API App Service settings as
`Calling__AzureCommunicationServices__ConnectionString`; it is never exposed to
the frontend. Direct-call and group-meeting media use ACS group calls, keyed by
the app's SignalR-managed call or meeting ID. ACS
`RecordingFileStatusUpdated` events are delivered directly from
Event Grid to the same topic with managed identity, so no public recording-event
webhook is required.

## Deploy

### Resource naming and tags

Resource names use the lowercase `<workloadName>-<environmentName>` prefix, for example `chatapp-local-sql-<uniqueSuffix>` and `chatapp-test-db`. Use lowercase letters, digits, and single hyphens for these inputs. Globally unique names include a deterministic resource-group suffix.

Storage accounts cannot contain hyphens and are limited to 24 characters: their names combine the workload, environment, and an eight-character unique suffix. The workload portion is shortened when needed, while the full workload and environment remain available in tags.

Upload containers, Service Bus topics, and subscriptions do not use the workload/environment prefix: their parent storage account or namespace already isolates each environment. Defaults are `uploads`, `recording-file-status-updated`, and the subscriptions `recording-file-status-updated-sub`, `recording-file-status-updated-audit`, and `recording-file-status-updated-debug`. Their optional name parameters can override these defaults when retaining an existing resource. The blob service must be named `default`, the Azure-services SQL firewall rule remains `AllowAzureServices`, and role assignment names are deterministic GUIDs as Azure requires.

Every resource that supports tags receives `Workload`, `Environment`, `ManagedBy=Bicep`, and a `Component` tag (such as `api`, `database`, or `messaging`). Add ownership or cost-center tags through `resourceTags` in the environment JSON file. The template-controlled tags take precedence. Child resources without tag support are identified by their parent and resource names. The pipeline also tags the resource group with Workload, Environment, and ManagedBy.

Changing names creates new Azure resources; it does not rename existing resources or move their data. Review a deployment what-if and plan data migration before applying the new naming convention to an existing deployment.

Run from the repository root. Choose an environment parameter file:

| File | Resources |
| --- | --- |
| `parameters.local.json` | Azure dependencies for apps running on your machine; no application hosting |
| `parameters.dev.json` | Full development stack |
| `parameters.test.json` | Full test stack |

The files contain resource names, regions, and messaging settings. SQL passwords and VAPID credentials are supplied separately; do not add credentials to these tracked files. Environment prefixes isolate resource names. Use a separate resource group for each environment.

Create a resource group and deploy the selected file:

```powershell
$deploymentEnvironment = 'dev' # local, dev, or test
$parameterFile = "./infra/parameters.$deploymentEnvironment.json"
$resourceGroupName = "chatapp-$deploymentEnvironment"
$resourceLocation = (Get-Content $parameterFile -Raw | ConvertFrom-Json).parameters.location.value
az group create --name $resourceGroupName --location $resourceLocation

$secureSqlPassword = Read-Host `
  "SQL administrator password" `
  -AsSecureString
$browserPushSubject = Read-Host `
  "VAPID subject (for example, mailto:admin@example.com)"
$secureVapidPrivateKey = Read-Host `
  "VAPID private key" `
  -AsSecureString
$browserPushVapidPublicKey = Read-Host "VAPID public key"

$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
  $secureSqlPassword
)
$vapidPrivateKeyPointer = `
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
    $secureVapidPrivateKey
  )

try {
  $sqlPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    $passwordPointer
  )
  $browserPushVapidPrivateKey = `
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
      $vapidPrivateKeyPointer
    )

  az deployment group create `
    --name $resourceGroupName `
    --resource-group $resourceGroupName `
    --template-file ./infra/main.bicep `
    --parameters `
      "@$parameterFile" `
      sqlAdministratorPassword=$sqlPassword `
      browserPushSubject=$browserPushSubject `
      browserPushVapidPrivateKey=$browserPushVapidPrivateKey `
      browserPushVapidPublicKey=$browserPushVapidPublicKey
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($vapidPrivateKeyPointer)
  Remove-Variable sqlPassword -ErrorAction SilentlyContinue
  Remove-Variable browserPushVapidPrivateKey -ErrorAction SilentlyContinue
}
```

The password is read without echoing it and removed from the PowerShell session
after Azure CLI completes. The account running the deployment must be allowed to
create role assignments.

If `eastus2` is not an appropriate Static Web Apps region for the subscription,
override `staticWebAppLocation`.

## Local development resources

Choose `$deploymentEnvironment = 'local'` in the deployment example. The local file sets `deployAppHosting` to `false`. It provisions Storage, Azure SQL, ACS, Notification Hubs, Service Bus (including its subscriptions), the ACS recording Event Grid integration, Log Analytics, and Application Insights. The App Service plan, API, Function App, Static Web App, and their managed-identity role assignments are omitted. Hosting outputs are empty for this environment.

Run the frontend, API, and background worker on your machine using the root README's local instructions. Configure their Azure endpoints and credentials with .NET user secrets or environment variables, not the parameter file:

- Use the deployment's SQL server/database outputs for `ConnectionStrings:ChatDatabase`, or continue using your local database. To connect to Azure SQL from your machine, add your development machine's public IP to that server's firewall; the default rule only permits Azure services.
- Set `UploadStorage:AzureBlob:StorageAccountName` and `UploadStorage:AzureBlob:Container` from the storage outputs. Use a local developer identity with Storage Blob Data Contributor or a development connection string; the omitted API managed identity cannot be used locally.
- Set the Service Bus namespace/topic/subscription from the outputs. Give the local developer identity Service Bus Data Sender and Data Receiver access if using identity authentication, or use a development connection string.
- Configure ACS and Notification Hubs connection strings and the VAPID public key in local API settings. Set the notification frontend base URL and allowed origin to your frontend's local address (normally `http://localhost:5173`).
- Set the local background worker's API base URL to the local API. Azure resource creation does not start the local processes or grant permissions to your signed-in developer identity.

These are real Azure resources, with the same dependency SKUs as the other environments. Use `deployAppHosting=false` in an isolated local resource group; an incremental deployment does not delete hosting resources from a previously deployed full stack.

## Deploy the applications

This section applies to environments with `deployAppHosting=true`.

The template provisions hosting but does not publish application code. Retrieve
the generated URLs and names from the deployment:

```powershell
$outputs = az deployment group show `
  --resource-group $resourceGroupName `
  --name $resourceGroupName `
  --query properties.outputs `
  | ConvertFrom-Json

$apiUrl = $outputs.apiUrl.value
$apiAppName = $outputs.apiAppName.value
$functionAppName = $outputs.functionAppName.value
$staticWebAppName = $outputs.staticWebAppName.value
```

Publish the API with a zip deployment (or use the same values in CI):

```powershell
dotnet publish ./backend/ChatApp.Api/ChatApp.Api.csproj `
  --configuration Release `
  --output ./artifacts/api

Compress-Archive `
  -Path ./artifacts/api/* `
  -DestinationPath ./artifacts/api.zip `
  -Force

az webapp deploy `
  --resource-group $resourceGroupName `
  --name $apiAppName `
  --src-path ./artifacts/api.zip `
  --type zip
```

Build the frontend with the API URL before deploying it to the Static Web App:

```powershell
$env:VITE_API_URL = $apiUrl
npm --prefix ./frontend ci
npm --prefix ./frontend run build
```

Use the Static Web App deployment token in the frontend deployment workflow to
upload `frontend/dist`. Keep that token in the CI system's secret store.

## Azure DevOps pipeline

`azure-pipelines.yml` validates and deploys `main.bicep`. When manually running
the pipeline, select `local`, `dev`, or `test` from the `Environment`
parameter. The pipeline loads the corresponding variable group using this
naming convention:

```text
chatapp-infra-{environment}
```

For example, selecting `test` loads `chatapp-infra-test`. Create and authorize
each required environment variable group with these variables:

| Variable                            | Example                          | Notes                                            |
| ----------------------------------- | -------------------------------- | ------------------------------------------------ |
| `azureServiceConnection`            | `sc-chatapp-dev`                 | Azure Resource Manager service connection        |
| `resourceGroupName`                 | `chatapp-dev`                    | Created by the pipeline when absent              |
| `resourceGroupLocation`             | `southeastasia`                  | Location of the resource group metadata          |
| `sqlAdministratorPassword`          | `(secret)`                       | Mark this variable as secret                     |
| `apiAppName`                        | `chatapp-dev-api-...`            | App Service name used by the release pipeline    |
| `functionAppName`                   | `chatapp-dev-functions-...`      | Function App name used by the release pipeline   |
| `staticWebAppName`                  | `chatapp-dev-web-...`            | Static Web App name used by the release pipeline |
| `staticWebAppUrl`                   | `https://...azurestaticapps.net` | Static Web App production URL                    |
| `azureNotificationsSubject`         | `mailto:admin@example.com`       | Web Push VAPID subject                           |
| `azureNotificationsVapidPrivateKey` | `(secret)`                       | VAPID private key; mark as secret                |
| `azureNotificationsVapidPublicKey`  | `(public key)`                   | Public VAPID key used by browser clients         |

The pipeline loads `infra/parameters.{environment}.json`. Edit that file for non-secret resource settings; the variable group supplies deployment context and credentials. Hosting output variables are only needed for application release pipelines, not local dependency deployments.

The service principal behind `azureServiceConnection` needs permission to
create resources in the subscription and create the storage and Service Bus role
assignments.
When creating the Azure DevOps pipeline, select
`infra/azure-pipelines.yml` as its YAML path and authorize both the service
connection and variable group.

## Security notes

The SQL firewall rule permits connections from Azure services so the public App
Service can reach SQL. For a production environment with stricter isolation,
move App Service and SQL behind virtual-network integration and a private
endpoint, then disable SQL public network access.
