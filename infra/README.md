# Azure infrastructure

`main.bicep` creates the resources used by ChatApp:

- a Linux Azure App Service running the .NET 10 API;
- an Azure Static Web App for the Vite frontend;
- a private Azure Blob Storage container for uploads;
- an Azure SQL logical server and Basic database;
- an Azure Communication Services resource for calls and live streams;
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
the frontend.

## Deploy

Create a resource group and deploy the template:

```powershell
az group create --name chatapp-dev --location southeastasia

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
    --name chatapp-dev `
    --resource-group chatapp-dev `
    --template-file ./infra/main.bicep `
    --parameters `
      environmentName=dev `
      location=southeastasia `
      communicationServicesDataLocation="Asia Pacific" `
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

## Deploy the applications

The template provisions hosting but does not publish application code. Retrieve
the generated URLs and names from the deployment:

```powershell
$outputs = az deployment group show `
  --resource-group chatapp-dev `
  --name chatapp-dev `
  --query properties.outputs `
  | ConvertFrom-Json

$apiUrl = $outputs.apiUrl.value
$apiAppName = $outputs.apiAppName.value
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
  --resource-group chatapp-dev `
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
the pipeline, select `dev`, `test`, `staging`, or `prod` from the `Environment`
parameter. The pipeline loads the corresponding variable group using this
naming convention:

```text
chatapp-infra-{environment}
```

For example, selecting `prod` loads `chatapp-infra-prod`. Create and authorize
each required environment variable group with these variables:

| Variable                            | Example                          | Notes                                            |
| ----------------------------------- | -------------------------------- | ------------------------------------------------ |
| `azureServiceConnection`            | `sc-chatapp-dev`                 | Azure Resource Manager service connection        |
| `resourceGroupName`                 | `chatapp-dev`                    | Created by the pipeline when absent              |
| `resourceGroupLocation`             | `southeastasia`                  | Location of the resource group metadata          |
| `workloadName`                      | `chatapp`                        | Bicep resource-name prefix                       |
| `location`                          | `southeastasia`                  | App Service, Storage, and SQL region             |
| `staticWebAppLocation`              | `eastus2`                        | Supported Static Web Apps region                 |
| `communicationServicesDataLocation` | `Asia Pacific`                   | ACS data-residency geography                     |
| `sqlAdministratorLogin`             | `chatappadmin`                   | Azure SQL administrator login                    |
| `sqlAdministratorPassword`          | `(secret)`                       | Mark this variable as secret                     |
| `uploadsContainerName`              | `chatapp-uploads`                | Private Blob container name                      |
| `apiAppName`                        | `chatapp-dev-api-...`            | App Service name used by the release pipeline    |
| `staticWebAppName`                  | `chatapp-dev-web-...`            | Static Web App name used by the release pipeline |
| `staticWebAppUrl`                   | `https://...azurestaticapps.net` | Static Web App production URL                    |
| `azureNotificationsSubject`         | `mailto:admin@example.com`       | Web Push VAPID subject                           |
| `azureNotificationsVapidPrivateKey` | `(secret)`                       | VAPID private key; mark as secret                |
| `azureNotificationsVapidPublicKey`  | `(public key)`                   | Public VAPID key used by browser clients         |

The selected pipeline environment is passed directly to the Bicep
`environmentName` parameter, so it does not need to be duplicated in the
variable group.

The service principal behind `azureServiceConnection` needs permission to
create resources in the subscription and create both storage role assignments.
When creating the Azure DevOps pipeline, select
`infra/azure-pipelines.yml` as its YAML path and authorize both the service
connection and variable group.

## Security notes

The SQL firewall rule permits connections from Azure services so the public App
Service can reach SQL. For a production environment with stricter isolation,
move App Service and SQL behind virtual-network integration and a private
endpoint, then disable SQL public network access.
