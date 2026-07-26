namespace ChatApp.Api.Services;

public interface IMessageAttachmentStorage
{
    int MaxFilesPerMessage { get; }

    bool IsDisplayableImage(string contentType);

    bool IsDisplayableVideo(string contentType);

    Task<string> SaveAsync(
        Guid conversationId,
        Guid messageId,
        IFormFile file,
        CancellationToken cancellationToken);

    Task<Stream?> OpenReadAsync(
        string storageKey,
        CancellationToken cancellationToken);

    Task DeleteAsync(
        string storageKey,
        CancellationToken cancellationToken);

    string CleanFileName(string fileName);
}
