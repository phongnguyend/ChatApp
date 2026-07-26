namespace ChatApp.Api.Services;

public interface IAvatarStorage
{
    Task<string> SaveAsync(
        IFormFile image,
        CancellationToken cancellationToken);

    Task<Stream?> OpenReadAsync(
        string fileName,
        CancellationToken cancellationToken);
}
