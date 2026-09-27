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

The files contain resource names, regions, and messaging settings. The SQL Entra administrator identity and VAPID credentials are supplied separately; do not add credentials to these tracked files. Environment prefixes isolate resource names. Use a separate resource group for each environment.

## Generate browser push VAPID keys

With Node.js and npm installed, run this command to generate a matching key pair:

```powershell
npx --yes web-push generate-vapid-keys --json
```

The command prints JSON containing `publicKey` and `privateKey`. Copy the values without the surrounding quotes into the selected GitHub environment under **Settings → Environments → local/dev/test → Environment secrets**:

| Generated value | GitHub environment secret | Azure DevOps variable |
| --- | --- | --- |
| `privateKey` | `BROWSER_PUSH_VAPID_PRIVATE_KEY` | `azureNotificationsVapidPrivateKey` (secret) |
| `publicKey` | `BROWSER_PUSH_VAPID_PUBLIC_KEY` | `azureNotificationsVapidPublicKey` |

Set `BROWSER_PUSH_SUBJECT` (Azure DevOps: `azureNotificationsSubject`) to a contact URI for the app owner or administrator, such as `mailto:admin@example.com`. Replace the example with your actual contact address; it is not a generated key or the application's login URL.

Generate one pair per environment and retain it for subsequent deployments. Do not regenerate keys on every deployment: existing browser subscriptions are associated with the public key and may need to be recreated after a key change. Keep the private key in your secret store, never in the tracked parameter files or source control. The public key is intentionally used by browser clients.

See the [web-push command-line documentation](https://github.com/web-push-libs/web-push#command-line) and [Azure Notification Hubs browser push documentation](https://learn.microsoft.com/en-us/azure/notification-hubs/browser-push).

## Manual PowerShell deployment

Create a resource group and deploy the selected file:

Optionally set `$env:AZURE_RESOURCE_GROUP` and `$env:AZURE_RESOURCE_GROUP_LOCATION` in your shell. These use the same defaults as the GitHub workflow: `<workloadName>-<environmentName>` and the parameter file's `location`. For an existing resource group, use its current region. This sets the group's metadata region; individual resource regions still come from the parameter file.

Replace the example values below, then execute this block in the same PowerShell session as the deployment script:

```powershell
# Optional overrides: set to '' to use the defaults described above.
$env:AZURE_RESOURCE_GROUP = 'chatapp-dev'
$env:AZURE_RESOURCE_GROUP_LOCATION = 'southeastasia'

# SQL administrator: use the matching user's or group's display name and object ID.
$env:SQL_ENTRA_ADMINISTRATOR_NAME = '<user-or-group-display-name>'
$env:SQL_ENTRA_ADMINISTRATOR_OBJECT_ID = '<user-or-group-object-id>'
$env:SQL_ENTRA_ADMINISTRATOR_PRINCIPAL_TYPE = 'User' # User or Group

# Use the matching key pair from the VAPID generation section above.
$env:BROWSER_PUSH_SUBJECT = 'mailto:admin@example.com'
$env:BROWSER_PUSH_VAPID_PRIVATE_KEY = '<privateKey>'
$env:BROWSER_PUSH_VAPID_PUBLIC_KEY = '<publicKey>'
```

Use the VAPID key pair generated above. GitHub environment settings are not automatically available in your local shell. The script checks required settings before creating resources and does not prompt for input. Sign in to Azure and select the target subscription beforehand.

```powershell
$deploymentEnvironment = 'dev' # local, dev, or test
$requiredSettings = @(
  'SQL_ENTRA_ADMINISTRATOR_NAME',
  'SQL_ENTRA_ADMINISTRATOR_OBJECT_ID',
  'SQL_ENTRA_ADMINISTRATOR_PRINCIPAL_TYPE',
  'BROWSER_PUSH_SUBJECT',
  'BROWSER_PUSH_VAPID_PRIVATE_KEY',
  'BROWSER_PUSH_VAPID_PUBLIC_KEY'
)
foreach ($setting in $requiredSettings) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($setting))) {
    throw "Missing environment setting: $setting"
  }
}
if ($env:SQL_ENTRA_ADMINISTRATOR_PRINCIPAL_TYPE -cnotin @('User', 'Group')) {
  throw "Set SQL_ENTRA_ADMINISTRATOR_PRINCIPAL_TYPE to User or Group."
}

$parameterFile = "./infra/parameters.$deploymentEnvironment.json"
$deploymentParameters = (Get-Content $parameterFile -Raw | ConvertFrom-Json).parameters
$workloadName = $deploymentParameters.workloadName.value.ToLowerInvariant()
$resourceGroupName = $env:AZURE_RESOURCE_GROUP
if ([string]::IsNullOrEmpty($resourceGroupName)) {
  $resourceGroupName = "$workloadName-$deploymentEnvironment"
}
$resourceGroupLocation = $env:AZURE_RESOURCE_GROUP_LOCATION
if ([string]::IsNullOrEmpty($resourceGroupLocation)) {
  $resourceGroupLocation = $deploymentParameters.location.value
}
az group create `
  --name $resourceGroupName `
  --location $resourceGroupLocation `
  --tags "Workload=$workloadName" "Environment=$deploymentEnvironment" "ManagedBy=Bicep"
if ($LASTEXITCODE -ne 0) { throw "Resource group creation failed." }

az deployment group create `
  --name $resourceGroupName `
  --resource-group $resourceGroupName `
  --template-file ./infra/main.bicep `
  --parameters `
    "@$parameterFile" `
    "sqlEntraAdministratorPrincipalType=$env:SQL_ENTRA_ADMINISTRATOR_PRINCIPAL_TYPE" `
    "sqlEntraAdministratorName=$env:SQL_ENTRA_ADMINISTRATOR_NAME" `
    "sqlEntraAdministratorObjectId=$env:SQL_ENTRA_ADMINISTRATOR_OBJECT_ID" `
    "browserPushSubject=$env:BROWSER_PUSH_SUBJECT" `
    "browserPushVapidPrivateKey=$env:BROWSER_PUSH_VAPID_PRIVATE_KEY" `
    "browserPushVapidPublicKey=$env:BROWSER_PUSH_VAPID_PUBLIC_KEY"
if ($LASTEXITCODE -ne 0) { throw "Infrastructure deployment failed." }
```

The account running the deployment must be allowed to create role assignments.

If `eastus2` is not an appropriate Static Web Apps region for the subscription,
override `staticWebAppLocation`.

## Azure SQL identity authentication

The API and Function App use their system-assigned managed identities with `Authentication=Active Directory Managed Identity`; no SQL username or password is stored in their connection strings. SQL uses Microsoft Entra-only authentication with the user or group provided by `sqlEntraAdministratorName` and `sqlEntraAdministratorObjectId` as administrator. Set the deployment environment's principal type to `User` for a person or `Group` for a group: GitHub uses the environment variable `SQL_ENTRA_ADMINISTRATOR_PRINCIPAL_TYPE`; Azure DevOps uses `sqlEntraAdministratorPrincipalType` in the environment variable group. Both pipelines require and validate this value. For manual deployment, set `$env:SQL_ENTRA_ADMINISTRATOR_PRINCIPAL_TYPE` before running the example above. The tracked parameter files do not contain this setting. Supply the matching user's or group's display name and **object ID** from the subscription's tenant. For a group, add the people who will administer the database before deploying.

**Before first application deployment**, connect to the database identified by `sqlServerFullyQualifiedDomainName` and `sqlDatabaseName` using SSMS with Microsoft Entra MFA authentication as the configured administrator user or a member of the configured administrator group. Add your IP to the SQL firewall if connecting from your machine. Edit and run [grant-sql-access.sql](grant-sql-access.sql), using the `apiAppName` and `functionAppName` outputs. It creates contained users and grants read/write access; the API also receives DDL permissions because it applies EF migrations at startup. Infrastructure deployment alone does not create these database users.

Run the script as a human Entra administrator able to resolve application identities in the directory. If automated under a service principal instead, SQL's server identity needs directory lookup permissions; this template does not provision those. The script is safe to rerun for unchanged identities. If an app's managed identity is recreated, have the database administrator remap its database user to the new identity; matching the old name is insufficient. The `apiPrincipalId` and `functionPrincipalId` outputs identify the current identities.

For local Azure SQL access, sign in with `az login` and use:

```text
Server=tcp:<sqlServerFullyQualifiedDomainName>,1433;Initial Catalog=<sqlDatabaseName>;Authentication=Active Directory Default;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

Use a developer identity with database access (for example, the configured administrator user or a member of the administrator group in these development environments). LocalDB connection strings remain unchanged. The local environment creates no hosted app identities, so skip the hosted-user script there.

For existing servers, enabling Entra-only authentication disables password-based SQL clients. Configure the Entra administrator and database users before switching application traffic. See [Microsoft's Entra-only provisioning guidance](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-azure-ad-only-authentication-create-server?view=azuresql) and [contained database users](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-user-transact-sql?view=sql-server-ver17).

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

## GitHub Actions deployment

Run **Actions → Deploy infrastructure → Run workflow**, then select `local`, `dev`, or `test`. The workflow is `.github/workflows/infra.yml`; it validates and deploys `main.bicep` using the matching parameter file. Local creates Azure dependencies only. Dev and test include application hosting. Application code is not published by this workflow.

Create GitHub environments named `local`, `dev`, and `test`. Configure these environment settings under **Secrets** or **Variables** as indicated:

| Setting | Type | Value |
| --- | --- | --- |
| `AZURE_CLIENT_ID` | Secret | Azure deployment identity's application/client ID |
| `AZURE_TENANT_ID` | Secret | Microsoft Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Secret | Target subscription ID |
| `AZURE_RESOURCE_GROUP` | Variable | Optional resource group name; defaults to `<workloadName>-<environmentName>` |
| `AZURE_RESOURCE_GROUP_LOCATION` | Variable | Optional resource group metadata region; defaults to `location` in the environment parameter file |
| `SQL_ENTRA_ADMINISTRATOR_NAME` | Variable | SQL administrator user's or group's display name |
| `SQL_ENTRA_ADMINISTRATOR_OBJECT_ID` | Variable | SQL administrator user's or group's Entra object ID |
| `SQL_ENTRA_ADMINISTRATOR_PRINCIPAL_TYPE` | Variable | `User` for a person or `Group` for a group |
| `BROWSER_PUSH_SUBJECT` | Secret | VAPID contact URI, such as `mailto:admin@example.com` |
| `BROWSER_PUSH_VAPID_PRIVATE_KEY` | Secret | VAPID private key |
| `BROWSER_PUSH_VAPID_PUBLIC_KEY` | Secret | Matching VAPID public key |

No SQL password secret is required.

Configure Azure federated credentials for the GitHub environments, with subject `repo:OWNER/REPOSITORY:environment:local` (and corresponding `dev` and `test` subjects), issuer `https://token.actions.githubusercontent.com`, and audience `api://AzureADTokenExchange`. The workflow uses [Azure Login's OIDC authentication](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended), so no Azure client secret is needed. Grant the deployment identity permission to create resources and role assignments, including permission to create the resource group if it does not exist.

The resource group defaults to `<workloadName>-<environmentName>`. Set the optional GitHub environment variable `AZURE_RESOURCE_GROUP` to use an existing/custom group and `AZURE_RESOURCE_GROUP_LOCATION` to choose its metadata region. For an existing group, use its current region. When omitted, the group region defaults to `location` in the environment parameter file. Individual resource locations remain controlled by the parameter file. The workflow writes credentials to a restricted temporary parameter file and removes it when the deployment step exits. Successful resource outputs appear in the run summary. Runs for the same environment are serialized, and active deployments are not canceled by a newer run.

## Azure DevOps pipeline

`azure-pipelines.yml` validates and deploys `main.bicep`. When manually running
the pipeline, select `local`, `dev`, or `test` from the `Environment`
parameter. The pipeline loads the corresponding variable group using this
naming convention:

```text
chatapp-infra-{environment}
```

For example, selecting `test` loads `chatapp-infra-test`. Create and authorize each environment's variable group with the following **required infrastructure inputs**. Use these exact Azure DevOps variable names; the YAML maps them to shell environment variables internally.

| Variable | Kind | Example / purpose |
| --- | --- | --- |
| `azureServiceConnection` | Variable | `sc-chatapp-dev`: authorized Azure Resource Manager service connection |
| `resourceGroupName` | Variable | `chatapp-dev`: resource group to create or deploy into |
| `resourceGroupLocation` | Variable | `southeastasia`: resource group metadata region; use its current region for an existing group |
| `sqlEntraAdministratorPrincipalType` | Variable | `User` for a person or `Group` for a group |
| `sqlEntraAdministratorName` | Variable | SQL administrator user's or group's Entra display name |
| `sqlEntraAdministratorObjectId` | Variable | Matching user's or group's Entra object ID |
| `azureNotificationsSubject` | Variable | VAPID contact URI, such as `mailto:admin@example.com` |
| `azureNotificationsVapidPrivateKey` | Secret | VAPID private key; enable **Keep this value secret** |
| `azureNotificationsVapidPublicKey` | Variable | Matching public VAPID key |

Unlike the GitHub workflow, the Azure DevOps pipeline requires explicit `resourceGroupName` and `resourceGroupLocation` values; it does not supply defaults. Individual resource regions and other resource settings come from `infra/parameters.{environment}.json`. No SQL password or separate Azure client credentials are required in the variable group: SQL uses Entra authentication, and the deployment uses `azureServiceConnection`.

For application releases through the root `azure-pipelines.release.yml`, also add these **release-only variables** to the same variable group after infrastructure deployment:

| Variable | Kind | Value |
| --- | --- | --- |
| `apiAppName` | Variable | Infrastructure deployment's `apiAppName` output |
| `functionAppName` | Variable | Infrastructure deployment's `functionAppName` output |
| `staticWebAppName` | Variable | Infrastructure deployment's `staticWebAppName` output |

The infrastructure pipeline prints these outputs but does not automatically save them to the variable group. Release also reuses `azureServiceConnection` and `resourceGroupName`. These hosting variables are unnecessary for `local`, which deploys dependencies only. `staticWebAppUrl` is not consumed by either pipeline and does not need to be configured. The release pipeline retrieves `staticWebAppDeploymentToken` from Azure and stores it as a secret pipeline variable during the run; do not add it manually.

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
