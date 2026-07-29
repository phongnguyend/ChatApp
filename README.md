# Huddle Chat App

A simple real-time chat application built with:

- ASP.NET Core 10 Web API and SignalR
- Entity Framework Core 10 with SQL Server
- React 19, TypeScript, and Vite
- Username-only sign-in

The app includes persistent message history, pair-unique direct messages,
multi-person group creation, live group member management, user discovery, online
presence, typing indicators, unread counts, profile and group avatar uploads,
camera capture, current-location sharing with confirmation previews, start/stop
live-location sharing with an updating Leaflet map, automatic
SignalR reconnection, and responsive desktop/mobile layouts. Browser push
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

## Project structure

```text
backend/
  ChatApp.slnx
  ChatApp.Api/
    Data/
    Models/
    Hubs/
    Controllers/
frontend/
  src/
  scripts/
```

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

Open `http://localhost:5173`, enter a username, and join the General conversation.

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
$env:AzureNotifications__ConnectionString = "<notification-hub-connection-string>"
$env:AzureNotifications__HubName = "<notification-hub-name>"
$env:AzureNotifications__VapidPublicKey = "<vapid-public-key>"
$env:AzureNotifications__FrontendBaseUrl = "https://chat.example.com"
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
npm --prefix frontend run test:smoke
```

# Database Schema

Below is a practical relational schema for a chat application supporting:

- One-to-one conversations
- Group chats
- Message replies
- Attachments
- Reactions
- Read receipts
- Message editing and deletion
- Member roles
- Muting and leaving conversations

PostgreSQL-style data types are used, but the design works with SQL Server or MySQL with minor changes.

## 1. Core relationships

```text
User
  └── ConversationMember
          └── Conversation
                  ├── Message
                  │     ├── MessageAttachment
                  │     ├── MessageReaction
                  │     └── MessageReceipt
                  └── ConversationMember
```

A conversation represents either:

- A direct chat between two users
- A group chat
- Optionally, a channel or support conversation later

## 2. Users

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY,
    username        VARCHAR(50) NOT NULL UNIQUE,
    display_name    VARCHAR(100) NOT NULL,
    avatar_url      TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_users_status
        CHECK (status IN ('active', 'suspended', 'deleted'))
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
        CHECK (type IN ('direct', 'group'))
);
```

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
```

`client_message_id` provides idempotency. A mobile or web client generates it before sending the message. If a retry happens because of a network error, the server does not create a duplicate message.

For soft deletion:

- Keep the row
- Set `deleted_at`
- Hide or replace `content` when returning the message

This preserves replies, ordering and audit history.

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
            AND (accuracy_meters IS NULL OR accuracy_meters >= 0)
        )
);

CREATE UNIQUE INDEX uq_live_location_active_user_conversation
ON live_location_shares (conversation_id, user_id)
WHERE is_active = TRUE;
```

The server broadcasts `LiveLocationUpdated` after coordinate changes and
`LiveLocationStopped` when the sender stops sharing or the share expires.

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
