using ChatApp.Domain.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Persistence;

public static class DatabaseInitializer
{
    public const string GeneralConversationTitle = "General";

    public static async Task InitializeAsync(ChatAppDbContext db)
    {
        await db.Database.MigrateAsync();

        if (!await db.Conversations.AnyAsync(
                x => x.Type == "group" && x.Title == GeneralConversationTitle))
        {
            db.Conversations.Add(new Conversation
            {
                Type = "group",
                Title = GeneralConversationTitle
            });
            await db.SaveChangesAsync();
        }
    }
}
