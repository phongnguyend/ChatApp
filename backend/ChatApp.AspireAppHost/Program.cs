var builder = DistributedApplication.CreateBuilder(args);

var api = builder.AddProject<Projects.ChatApp_Api>("ChatApp-Api");
//var background = builder.AddProject<Projects.ChatApp_Background>("ChatApp-Background");
builder.AddAzureFunctionsProject<Projects.ChatApp_AzureFunctions>("ChatApp-AzureFunctions").WaitFor(api);

builder.Build().Run();