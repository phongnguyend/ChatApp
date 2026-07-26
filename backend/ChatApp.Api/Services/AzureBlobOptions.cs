using Azure.Identity;
using Azure.Storage.Blobs;

namespace ChatApp.Api.Services;

public sealed class AzureBlobOptions
{
    public bool UseManagedIdentity { get; set; }

    public string ConnectionString { get; set; } = "";

    public string StorageAccountName { get; set; } = "";

    public string Container { get; set; } = "";

    public string Path { get; set; } = "";

    public string LocalCacheFolder { get; set; } = "upload-cache";

    public bool IsValid() =>
        !string.IsNullOrWhiteSpace(Container) &&
        !string.IsNullOrWhiteSpace(LocalCacheFolder) &&
        (UseManagedIdentity
            ? !string.IsNullOrWhiteSpace(StorageAccountName)
            : !string.IsNullOrWhiteSpace(ConnectionString));

    public BlobContainerClient CreateBlobContainerClient()
    {
        if (UseManagedIdentity)
        {
            var containerUri = new Uri(
                $"https://{StorageAccountName}.blob.core.windows.net/{Container}");
            return new BlobContainerClient(
                containerUri,
                new DefaultAzureCredential());
        }

        return new BlobContainerClient(ConnectionString, Container);
    }
}
