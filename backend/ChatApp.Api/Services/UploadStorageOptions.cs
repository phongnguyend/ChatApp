namespace ChatApp.Api.Services;

public sealed class UploadStorageOptions
{
    public const string SectionName = "UploadStorage";

    public string Path { get; set; } = "/uploads";
}
