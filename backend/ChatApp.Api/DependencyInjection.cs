using ChatApp.Api.Services;
using ChatApp.Infrastructure.DocumentSigning;
using ChatApp.Api.Endpoints;
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
        services.AddApplicationEndpoints();
        services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = false);
        services.AddSignalR(options => options.AddFilter<AuthenticatedHubFilter>());
        services.AddHttpClient();
        services.AddPersistence(configuration);
        services.AddInfrastructure(configuration);
        services.AddDocumentSigningServices(configuration);
        services.AddSingleton<PresenceTracker>();
        services.AddSingleton<CallStateTracker>();
        services.AddSingleton<GroupMeetingStateTracker>();
        services.AddSingleton<RecordingStateTracker>();
        services.AddScoped<IAvatarStorage, AvatarStorage>();
        services.AddScoped<IMessageAttachmentStorage, MessageAttachmentStorage>();
        services.AddHostedService<LiveLocationExpiryService>();
        services.AddHostedService<FormAttachmentExpiryService>();

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

    public static IServiceCollection AddApplicationEndpoints(this IServiceCollection services)
    {
        services.AddScoped<AttachmentsEndpoints>();
        services.AddScoped<AvatarsEndpoints>();
        services.AddScoped<CallingEndpoints>();
        services.AddScoped<ConversationsEndpoints>();
        services.AddScoped<DocumentsEndpoints>();
        services.AddScoped<LiveStreamsEndpoints>();
        services.AddScoped<MeetingsEndpoints>();
        services.AddScoped<MessagesEndpoints>();
        services.AddScoped<PushNotificationsEndpoints>();
        services.AddScoped<RecordingsEndpoints>();
        services.AddScoped<SessionsEndpoints>();
        services.AddScoped<UserNotesEndpoints>();
        services.AddScoped<UserNotificationsEndpoints>();
        services.AddScoped<UserRemindersEndpoints>();
        services.AddScoped<UsersEndpoints>();
        services.AddScoped<UserTasksEndpoints>();
        return services;
    }

    public static void MapApplicationEndpoints(this WebApplication app)
    {
        FormsEndpoints.Map(app);

        AttachmentsEndpoints.Map(app);
        AvatarsEndpoints.Map(app);
        CallingEndpoints.Map(app);
        ConversationsEndpoints.Map(app);
        DocumentsEndpoints.Map(app);
        SignatureEndpoints.Map(app);

        SigningTemplateEndpoints.Map(app);

        LiveStreamsEndpoints.Map(app);
        MeetingsEndpoints.Map(app);
        MessagesEndpoints.Map(app);
        PushNotificationsEndpoints.Map(app);
        RecordingsEndpoints.Map(app);
        SessionsEndpoints.Map(app);
        UserNotesEndpoints.Map(app);
        UserNotificationsEndpoints.Map(app);
        UserRemindersEndpoints.Map(app);
        UsersEndpoints.Map(app);
        UserTasksEndpoints.Map(app);
    }
}
