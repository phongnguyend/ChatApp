using Azure.Communication;
using Azure.Communication.CallAutomation;
using Azure.Communication.Identity;
using ChatApp.Api.Data;
using ChatApp.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ChatApp.Api.Services;

public sealed class AzureCommunicationServicesCallingProvider(
    ChatDbContext db,
    IOptions<CallingOptions> options,
    IOptions<AzureBlobOptions> blobOptions) : ICallingProvider
{
    private readonly string connectionString =
        options.Value.AzureCommunicationServices.ConnectionString;
    private readonly AzureBlobOptions blobOptions = blobOptions.Value;

    public string Name => "azure-communication-services";
    public bool ManagesMedia => true;
    public bool ManagesRecording => true;

    public async Task<CallingAccessCredential> GetAccessCredentialAsync(
        ChatUser user,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();
        var identity = await db.Set<CallingProviderIdentity>()
            .SingleOrDefaultAsync(
                item => item.UserId == user.Id && item.Provider == Name,
                cancellationToken);
        var identityClient = new CommunicationIdentityClient(connectionString);
        CommunicationUserIdentifier communicationUser;
        if (identity is null)
        {
            communicationUser = await identityClient.CreateUserAsync(
                cancellationToken);
            identity = new CallingProviderIdentity
            {
                User = user,
                UserId = user.Id,
                Provider = Name,
                ExternalIdentity = communicationUser.Id
            };
            db.Add(identity);
            await db.SaveChangesAsync(cancellationToken);
        }
        else
        {
            communicationUser =
                new CommunicationUserIdentifier(identity.ExternalIdentity);
        }

        var token = await identityClient.GetTokenAsync(
            communicationUser,
            [CommunicationTokenScope.VoIP],
            TimeSpan.FromHours(8),
            cancellationToken);
        return new CallingAccessCredential(
            Name,
            ManagesMedia,
            ManagesRecording,
            communicationUser.Id,
            token.Value.Token,
            token.Value.ExpiresOn);
    }

    public async Task<string> StartRecordingAsync(
        string callLocator,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();
        if (!blobOptions.IsValid())
        {
            throw new InvalidOperationException(
                "Azure Blob storage must be configured for call recordings.");
        }
        var client = new CallAutomationClient(connectionString);
        var options = new StartRecordingOptions(
            new GroupCallLocator(callLocator))
        {
            RecordingChannel = RecordingChannel.Mixed,
            RecordingContent = RecordingContent.AudioVideo,
            RecordingFormat = RecordingFormat.Mp4,
            RecordingStorage =
                RecordingStorage.CreateAzureBlobContainerRecordingStorage(
                    blobOptions.CreateBlobContainerClient().Uri)
        };
        var response = await client.GetCallRecording().StartAsync(
            options,
            cancellationToken);
        return response.Value.RecordingId;
    }

    public async Task StopRecordingAsync(
        string providerRecordingId,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();
        var client = new CallAutomationClient(connectionString);
        var recording = client.GetCallRecording();
        var state = await recording.GetStateAsync(
            providerRecordingId,
            cancellationToken);
        if (state.Value.RecordingState != RecordingState.Active) return;
        await recording.StopAsync(providerRecordingId, cancellationToken);
    }

    private void EnsureConfigured()
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Calling:AzureCommunicationServices:ConnectionString is required.");
        }
    }
}
