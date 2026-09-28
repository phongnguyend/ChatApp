namespace ChatApp.Api.Endpoints;

public static class EndpointRegistration
{
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
        AttachmentsEndpoints.Map(app);
        AvatarsEndpoints.Map(app);
        CallingEndpoints.Map(app);
        ConversationsEndpoints.Map(app);
        DocumentsEndpoints.Map(app);
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
