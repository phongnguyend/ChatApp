using ChatApp.Background;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddBackground(builder.Configuration);

var host = builder.Build();
await host.RunAsync();
