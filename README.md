# Huddle Chat App

A simple real-time chat application built with:

- ASP.NET Core 10 Web API and SignalR
- Entity Framework Core 10 with SQL Server
- React 19, TypeScript, and Vite
- ASP.NET Identity accounts, password/Google/Microsoft sign-in, and User/Global Admin roles

The app includes persistent message history, pair-unique direct messages,
multi-person group creation, live group member management, user discovery, online
presence, typing indicators, unread counts, profile and group avatar uploads,
member tagging (including `@everyone`) plus reply notifications linked to the
new message,
persistent conversation message pinning, single- and multiple-choice
in-conversation polls with expiration and live vote totals, camera capture,
current-location sharing with confirmation previews, start/stop
live-location sharing with an updating Leaflet map, automatic
SignalR reconnection, SignalR-coordinated direct and group meetings whose audio,
video, screen sharing, and server-side recording run through Azure Communication
Services, and responsive desktop/mobile layouts. ACS-powered live-stream conversations let a
host start and stop multiple historical sessions while enforcing one active
live stream per host; viewers join through regular conversation membership and
only the host can publish camera, microphone, or screen-share media. Browser push
notifications are delivered through Azure Notification
Hubs, the Azure browser-push service used alongside Azure Communication Services.
Uploaded avatars and message attachments use the configured upload storage
provider, while their relative URLs are persisted in SQL Server. Local
development uses `LocalUploadObjectStorage` and the API's `uploads` directory.
The complete relational model below is represented by EF Core entities and
migrations.

Physical upload persistence is isolated behind `IUploadObjectStorage`; the
local and Azure Blob implementations can be selected without changing
controllers, avatar handling, attachment handling, URLs, or database storage
keys.

Set `UploadStorage:Provider` to `AzureBlob` to use Azure Blob Storage. Configure
`UploadStorage:AzureBlob` with `Container`, `Path`, and `LocalCacheFolder`, plus
either a `ConnectionString` or `UseManagedIdentity: true` and
`StorageAccountName`. Uploads stream directly to Azure. Reads use the local cache
first and atomically populate it from Azure on a cache miss. The configured
container must already exist. Keep connection strings out of `appsettings.json`;
use
`UploadStorage__AzureBlob__ConnectionString` or user secrets.

Document storage defaults to `Documents:DefaultStorageLimitBytes` (5 GiB in
`appsettings.json`). The Storage management screen shows each user's document
usage, including older versions, and lets a Global Admin set an individual
limit or restore the default. Both the screen and API require the Global Admin role.

## Project structure

```text
backend/
  ChatApp.slnx
  ChatApp.Api/
    Endpoints/
    Hubs/
    DependencyInjection.cs
    Dockerfile
    Program.cs
  ChatApp.Application/
    Abstractions/
    Contracts/
    Handlers/
  ChatApp.AspireAppHost/
    Program.cs
  ChatApp.Background/
    DependencyInjection.cs
    Dockerfile
    Program.cs
  ChatApp.Domain/
    Models/
  ChatApp.Infrastructure/
    Caching/
    Calling/
    Indexing/
    Logging/
    Messaging/
    Monitoring/
    Notification/
    Storage/
  ChatApp.Persistence/
    Migrations/
    Repositories/
    ChatAppDbContext.cs
  ChatApp.AzureFunctions/
    Program.cs
frontend/
  src/
    components/
    pages/
  scripts/
```

Domain contains entities; Application contains contracts, abstractions, and the
recording use case. Persistence owns EF Core, migrations, and repository
implementations. Infrastructure owns external providers and in-memory state.
API, Background, and Azure Functions compose these libraries; the existing
Azure Functions host remains available through Aspire. API-specific SignalR
coordination and HTTP upload adapters remain in the API project. Indexing,
Logging, and Monitoring contain extension-point documentation until shared
implementations are needed.

HTTP feature routes are Minimal API groups in `ChatApp.Api/Endpoints`.
`DependencyInjection.cs` registers their scoped handlers and maps them from
`Program.cs`. Route mappings declare binding, authorization, and upload limits;
shared endpoint filters validate request bodies and reject username impersonation.
Authentication and account routes remain in `ChatApp.Api/Authentication`.

Build container images from the repository root:

```powershell
docker build -f backend/ChatApp.Api/Dockerfile -t chatapp-api backend
docker build -f backend/ChatApp.Background/Dockerfile -t chatapp-background backend
```

Supply connection strings and provider settings through environment variables
when running the containers. Use a reachable SQL Server connection instead of
LocalDB in containers. The API listens on port 8080; mount persistent storage
at `/app/uploads` when using local upload storage. Background processes Service
Bus events when `Messaging__Provider=AzureServiceBus` is configured; set
`Api__BaseUrl` to the API's reachable URL.

Page views and their styles live in `frontend/src/pages`. Shared UI components
and their supporting modules live in `frontend/src/components`. `src/App.tsx`
composes the application and selects the active page.

## Run locally

Prerequisites:

- .NET 10 SDK
- Node.js 20 or newer
- SQL Server LocalDB, or another SQL Server instance

The default connection string uses `(localdb)\mssqllocaldb`. To use another SQL
Server instance, update `ConnectionStrings:ChatDatabase` in
`backend/ChatApp.Api/appsettings.json` or provide it through configuration.

Start the API:

```powershell
cd backend
dotnet restore
dotnet run --project ChatApp.Api
```

The API applies pending EF Core migrations automatically and listens at
`http://localhost:5045` with the default HTTP launch profile.

Start the React app in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` and sign in with your account to join the General conversation.

### Accounts and first administrator

Before starting the API, supply `Authentication__Jwt__SigningKey` as at least
32 random bytes encoded in base64. Keep it in user secrets or your deployment's
secret store. All API instances must use the same key. JWT issuer and audience
default to `ChatApp` and `ChatApp.Api`; the default lifetime is 60 minutes.

For local PowerShell development, set the signing key before `dotnet run`:

```powershell
$signingBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($signingBytes)
$env:Authentication__Jwt__SigningKey = [Convert]::ToBase64String($signingBytes)
```

Startup ensures the built-in role definitions exist; it does not create users,
set passwords, or assign permissions to existing accounts. To grant an existing
user a role, set `@UserId` and `@RoleName` in
[`backend/scripts/assign-user-role.sql`](backend/scripts/assign-user-role.sql)
and run it against the migrated database. The script is idempotent and records
new grants in the activity log. It does not change credentials or enable accounts.
The first administrator must already have a working sign-in method (for example,
sign in through a configured Google or Microsoft provider, then grant that user
`Global Admin`).

The account migration preserves existing chat user IDs, memberships, messages,
and files. Legacy accounts start without credentials. In **Users**, an
administrator can assign an email once, then enable password authentication and
set a password. Alternatively, after email assignment, an unlinked account can
sign in with a verified Google identity. Existing account emails are immutable.

Global Admins can create/edit users, assign the fixed `User` and `Global Admin`
roles, view lockout state, enable/disable accounts, and manage password access.
Users cannot disable themselves or remove their own Global Admin role, and the
last enabled administrator is protected. Authentication and user-management changes appear in the admin activity log.

**Account settings** supports profile changes, password changes, and connecting
a Microsoft identity. Five failed password attempts lock password sign-in for
15 minutes. Password changes and sign-out invalidate existing application
sessions across devices. Disabled accounts lose API access immediately; open
SignalR connections are checked on every invocation and every 10 seconds.
Role changes are reloaded on each authenticated API request.

Google sign-in requires `Authentication__Google__ClientId` on the API and
`VITE_GOOGLE_CLIENT_ID` in the frontend. Register the frontend redirect URI
(locally `http://localhost:5173/`) and set `VITE_GOOGLE_REDIRECT_URI` if needed.
Microsoft sign-in requires `Authentication__Microsoft__ClientId`,
`Authentication__Microsoft__TenantId`, `VITE_MICROSOFT_CLIENT_ID`, and
`VITE_MICROSOFT_TENANT_ID`; register the frontend redirect as an SPA and optionally
set `VITE_MICROSOFT_REDIRECT_URI`. Microsoft accounts with an existing email must
be explicitly connected from an authenticated profile; they are never merged by email.
Neither provider requires copying credentials from the Webhooks project.

API calls use application Bearer tokens stored in browser session storage.
An HttpOnly cookie supports protected media GETs only; it never authorizes
mutations. Use HTTPS in production. Prefer same-site frontend/API domains so
browser third-party cookie restrictions do not block authenticated media.
Public document links and avatar images remain public; username-only sessions
and caller-supplied identity impersonation are no longer supported.

Set the same secret `RecordingCallbacks__Key` on API, Background, and Azure
Functions when using recording processing. The internal completion callback
requires this key; application user tokens cannot authorize it.

Direct calls, group meetings, live streams, and call recording require Azure
Communication Services. Configure the API with the resource connection string;
the connection string remains server-side and the frontend receives only a
short-lived VoIP user token:

```powershell
$env:Calling__Provider = "AzureCommunicationServices"
$env:Calling__AzureCommunicationServices__ConnectionString = "<acs-connection-string>"
dotnet run --project backend/ChatApp.Api
```

SignalR continues to carry invitations, acceptance/decline, participant state,
screen-share ownership, and recording-consent/status events. It does not carry
SDP, ICE, audio, video, or screen media.

## Azure browser push notifications

Azure Communication Services Chat push notifications target the native Android
and iOS Chat SDKs. Because Huddle is a browser app with its own SignalR chat
backend, it uses Azure Notification Hubs Browser Push for web notifications.

1. Create an Azure Notification Hubs namespace and notification hub.
2. In the hub's **Browser (Web Push)** settings, configure a VAPID public/private
   key pair.
3. Provide the API with the hub's full-access connection string, hub name, the
   matching VAPID public key, and the public frontend URL:

```powershell
$env:Notification__AzureNotificationHub__ConnectionString = "<notification-hub-connection-string>"
$env:Notification__AzureNotificationHub__HubName = "<notification-hub-name>"
$env:Notification__AzureNotificationHub__VapidPublicKey = "<vapid-public-key>"
$env:Notification__AzureNotificationHub__FrontendBaseUrl = "https://chat.example.com"
dotnet run --project backend/ChatApp.Api
```

Keep the connection string server-side. Do not add it to `appsettings.json` or
the React environment. Once configured, users can enable or disable
notifications with the bell button in the conversation header. Notifications
are shown for incoming messages even while Huddle is visible, respect
conversation mute state, and open the relevant conversation when clicked.

To verify the production builds and live persistence flow:

```powershell
dotnet build backend/ChatApp.slnx
npm --prefix frontend run build
# These scripts create accounts in the target environment; use a test database.
$env:TEST_ADMIN_EMAIL = 'admin@example.com'
$env:TEST_ADMIN_PASSWORD = Read-Host 'Test administrator password'
npm --prefix frontend run test:smoke
```


## Image and Office previews in My Documents

Open an image, `.docx`, `.xlsx`, or `.pptx` file in My Documents to preview it in the app. Files are downloaded with the current user's permissions and rendered locally in the browser; these previews do not require public links or upload files to an external Office viewer.

- Images fit the preview area, with download and maximize/restore controls.
- Word documents render as pages. Excel previews include worksheet tabs, formatted values, merged cells, and row/column paging. PowerPoint previews include slide thumbnails and previous/next navigation.
- Properties, version history, and permitted clone/replace actions remain available in the preview footer. Escape closes the viewer.

These are read-only previews of modern Office formats. Complex layouts may differ from Microsoft Office, and spreadsheet formulas display stored results rather than recalculating. Older `.doc`, `.xls`, and `.ppt` files retain the download fallback. Download the original when exact Office fidelity is needed.

## PDF signing in My Documents

In the in-app signature or initials dialog, you can draw, upload, drag and drop, or paste a PNG, JPEG, or WebP image (up to 5 MB). Imported images are resized and converted to PNG locally, with a preview before **Apply**. **Clear** returns to drawing, and **Apply to all** reuses the image in the remaining fields of the same type. Nothing is applied until you confirm it.

Under **Place fields → Templates**, save the current layout as a personal template, rename or update it, or delete it. Loading a template can replace the current fields or add to them; fields beyond the current document's page count are skipped. Templates store positions and field types only—signature images, dates, and text values are removed. Review the layout and choose **Save fields** after loading. Each user can keep up to 100 templates, and templates remain private even from other administrators. The `AddSigningTemplates` migration adds the template table with database-generated IDs.

Choose **Signatures** on a PDF row or in its preview. Only a file owner or editor can start a request; requests and their downloads belong to the user who created them. Public links and viewer access do not grant signing access.

- **In-App Signature** is enabled by default. Choose **Open signing editor**, place Signature, Initials, Date, and Text fields, save the layout, switch to **Sign**, draw the signature, and choose **Finish**. Fields can be dragged, resized, and nudged with arrow keys. The signed PDF and its audit record can be previewed and downloaded from **Signing requests**. Optional signer names/emails are recorded only; this mode does not notify or collect signatures from other people. These are drawn signatures, not certificate-based digital signatures.
- **DocuSign** and **Adobe Acrobat Sign** use a shared organization sender account. Enter the subject, optional message, and 1?20 recipients in signing order. **Create draft** uploads the PDF but does not send invitations. **Open preparation screen** opens the provider so you can place fields, review, and send. Back in Huddle, **Refresh status** retrieves the latest state; signed documents and audit records become available when all recipients finish.

Each request saves an immutable copy of the original PDF. Replacing the source later does not change an existing signing request, and signing never overwrites the source. PDFs must be at most 30 MB; completed uploads allow up to 60 MB. In-app signing rejects encrypted PDFs. Source snapshots and in-app signed copies count against the requesting user's document storage limit. Documents referenced by signing requests cannot be permanently deleted. In-app drafts may be discarded; completed requests cannot be edited or removed. A provider call whose result is uncertain is marked **NeedsReview** and is never automatically resent: check the provider account before deleting the local record or starting a replacement.

The `AddDocumentSigning` migration adds signing requests, using database-generated IDs. It runs through the existing database initialization flow. Only the creator can save fields or complete a request. In-app audit PDFs record account identity, timestamps, fields, and SHA-256 hashes; the browser generates the flattened PDF, while the server validates the saved field state and records the uploaded bytes. This is not independent server verification that the PDF contains those fields.

### Signing provider configuration

Configure API runtime settings through user secrets locally or App Service configuration / Key Vault references in Azure. Never put provider credentials in frontend settings. No personal provider login is required in Huddle. Both external providers are disabled by default.

| API setting | Purpose |
| --- | --- |
| `DocumentSigning__InApp__Enabled` | Defaults to `true`; set `false` to disable new in-app requests. |
| `DocumentSigning__ReturnUrl` | Huddle frontend URL used when leaving the DocuSign preparation screen; HTTPS in production. |
| `DocumentSigning__DocuSign__Enabled` | Enable after configuring the shared sender. |
| `DocumentSigning__DocuSign__Demo` | `true` for developer accounts, `false` for production. |
| `DocumentSigning__DocuSign__ApiBaseUrl` | Account REST base URL ending in `/restapi/v2.1/`, such as `https://demo.docusign.net/restapi/v2.1/`. |
| `DocumentSigning__DocuSign__AccountId` | API account GUID. |
| `DocumentSigning__DocuSign__ClientId` | Integration key GUID. |
| `DocumentSigning__DocuSign__SenderUserId` | Shared sender API user GUID. |
| `DocumentSigning__DocuSign__PrivateKeyPem` | Secret: registered RSA private key PEM, including header and footer. |
| `DocumentSigning__AdobeSign__Enabled` | Enable after configuring the shared sender. |
| `DocumentSigning__AdobeSign__ApiAccessPoint` | Regional API origin returned by OAuth, e.g. `https://api.na1.adobesign.com`, without `/api/rest/v6`. |
| `DocumentSigning__AdobeSign__ClientId` | OAuth client ID. |
| `DocumentSigning__AdobeSign__ClientSecret` | Secret: OAuth client secret. |
| `DocumentSigning__AdobeSign__RefreshToken` | Secret: refresh token authorized by the shared sender. |

For DocuSign, register the integration and RSA key and obtain sender consent to `signature impersonation`; production also requires the account-specific production REST base URL. See [DocuSign shared-system-user authentication](https://www.docusign.com/blog/developers/the-trenches-authenticate-without-user-interaction-system-user). For Adobe, authorize the shared sender with `agreement_read:self agreement_write:self agreement_send:self user_login:self`; retain the refresh token and regional API access point from the OAuth response. See [Adobe OAuth setup](https://opensource.adobe.com/acrobat-sign/developer_guide/gstarted.html). Provider tests use fake HTTP responses and do not send documents or invitations to real accounts.

# Database Schema

Below is the relational schema for the collaboration application, covering:

- One-to-one conversations
- Group chats
- Live-stream conversations and session history
- Message replies
- Attachments
- Reactions
- Read receipts
- Message editing and deletion
- Conversation-member tagging, mention notifications, and reply notifications
- Persistent message pinning
- Single- and multiple-choice conversation polls with optional expiration
- Member roles
- Muting and leaving conversations
- Calling identities, recordings, and scheduled meetings
- Tasks, reminders, notes, and in-app notifications
- Personal documents, sharing, public links, version history, and resumable uploads

PostgreSQL-style table definitions are used for readability. The application
itself targets SQL Server through Entity Framework Core; the authoritative model
is `backend/ChatApp.Persistence/ChatAppDbContext.cs`, and migrations are in
`backend/ChatApp.Persistence/Migrations`.

## 1. Core relationships

```text
User
  |-- ConversationMember -- Conversation -- Message
  |                              |           |-- MessageAttachment
  |                              |           |-- MessageReaction
  |                              |           |-- MessageReceipt
  |                              |           `-- MessagePoll -- MessagePollOption -- MessagePollVote
  |                              |           |-- MessageVersion
  |                              |           `-- LiveLocationShare
  |                              |-- LiveStreamSession
  |                              |-- SessionRecording
  |                              `-- ScheduledMeeting -- ScheduledMeetingParticipant
  |-- CallingProviderIdentity
  |-- UserTask -- UserTaskShare
  |-- UserNote -- UserNoteShare
  |-- UserReminder
  |-- UserNotification
  `-- DocumentFolder -- StoredDocument -- DocumentVersion
                         |-- DocumentShare
                         |-- DocumentPublicLink
                         `-- DocumentUploadSession -- DocumentUploadChunk
```

A conversation represents either:

- A direct chat between two users
- A group chat
- A live stream with one host and any number of conversation-member viewers

## 2. Users

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY,
    username        VARCHAR(50) NOT NULL UNIQUE,
    display_name    VARCHAR(100) NOT NULL,
    avatar_url      TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    document_storage_limit_bytes BIGINT,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_users_status
        CHECK (status IN ('active', 'suspended', 'deleted')),
    CONSTRAINT ck_users_document_storage_limit
        CHECK (
            document_storage_limit_bytes IS NULL
            OR document_storage_limit_bytes > 0
        )
);
```

Authentication credentials should usually live in a separate identity system or table rather than inside the chat domain.

## 3. Conversations

```sql
CREATE TABLE conversations (
    id                  UUID PRIMARY KEY,
    type                VARCHAR(20) NOT NULL,
    title               VARCHAR(200),
    avatar_url          TEXT,

    created_by_user_id  UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    last_message_id     UUID,
    last_message_at     TIMESTAMPTZ,

    is_archived         BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT ck_conversations_type
        CHECK (type IN ('direct', 'group', 'live_stream'))
);
```

A `live_stream` conversation is the persistent chat and membership container.
Starting the broadcast creates a `live_stream_sessions` row; stopping it ends
that row without deleting the conversation or its message history. A user may
create any number of live-stream conversations and sessions, but may host only
one active session at a time.

`last_message_id` and `last_message_at` are denormalized fields. They make the conversation-list query much faster.

The foreign key for `last_message_id` can be added after creating the `messages` table.

## 4. Conversation members

```sql
CREATE TABLE conversation_members (
    conversation_id         UUID NOT NULL
                            REFERENCES conversations(id)
                            ON DELETE CASCADE,

    user_id                 UUID NOT NULL
                            REFERENCES users(id),

    role                    VARCHAR(20) NOT NULL DEFAULT 'member',

    joined_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at                 TIMESTAMPTZ,

    last_read_message_id    UUID,
    last_read_at            TIMESTAMPTZ,
    last_read_sequence      BIGINT NOT NULL DEFAULT 0,
    unread_count            INTEGER NOT NULL DEFAULT 0,

    muted_until             TIMESTAMPTZ,
    is_archived             BOOLEAN NOT NULL DEFAULT FALSE,

    PRIMARY KEY (conversation_id, user_id),

    CONSTRAINT ck_conversation_member_role
        CHECK (role IN ('owner', 'admin', 'member'))
);
```

This table holds both membership and user-specific conversation state.

Live streams reuse this table for both hosts and viewers. There is no separate
live-stream viewer table: joining adds or reactivates a conversation member, and
leaving records `left_at` while preserving the conversation and session history.

For example:

- Alice archives a conversation without affecting Bob.
- Alice mutes a group without muting it for everyone.
- Each user has their own `last_read_message_id`.

### Unread-message calculation

Once messages use a sequence number (described in section 5), the unread count becomes:

```sql
SELECT COUNT(*)
FROM messages
WHERE conversation_id = :conversationId
  AND sequence_number > :lastReadSequence
  AND sender_user_id <> :currentUserId
  AND deleted_at IS NULL;
```

For a high-traffic application, avoid calculating this count repeatedly. The denormalized `unread_count` stored for each member should be updated when:

- A message is sent
- A user reads the conversation
- A message is removed

### 4.1 Live-stream sessions

Each start/stop cycle is stored independently so one live-stream conversation
can retain many past sessions.

```sql
CREATE TABLE live_stream_sessions (
    id                  UUID PRIMARY KEY,
    conversation_id     UUID NOT NULL
                        REFERENCES conversations(id)
                        ON DELETE CASCADE,

    host_user_id        UUID NOT NULL
                        REFERENCES users(id),

    provider            VARCHAR(80) NOT NULL,
    provider_call_id    VARCHAR(500) NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL,
    ended_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_live_stream_active_conversation
ON live_stream_sessions (conversation_id)
WHERE ended_at IS NULL;

CREATE UNIQUE INDEX uq_live_stream_active_host
ON live_stream_sessions (host_user_id)
WHERE ended_at IS NULL;
```

The first filtered index prevents two active sessions in the same conversation.
The second enforces the product rule that one user can host only one active live
stream at a time. Ended rows remain available as session history. Host and viewer
join/leave activity, along with session start/stop activity, is stored as
`system` messages in the conversation.

## 5. Messages

```sql
CREATE TABLE messages (
    id                  UUID PRIMARY KEY,
    conversation_id     UUID NOT NULL
                        REFERENCES conversations(id)
                        ON DELETE CASCADE,

    sender_user_id      UUID
                        REFERENCES users(id),

    reply_to_message_id UUID
                        REFERENCES messages(id),

    message_type        VARCHAR(20) NOT NULL DEFAULT 'text',
    content             TEXT,
    location_latitude   NUMERIC(9, 6),
    location_longitude  NUMERIC(9, 6),

    client_message_id   VARCHAR(100),
    sequence_number     BIGINT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at           TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    pinned_by_user_id   UUID REFERENCES users(id),
    pinned_at           TIMESTAMPTZ,

    CONSTRAINT ck_messages_type
        CHECK (
            message_type IN (
                'text',
                'image',
                'file',
                'audio',
                'video',
                'location',
                'live_location',
                'poll',
                'system'
            )
        ),

    CONSTRAINT ck_messages_location
        CHECK (
            (
                message_type = 'location'
                AND content IS NULL
                AND location_latitude BETWEEN -90 AND 90
                AND location_longitude BETWEEN -180 AND 180
            )
            OR
            (
                message_type <> 'location'
                AND location_latitude IS NULL
                AND location_longitude IS NULL
            )
        ),

    CONSTRAINT uq_messages_client_id
        UNIQUE (sender_user_id, client_message_id),

    CONSTRAINT uq_message_conversation_sequence
        UNIQUE (conversation_id, sequence_number)
);

CREATE INDEX ix_messages_conversation_pinned
ON messages (conversation_id, pinned_at DESC)
WHERE pinned_at IS NOT NULL;
```

`client_message_id` provides idempotency. A mobile or web client generates it before sending the message. If a retry happens because of a network error, the server does not create a duplicate message.

For soft deletion:

- Keep the row
- Set `deleted_at`
- Hide or replace `content` when returning the message

This preserves replies, ordering and audit history.

A message is pinned when `pinned_at` and `pinned_by_user_id` are populated.
Clearing both columns unpins it. This keeps one current pin state per message
without requiring a separate table, while allowing any number of messages in a
conversation to be pinned.

Add the last-message foreign key afterward:

```sql
ALTER TABLE conversations
ADD CONSTRAINT fk_conversations_last_message
FOREIGN KEY (last_message_id)
REFERENCES messages(id);
```

### 5.1 Live location shares

One-time `location` messages keep their coordinates on the message row. A
`live_location` message instead has one mutable location row so marker updates do
not rewrite or duplicate chat messages. Map URLs are constructed only by the UI.

```sql
CREATE TABLE live_location_shares (
    message_id       UUID PRIMARY KEY
                     REFERENCES messages(id)
                     ON DELETE CASCADE,

    conversation_id  UUID NOT NULL
                     REFERENCES conversations(id),

    user_id          UUID NOT NULL
                     REFERENCES users(id),

    latitude         NUMERIC(9, 6) NOT NULL,
    longitude        NUMERIC(9, 6) NOT NULL,
    accuracy_meters  NUMERIC(9, 2),

    started_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    stopped_at       TIMESTAMPTZ,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT ck_live_location_coordinates
        CHECK (
            latitude BETWEEN -90 AND 90
            AND longitude BETWEEN -180 AND 180
            AND (
                accuracy_meters IS NULL
                OR accuracy_meters BETWEEN 0 AND 10000
            )
        )
);

CREATE UNIQUE INDEX uq_live_location_active_user_conversation
ON live_location_shares (conversation_id, user_id)
WHERE is_active = TRUE;
```

The server broadcasts `LiveLocationUpdated` after coordinate changes and
`LiveLocationStopped` when the sender stops sharing or the share expires.

### 5.2 Message polls

A poll is a message, so it follows the conversation's normal ordering,
permissions, deletion, and pinning behavior. Single-choice polls replace a
member's previous selection; multiple-choice polls store one row for each
selected option. Expired polls keep their results but reject new votes.

```sql
CREATE TABLE message_polls (
    message_id  UUID PRIMARY KEY
                REFERENCES messages(id)
                ON DELETE CASCADE,
    question    VARCHAR(300) NOT NULL,
    is_multiple BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE message_poll_options (
    id               UUID PRIMARY KEY,
    poll_message_id  UUID NOT NULL
                     REFERENCES message_polls(message_id)
                     ON DELETE CASCADE,
    text             VARCHAR(200) NOT NULL,
    sort_order       INTEGER NOT NULL CHECK (sort_order >= 0),

    UNIQUE (poll_message_id, sort_order)
);

CREATE TABLE message_poll_votes (
    poll_message_id  UUID NOT NULL
                     REFERENCES message_polls(message_id)
                     ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id),
    option_id        UUID NOT NULL REFERENCES message_poll_options(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (poll_message_id, user_id, option_id)
);

CREATE INDEX ix_message_poll_votes_option
ON message_poll_votes (option_id);
```

The server broadcasts `MessagePollVoteChanged` after each vote so every open
client receives the latest totals and the current user's selection without
reloading the conversation.

## 6. Attachments

```sql
CREATE TABLE message_attachments (
    id              UUID PRIMARY KEY,
    message_id      UUID NOT NULL
                    REFERENCES messages(id)
                    ON DELETE CASCADE,

    storage_key     TEXT NOT NULL,
    file_name       VARCHAR(255) NOT NULL,
    content_type    VARCHAR(150) NOT NULL,
    file_size       BIGINT NOT NULL,

    width           INTEGER,
    height          INTEGER,
    duration_ms     BIGINT,

    thumbnail_key   TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Store the object-storage key rather than a permanent public URL.

For example:

```text
chat/2026/07/conversation-id/message-id/image.png
```

The API can generate short-lived signed URLs when a client requests the attachment.

## 7. Reactions

```sql
CREATE TABLE message_reactions (
    message_id      UUID NOT NULL
                    REFERENCES messages(id)
                    ON DELETE CASCADE,

    user_id         UUID NOT NULL
                    REFERENCES users(id),

    reaction        VARCHAR(50) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (message_id, user_id, reaction)
);
```

The primary key allows one user to apply several different reactions, but prevents repeating the same reaction.

To allow only one reaction per user per message:

```sql
PRIMARY KEY (message_id, user_id)
```

## 8. Delivery and read receipts

For small or medium group conversations:

```sql
CREATE TABLE message_receipts (
    message_id      UUID NOT NULL
                    REFERENCES messages(id)
                    ON DELETE CASCADE,

    user_id         UUID NOT NULL
                    REFERENCES users(id),

    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,

    PRIMARY KEY (message_id, user_id)
);
```

This provides exact per-message receipts, but it can become very large.

For a conversation with:

```text
1,000 members × 10,000 messages
```

the system could create millions of receipt rows.

A more scalable approach is to store only:

```text
conversation_members.last_read_message_id
conversation_members.last_read_at
```

Then determine whether a message has been read by comparing its sequence or creation position against the member’s read position.

Use detailed `message_receipts` only when the product needs features such as:

- “Read by Alice, Bob and Carol”
- Exact delivery tracking
- Small groups or direct chats

## 9. Direct-conversation uniqueness

A direct conversation should not be created twice for the same pair of users.

One approach is a separate table:

```sql
CREATE TABLE direct_conversations (
    conversation_id     UUID PRIMARY KEY
                        REFERENCES conversations(id)
                        ON DELETE CASCADE,

    user_low_id         UUID NOT NULL
                        REFERENCES users(id),

    user_high_id        UUID NOT NULL
                        REFERENCES users(id),

    CONSTRAINT ck_direct_users_order
        CHECK (user_low_id <= user_high_id),

    CONSTRAINT uq_direct_conversation_pair
        UNIQUE (user_low_id, user_high_id)
);
```

When creating a direct chat:

```text
user_low_id  = min(userA, userB)
user_high_id = max(userA, userB)
```

This guarantees that the pair can have only one active direct conversation.
Equal user IDs represent the user's default conversation with themselves.

UUID ordering differs by database, so another option is to calculate a deterministic pair key in the application:

```text
SHA-256(sortedUserId1 + ":" + sortedUserId2)
```

## 10. Group invitations

```sql
CREATE TABLE conversation_invitations (
    id                  UUID PRIMARY KEY,
    conversation_id     UUID NOT NULL
                        REFERENCES conversations(id)
                        ON DELETE CASCADE,

    invited_user_id     UUID NOT NULL
                        REFERENCES users(id),

    invited_by_user_id  UUID NOT NULL
                        REFERENCES users(id),

    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at        TIMESTAMPTZ,

    CONSTRAINT ck_invitation_status
        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),

    CONSTRAINT uq_conversation_invited_user
        UNIQUE (conversation_id, invited_user_id)
);
```

This table is unnecessary when users can be added directly without accepting an invitation.

## 11. Message edit history

Store edit history only when auditing or “view edit history” is required.

```sql
CREATE TABLE message_versions (
    id              UUID PRIMARY KEY,
    message_id      UUID NOT NULL
                    REFERENCES messages(id)
                    ON DELETE CASCADE,

    content         TEXT,
    edited_by       UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Before updating a message, copy the previous content into this table.

## 12. Blocking users

```sql
CREATE TABLE user_blocks (
    blocker_user_id UUID NOT NULL REFERENCES users(id),
    blocked_user_id UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (blocker_user_id, blocked_user_id),

    CONSTRAINT ck_cannot_block_self
        CHECK (blocker_user_id <> blocked_user_id)
);
```

Blocking behavior needs application rules, such as:

- Prevent creating a new direct conversation
- Prevent sending new direct messages
- Hide presence information
- Preserve previous message history

## 13. Recommended indexes

```sql
CREATE INDEX ix_conversation_members_user
ON conversation_members (
    user_id,
    is_archived,
    conversation_id
);

CREATE INDEX ix_conversations_last_message
ON conversations (
    last_message_at DESC
);

CREATE INDEX ix_messages_conversation_created
ON messages (
    conversation_id,
    created_at DESC,
    id DESC
);

CREATE INDEX ix_messages_reply_to
ON messages (
    reply_to_message_id
)
WHERE reply_to_message_id IS NOT NULL;

CREATE INDEX ix_message_attachments_message
ON message_attachments (
    message_id
);

CREATE INDEX ix_message_reactions_message
ON message_reactions (
    message_id
);

CREATE INDEX ix_message_receipts_user_read
ON message_receipts (
    user_id,
    read_at
);
```

The most important index is:

```sql
(conversation_id, created_at DESC, id DESC)
```

It supports paginated message history.

## 14. Prefer cursor pagination

Avoid:

```sql
OFFSET 100000 LIMIT 50
```

Use cursor pagination:

```sql
SELECT *
FROM messages
WHERE conversation_id = :conversationId
  AND (
      created_at < :cursorCreatedAt
      OR (
          created_at = :cursorCreatedAt
          AND id < :cursorMessageId
      )
  )
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

This remains efficient as conversation history grows.

For strict and unambiguous message ordering, the server assigns the conversation-local `sequence_number` defined in section 5. Its uniqueness constraint ensures that a sequence number cannot be reused within the same conversation. This is better than relying only on timestamps because multiple messages can have the same timestamp.

## 15. Calling identities and recordings

Calling-provider identities are separate from application users so providers can
be changed without changing user IDs.

```sql
CREATE TABLE calling_provider_identities (
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            VARCHAR(80) NOT NULL,
    external_identity   VARCHAR(500) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, provider),
    CONSTRAINT uq_calling_provider_identity
        UNIQUE (provider, external_identity)
);

CREATE TABLE session_recordings (
    id                      UUID PRIMARY KEY,
    conversation_id         UUID NOT NULL REFERENCES conversations(id),
    session_id              UUID NOT NULL,
    started_by_user_id      UUID NOT NULL REFERENCES users(id),
    session_type            VARCHAR(20) NOT NULL,
    provider                VARCHAR(80) NOT NULL,
    provider_call_locator   VARCHAR(500),
    provider_recording_id   VARCHAR(500),
    status                  VARCHAR(30) NOT NULL,
    storage_object_name     TEXT,
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    duration_milliseconds   BIGINT,

    CONSTRAINT ck_session_recordings_type
        CHECK (session_type IN ('direct', 'meeting', 'live_stream')),
    CONSTRAINT ck_session_recordings_status
        CHECK (status IN (
            'requesting-consent', 'recording', 'processing',
            'completed', 'cancelled', 'failed'
        ))
);

CREATE UNIQUE INDEX uq_session_recordings_active_session
ON session_recordings (session_id)
WHERE status IN ('requesting-consent', 'recording', 'processing');

CREATE INDEX ix_session_recordings_provider_recording
ON session_recordings (provider, provider_recording_id);
```

The database stores object names rather than durable public recording URLs.

## 16. Scheduled meetings

```sql
CREATE TABLE scheduled_meetings (
    id                  UUID PRIMARY KEY,
    organizer_user_id   UUID NOT NULL REFERENCES users(id),
    conversation_id     UUID UNIQUE REFERENCES conversations(id),
    title               VARCHAR(200) NOT NULL,
    description         VARCHAR(4000),
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    is_all_day          BOOLEAN NOT NULL DEFAULT FALSE,
    start_time          TIME,
    end_time            TIME,
    status              VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at        TIMESTAMPTZ,

    CONSTRAINT ck_scheduled_meetings_status
        CHECK (status IN ('scheduled', 'cancelled')),
    CONSTRAINT ck_scheduled_meetings_dates
        CHECK (end_date >= start_date),
    CONSTRAINT ck_scheduled_meetings_times
        CHECK (
            (is_all_day AND start_time IS NULL AND end_time IS NULL)
            OR
            (
                NOT is_all_day
                AND start_time IS NOT NULL
                AND end_time IS NOT NULL
                AND (end_date > start_date OR end_time > start_time)
            )
        )
);

CREATE TABLE scheduled_meeting_participants (
    meeting_id  UUID NOT NULL
                REFERENCES scheduled_meetings(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id),
    response_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    responded_at TIMESTAMPTZ,

    PRIMARY KEY (meeting_id, user_id),
    CONSTRAINT ck_scheduled_meeting_participant_response
        CHECK (response_status IN ('pending', 'accepted', 'tentative', 'declined'))
);

CREATE INDEX ix_scheduled_meetings_dates
ON scheduled_meetings (start_date, end_date);

CREATE INDEX ix_scheduled_meeting_participants_user
ON scheduled_meeting_participants (user_id);
```

The optional conversation link is unique so a meeting cannot be attached to
multiple conversation records.

## 17. Tasks and reminders

```sql
CREATE TABLE user_tasks (
    id                  UUID PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignee_user_id    UUID REFERENCES users(id),
    title               VARCHAR(200) NOT NULL,
    description         VARCHAR(4000),
    due_date            DATE,
    priority            VARCHAR(10) NOT NULL DEFAULT 'normal',
    is_completed        BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_user_tasks_priority
        CHECK (priority IN ('low', 'normal', 'high'))
);

CREATE TABLE user_task_shares (
    id                  UUID PRIMARY KEY,
    task_id             UUID NOT NULL REFERENCES user_tasks(id) ON DELETE CASCADE,
    grantee_user_id     UUID NOT NULL REFERENCES users(id),
    permission          VARCHAR(10) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_task_share UNIQUE (task_id, grantee_user_id),
    CONSTRAINT ck_user_task_share_permission
        CHECK (permission IN ('viewer', 'editor'))
);

CREATE TABLE user_reminders (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     VARCHAR(4000),
    reminder_date   DATE NOT NULL,
    reminder_time   TIME,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_user_tasks_status_due
ON user_tasks (user_id, is_completed, due_date);

CREATE INDEX ix_user_task_shares_grantee
ON user_task_shares (grantee_user_id);

CREATE INDEX ix_user_reminders_schedule
ON user_reminders (user_id, reminder_date, reminder_time);
```

Task ownership and assignment are distinct: `user_id` is the creator/owner,
while `assignee_user_id` identifies the user responsible for the task.

## 18. Notes

```sql
CREATE TABLE user_notes (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    content     VARCHAR(20000) NOT NULL DEFAULT '',
    is_pinned   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_note_shares (
    id                  UUID PRIMARY KEY,
    note_id             UUID NOT NULL REFERENCES user_notes(id) ON DELETE CASCADE,
    grantee_user_id     UUID NOT NULL REFERENCES users(id),
    permission          VARCHAR(10) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_note_share UNIQUE (note_id, grantee_user_id),
    CONSTRAINT ck_user_note_share_permission
        CHECK (permission IN ('viewer', 'editor'))
);

CREATE INDEX ix_user_notes_pinned_updated
ON user_notes (user_id, is_pinned, updated_at);

CREATE INDEX ix_user_note_shares_grantee
ON user_note_shares (grantee_user_id);
```

## 19. In-app notifications

Notification targets are polymorphic: `target_id` identifies the primary
resource and `context_id` optionally identifies its parent context, such as the
conversation containing a reacted message.

```sql
CREATE TABLE user_notifications (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id   UUID NOT NULL REFERENCES users(id),
    type            VARCHAR(30) NOT NULL,
    target_id       UUID NOT NULL,
    context_id      UUID,
    target_title    VARCHAR(255) NOT NULL,
    details         VARCHAR(300),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at         TIMESTAMPTZ,

    CONSTRAINT ck_user_notifications_type
        CHECK (type IN (
            'meeting_invite', 'meeting_rescheduled', 'meeting_cancelled',
            'document_file_share', 'document_folder_share', 'note_share',
            'task_share', 'task_assignment', 'message_reaction', 'message_mention',
            'message_reply', 'recording_ready'
        ))
);

CREATE INDEX ix_user_notifications_feed
ON user_notifications (user_id, created_at DESC, id);

CREATE INDEX ix_user_notifications_unread
ON user_notifications (user_id, read_at);
```

There are intentionally no foreign keys on polymorphic target columns. The
notification type determines which resource table each identifier refers to.

## 20. Documents

Folders and files are user-owned, can be shared internally or through a public
link, and support soft deletion. Folder and file names are stored with a
normalized form for case-insensitive uniqueness.

```sql
CREATE TABLE document_folders (
    id                  UUID PRIMARY KEY,
    owner_user_id       UUID NOT NULL REFERENCES users(id),
    parent_folder_id    UUID REFERENCES document_folders(id),
    name                VARCHAR(255) NOT NULL,
    normalized_name     VARCHAR(255) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_document_folders_active_name
ON document_folders (owner_user_id, parent_folder_id, normalized_name)
WHERE deleted_at IS NULL;

CREATE TABLE stored_documents (
    id                          UUID PRIMARY KEY,
    owner_user_id               UUID NOT NULL REFERENCES users(id),
    folder_id                   UUID REFERENCES document_folders(id),
    name                        VARCHAR(255) NOT NULL,
    normalized_name             VARCHAR(255) NOT NULL,
    storage_key                 VARCHAR(400) NOT NULL,
    content_type                VARCHAR(255) NOT NULL,
    size_bytes                  BIGINT NOT NULL,
    current_version_number      INTEGER NOT NULL DEFAULT 1,
    current_version_created_at  TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_stored_documents_active_name
ON stored_documents (owner_user_id, folder_id, normalized_name)
WHERE deleted_at IS NULL;

CREATE TABLE document_versions (
    id              UUID PRIMARY KEY,
    document_id     UUID NOT NULL
                    REFERENCES stored_documents(id) ON DELETE CASCADE,
    number          INTEGER NOT NULL,
    storage_key     VARCHAR(400) NOT NULL,
    content_type    VARCHAR(255) NOT NULL,
    size_bytes      BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_document_version UNIQUE (document_id, number)
);
```

Document shares and public links target exactly one folder or file.

```sql
CREATE TABLE document_shares (
    id                  UUID PRIMARY KEY,
    owner_user_id       UUID NOT NULL REFERENCES users(id),
    grantee_user_id     UUID NOT NULL REFERENCES users(id),
    folder_id           UUID REFERENCES document_folders(id) ON DELETE CASCADE,
    file_id             UUID REFERENCES stored_documents(id) ON DELETE CASCADE,
    permission          VARCHAR(20) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_document_shares_target CHECK (
        (folder_id IS NOT NULL AND file_id IS NULL)
        OR (folder_id IS NULL AND file_id IS NOT NULL)
    ),
    CONSTRAINT ck_document_shares_permission
        CHECK (permission IN ('viewer', 'editor'))
);

CREATE UNIQUE INDEX uq_document_shares_folder_grantee
ON document_shares (folder_id, grantee_user_id)
WHERE folder_id IS NOT NULL;

CREATE UNIQUE INDEX uq_document_shares_file_grantee
ON document_shares (file_id, grantee_user_id)
WHERE file_id IS NOT NULL;

CREATE TABLE document_public_links (
    id              UUID PRIMARY KEY,
    owner_user_id   UUID NOT NULL REFERENCES users(id),
    folder_id       UUID REFERENCES document_folders(id) ON DELETE CASCADE,
    file_id         UUID REFERENCES stored_documents(id) ON DELETE CASCADE,
    token           VARCHAR(64) NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,

    CONSTRAINT ck_document_public_links_target CHECK (
        (folder_id IS NOT NULL AND file_id IS NULL)
        OR (folder_id IS NULL AND file_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_document_public_links_folder
ON document_public_links (folder_id)
WHERE folder_id IS NOT NULL;

CREATE UNIQUE INDEX uq_document_public_links_file
ON document_public_links (file_id)
WHERE file_id IS NOT NULL;
```

## 21. Resumable document uploads

```sql
CREATE TABLE document_upload_sessions (
    id                  UUID PRIMARY KEY,
    actor_user_id       UUID NOT NULL,
    owner_user_id       UUID NOT NULL,
    folder_id           UUID,
    replace_file_id     UUID,
    name                VARCHAR(255) NOT NULL,
    normalized_name     VARCHAR(255) NOT NULL,
    content_type        VARCHAR(255) NOT NULL,
    fingerprint         VARCHAR(64) NOT NULL,
    size_bytes          BIGINT NOT NULL,
    chunk_size          INTEGER NOT NULL,
    chunk_count         INTEGER NOT NULL,
    completed_file_id   UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    completed_at        TIMESTAMPTZ
);

CREATE TABLE document_upload_chunks (
    session_id     UUID NOT NULL
                   REFERENCES document_upload_sessions(id) ON DELETE CASCADE,
    chunk_index    INTEGER NOT NULL,
    storage_key    VARCHAR(400) NOT NULL,
    sha256         VARCHAR(64) NOT NULL,
    size_bytes     INTEGER NOT NULL,

    PRIMARY KEY (session_id, chunk_index)
);

CREATE INDEX ix_document_upload_sessions_expiry
ON document_upload_sessions (owner_user_id, expires_at);
```

Upload-session identifiers are validated by the document service. In the EF
model they are deliberately not foreign keys, allowing expired or interrupted
uploads to be cleaned up without creating long-lived document relationships.

## 22. EF Core migration workflow

The API applies pending migrations during startup with
`Database.MigrateAsync()`. The current migration tip is
`20261007112917_AddForms`.

User names are derived from `FirstName` and `LastName`, falling back to the username when both are empty. `DisplayName` remains a read-only API value and is not stored in the database. The migration preserves legacy display names in `FirstName` only where both name fields are empty, then drops `Users.DisplayName`.

Identity uses `ChatUser` and the existing `Users` table. The authentication migration extends `Users` directly, preserving existing user IDs, chat handles, and conversation links. New user and role IDs are generated by SQL Server with `NEWSEQUENTIALID()`.

```powershell
cd backend

# Check whether the model differs from the migration snapshot.
dotnet ef migrations has-pending-model-changes `
  --project ChatApp.Persistence `
  --startup-project ChatApp.Api

# Create a migration after changing an entity or ChatAppDbContext.
dotnet ef migrations add <MigrationName> `
  --project ChatApp.Persistence `
  --startup-project ChatApp.Api `
  --output-dir Migrations

# Apply all pending migrations to the configured database.
dotnet ef database update `
  --project ChatApp.Persistence `
  --startup-project ChatApp.Api
```

Review generated migrations before committing them. Keep the migration,
designer file, and `ChatAppDbContextModelSnapshot.cs` together. Never edit a
migration that has already been deployed; create a new migration instead.

### Activity log

Global Admins can open **Activity log** to search authentication and user-management events by category, event, user name or ID, and date range. The log includes sign-in success/failure, lockout, logout, account creation/profile edits, role changes, account enable/disable, password changes, password authentication settings, and external login linking. It excludes chat, document, meeting, and other feature activity. Passwords, tokens, and provider credentials are never stored in log metadata. Entries use SQL-generated IDs and preserve user identity snapshots.

`backend/ChatApp.Api/appsettings.json` lists JWT, Google, Microsoft, and recording callback settings. Supply blank secrets through user-secrets or environment variables; do not commit signing keys or callback keys. Provider client and tenant IDs remain optional.

## 23. Forms

Use **Link** under Content for an owner-configured label, destination URL, description, and optional new-tab behavior. Links support nested layouts and conditional visibility and never become response answers. Use **Website / URL** for a respondent-entered link, with required-answer and conditional settings like other questions. Both support complete HTTP/HTTPS URLs up to 2,048 characters without embedded credentials; other schemes are rejected. Empty owner links can be saved in drafts but need a URL before publishing.

Attachment questions support **Allowed extensions** in Block settings: enter comma-separated extensions with leading dots (for example `.pdf, .docx, .jpg`), or use **Reset file types**. Defaults include Word, Excel, PowerPoint, OpenDocument, RTF, text/CSV, PDF, JPEG, PNG, GIF, WebP, BMP, TIFF, and HEIC/HEIF. The picker, drag/drop validation, upload API, and submission validation enforce the published question's list case-insensitively. Existing questions without an explicit list use these defaults. This setting checks filename extensions, not file contents.

Forms also support a **Paragraph** content block with an optional heading and up to 2,000 characters of plain text. Line breaks are preserved, with left, center, right, or justified text alignment. Owners can drag it into sections or nested columns and apply conditional visibility. Respondents cannot edit it, and its content is excluded from response answers. Paragraph text is required before publishing.

**Attachment** questions let respondents upload a single file, or multiple files when **Allow multiple files** is enabled (configurable maximum of 1–10). Configure **Maximum file size (MB)** per question from 1–20 MB (whole numbers, default 5 MB), with 20 MB total per response. Size limits use 1 MB = 1,048,576 bytes and are enforced by the picker/drop zone, upload API, and submission validation. Existing questions default to 5 MB. Required and conditional questions work with attachments. Files upload immediately when selected, with upload status shown while respondents continue answering. Submission sends attachment IDs and claims the uploads for that response. Owners download submitted files from **Responses**. Upload IDs expire after 24 hours, but files remain until manually deleted in My Documents > Orphan attachments. There is no background cleanup job. Signed-in uploads, staged and submitted, count toward the uploader storage quota through CreatedById. Anonymous uploads (no CreatedById) count toward the form owner through FormOwnerId, including orphan files after form deletion. Owners can manage those anonymous orphan files from My Documents. Existing files are backfilled from their forms; Global Admins can clean up legacy files whose original owner can no longer be identified. Upload IDs are bound to the form, published version, question, and submission key. Content uses the configured `IUploadObjectStorage` provider; SQL stores only `StorageKey`, filename, size, and response/question references. The `AddFormAttachments` and `TrackFormAttachmentOwnership` migrations are applied at API startup. Deleting a form removes its attachment objects; storage cleanup failures are logged. Submission accepts JSON answers and staged attachment IDs only (up to 512,000 bytes). Failed submissions retain staged uploads for retry until their IDs expire; files remain charged until manually deleted. Orphan uploads can only be deleted after they expire, even when the upload is complete. Submissions referencing expired attachments are rejected; respondents must upload those files again.

Open **Forms** in the sidebar to create, search, duplicate, publish, close, or delete your forms. The builder supports short and long text, email, number, date, time, date & time, single choice, multiple choice, dropdown, rating, and yes/no questions. Time and date & time answers use minute precision and retain local values without timezone conversion (`HH:mm` and `yyyy-MM-ddTHH:mm`). Drag blocks from the palette or use its buttons, reorder with the arrow controls, and use **Move into** to move blocks between sections without dragging. Undo and redo preserve the last 50 edits.

Sections and two-to-four-column layouts can nest up to eight levels, with at most 200 blocks per form. Select a block to set required answers, choices, numeric bounds, or visibility rules. Conditions match all or any rules against earlier questions; moving or deleting a source question reports invalid references before saving. Hidden questions and descendants are excluded from submissions and required-field validation. Column layouts collapse on small screens.

Use **Image** to add owner-managed images anywhere in the layout. In Block settings, upload an image, drop a file onto the image area, or focus that area and paste an image. PNG, JPEG, and WebP images are stored as base64 data URLs in the draft and each published version (up to 1 MiB per image and 4 MiB total). Choose centered logo or full-width banner sizing, optional width (24–2400 px) and height (24–1200 px), alternative text, and a caption using Description. Leave either dimension empty for automatic sizing; images fit without cropping or stretching and remain within the available width. Respondents see a read-only image; image blocks are never collected as answers. Empty image blocks can be saved in drafts but must be filled or removed before publishing. Draft saves allow up to 6 MiB to accommodate embedded images.

Save a draft, then publish it to create an immutable version and activate the response link (`?form=<token>`). Editing a draft does not change the live form. Republish to activate a new version; respondents with an older version must reload before submitting. Closing stops new submissions while retaining responses. Anyone with a published link can submit without an account. Forms and response management remain owner-only.

The Share & settings tab displays a QR code for the response link and lets the owner download it as a PNG for print or sharing. The code preserves the application's URL path and continues to work across published versions; the form must be published to accept responses.

The Responses tab shows paginated submissions with their original version's questions. CSV export includes all responses as one row per visible question, uses a consistent submission cutoff, and escapes spreadsheet formulas. Anonymous submission retries use an idempotency key; submissions are limited to 30 requests per minute per IP and 512 KB per request. Form and publication changes use optimistic concurrency checks.

Frontend entry points are `src/pages/FormsView.tsx` and `src/pages/PublicFormView.tsx`; reusable UI and model helpers live in `src/components/forms`, and API access lives in `src/services/formsApi.ts`. The `AddForms` EF migration creates SQL-generated GUID keys for forms, publication snapshots, and responses and is applied by the existing API startup migration workflow.

Run validation with:

```powershell
dotnet test backend/ChatApp.Tests/ChatApp.Tests.csproj
cd e2e
npx playwright test tests/forms.spec.ts
```
