using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace ChatApp.Api.Authentication;

// Retain existing route contracts while refusing browser-supplied impersonation.
public sealed class AuthenticatedActorFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.HttpContext.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() is null)
        {
            var username = context.HttpContext.User.FindFirstValue("chat_username");
            foreach (var key in new[] { "username", "currentUsername" })
            {
                if (context.ActionArguments.TryGetValue(key, out var supplied) &&
                    !string.Equals(supplied as string, username, StringComparison.OrdinalIgnoreCase))
                {
                    context.Result = new ForbidResult();
                    return;
                }
            }
        }
        await next();
    }
}
