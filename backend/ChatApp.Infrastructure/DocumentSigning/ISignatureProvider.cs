namespace ChatApp.Infrastructure.DocumentSigning;

public sealed record SignatureRecipient(string Name, string Email);

public sealed record SignatureInput(string Provider, string Subject, string? Message, SignatureRecipient[] Recipients, Guid ClientRequestId);

public interface ISignatureProvider
{
    string Name { get; }

    bool Enabled { get; }

    Task<string> CreateDraftAsync(string fileName, byte[] pdf, SignatureInput input, CancellationToken ct);

    Task<string> GetPreparationUrlAsync(string externalId, CancellationToken ct);

    Task<string> GetStatusAsync(string externalId, CancellationToken ct);

    Task<byte[]> DownloadAsync(string externalId, bool audit, CancellationToken ct);
}
