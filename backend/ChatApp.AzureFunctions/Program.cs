using ChatApp.Application.Data;
using ChatApp.Application.Handlers;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();

builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("ChatDatabase")));
builder.Services.AddHttpClient<RecordingFileStatusUpdatedHandler>(client =>
{
    var baseUrl = builder.Configuration["Api:BaseUrl"] ??
        "http://localhost:5045";
    client.BaseAddress = new Uri(baseUrl, UriKind.Absolute);
});

builder.Services
    .AddApplicationInsightsTelemetryWorkerService()
    .ConfigureFunctionsApplicationInsights();

builder.Build().Run();
