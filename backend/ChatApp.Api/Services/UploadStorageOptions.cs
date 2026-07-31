namespace ChatApp.Api.Services;

public sealed class UploadStorageOptions
{
    public const string SectionName = "UploadStorage";

    public string Provider { get; set; } = "Local";

    public string Path { get; set; } = "/uploads";

    public string RecordingTempPath { get; set; } = "";
}
