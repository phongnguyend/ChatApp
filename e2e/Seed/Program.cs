using ChatApp.Domain.Models;
using ChatApp.Domain.Security;
using ChatApp.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

// Test-only provisioning, deliberately separate from API startup and configuration.
var connection = Environment.GetEnvironmentVariable("E2E_CONNECTION_STRING")
    ?? @"Server=(localdb)\mssqllocaldb;Database=ChatAppE2E;Trusted_Connection=True;TrustServerCertificate=True";
var email = Environment.GetEnvironmentVariable("E2E_ADMIN_EMAIL") ?? throw new InvalidOperationException("E2E_ADMIN_EMAIL required.");
var password = Environment.GetEnvironmentVariable("E2E_ADMIN_PASSWORD") ?? throw new InvalidOperationException("E2E_ADMIN_PASSWORD required.");
await using var db = new ChatAppDbContext(new DbContextOptionsBuilder<ChatAppDbContext>().UseSqlServer(connection).Options);
await db.Database.MigrateAsync();
await using var transaction = await db.Database.BeginTransactionAsync();
var role = await db.Roles.SingleOrDefaultAsync(x => x.NormalizedName == "GLOBAL ADMIN");
if (role is null)
{
    role = new IdentityRole<Guid>(AppRoles.GlobalAdmin) { NormalizedName = "GLOBAL ADMIN" };
    db.Roles.Add(role);
    await db.SaveChangesAsync();
}
var normalized = email.ToUpperInvariant();
var user = await db.Users.SingleOrDefaultAsync(x => x.NormalizedEmail == normalized || x.NormalizedUserName == normalized);
if (user is null)
{
    user = new ChatUser { UserName = email, NormalizedUserName = normalized };
    db.Users.Add(user);
}
user.Email = email;
user.NormalizedEmail = normalized;
user.IsEnabled = true;
user.Status = "active";
user.AllowPasswordAuthentication = true;
user.LockoutEnabled = true;
user.LockoutEnd = null;
user.AccessFailedCount = 0;
user.SecurityStamp = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
user.PasswordHash = new PasswordHasher<ChatUser>().HashPassword(user, password);
await db.SaveChangesAsync();
if (!await db.UserRoles.AnyAsync(x => x.UserId == user.Id && x.RoleId == role.Id))
    db.UserRoles.Add(new IdentityUserRole<Guid> { UserId = user.Id, RoleId = role.Id });
await db.SaveChangesAsync();
await transaction.CommitAsync();
Console.WriteLine("E2E administrator prepared.");
