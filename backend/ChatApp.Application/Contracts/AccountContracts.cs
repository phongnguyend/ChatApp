namespace ChatApp.Application.Contracts;

public sealed record ManageUserRequest(string Email, string? FirstName, string? LastName, string? PhoneNumber, bool IsEnabled, string[] Roles);
public sealed record ManagePasswordAuthenticationRequest(bool AllowPasswordAuthentication, string? Password = null);
public sealed record UserProfileRequest(string? FirstName, string? LastName, string? PhoneNumber);
public sealed record EnabledRequest(bool IsEnabled);
