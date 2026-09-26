using ChatApp.Api.Services;
using ChatApp.Api.Authentication;
using Microsoft.AspNetCore.SignalR;
using ChatApp.Infrastructure;
using ChatApp.Infrastructure.Caching;
using ChatApp.Persistence;

namespace ChatApp.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddApi(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddControllers(options => options.Filters.Add<AuthenticatedActorFilter>());
        services.AddSignalR(options => options.AddFilter<AuthenticatedHubFilter>());
        services.AddHttpClient();
        services.AddPersistence(configuration);
        services.AddInfrastructure(configuration);
        services.AddSingleton<PresenceTracker>();
        services.AddSingleton<CallStateTracker>();
        services.AddSingleton<GroupMeetingStateTracker>();
        services.AddSingleton<RecordingStateTracker>();
        services.AddScoped<IAvatarStorage, AvatarStorage>();
        services.AddScoped<IMessageAttachmentStorage, MessageAttachmentStorage>();
        services.AddHostedService<LiveLocationExpiryService>();

        var allowedOrigins = configuration
            .GetSection("AllowedOrigins")
            .Get<string[]>() ?? ["http://localhost:5173"];

        services.AddCors(options =>
        {
            options.AddPolicy("ReactApp", policy =>
                policy.WithOrigins(allowedOrigins)
                    .AllowAnyHeader()
                    .AllowAnyMethod()
                    .AllowCredentials());
        });
        return services;
    }
}
