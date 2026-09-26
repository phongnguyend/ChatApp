using ChatApp.Api;
using ChatApp.Api.Hubs;
using ChatApp.Persistence;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddApi(builder.Configuration);

var app = builder.Build();

app.UseCors("ReactApp");
app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ChatAppDbContext>();
    await DatabaseInitializer.InitializeAsync(db);
}

app.Run();

public partial class Program;
