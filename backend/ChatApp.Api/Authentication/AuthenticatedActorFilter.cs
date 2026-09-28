using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;

namespace ChatApp.Api.Authentication;

// Retain existing route contracts while refusing browser-supplied impersonation.
public static class AuthenticatedActorFilter
{
    public static EndpointFilterDelegate Create(EndpointFilterFactoryContext factory, EndpointFilterDelegate next)
    {
        var actorIndexes = factory.MethodInfo.GetParameters()
            .Select((parameter, index) => (parameter, index))
            .Where(item => item.parameter.Name is "username" or "currentUsername")
            .Select(item => item.index).ToArray();
        return async context =>
        {
            if (context.HttpContext.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() is null)
            {
                var username = context.HttpContext.User.FindFirstValue("chat_username");
                foreach (var index in actorIndexes)
                {
                    // A failed required-parameter binding must remain a 400,
                    // rather than being reported as an impersonation attempt.
                    if (context.Arguments[index] is null)
                    {
                        return Results.BadRequest();
                    }

                    if (!string.Equals(context.Arguments[index] as string, username, StringComparison.OrdinalIgnoreCase))
                    {
                        return Results.Forbid();
                    }
                }
            }
            return await next(context);
        };
    }
}
