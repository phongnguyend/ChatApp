namespace ChatApp.Api.Services;

public interface IUploadObjectStorage
{
    Task WriteAsync(
        string key,
        Stream content,
        CancellationToken cancellationToken);

    Task<Stream?> OpenReadAsync(
        string key,
        CancellationToken cancellationToken);

    Task DeleteAsync(
        string key,
        CancellationToken cancellationToken);
}
