using ChatApp.Application.Abstractions;
using ChatApp.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ChatApp.Persistence;

public static class DependencyInjection
{
    public static IServiceCollection AddPersistence(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<ChatAppDbContext>(options =>
            options.UseSqlServer(
                configuration.GetConnectionString("ChatDatabase"),
                sqlServer => sqlServer.MigrationsAssembly(typeof(ChatAppDbContext).Assembly.FullName)));
        services.AddScoped<IRecordingRepository, RecordingRepository>();
        return services;
    }
}
