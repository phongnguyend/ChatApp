import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from "@microsoft/signalr";
import {
  Ban,
  Bell,
  Check,
  BellOff,
  Download,
  FileText,
  Hash,
  Images,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircleMore,
  Pencil,
  Plus,
  Send,
  Search,
  UserRoundPlus,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";
import { AvatarPicker } from "./components/AvatarPicker";
import {
  type ChatAttachment,
  MessageAttachmentList,
  MessageAttachmentPicker,
} from "./components/MessageAttachments";
import { type ChatReaction, MessageActions } from "./components/MessageActions";
import { EmojiPicker } from "./components/EmojiPicker";
import { GroupMemberActions } from "./components/GroupMemberActions";
import {
  LocationShareButton,
  type SharedLocation,
} from "./components/LocationShareButton";
import { ConversationActions } from "./components/ConversationActions";
import { OnlineUserActions } from "./components/OnlineUserActions";
import { PushNotificationButton } from "./components/PushNotificationButton";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5045";
const LIVE_CHAT_OFFLINE_ERROR =
  "Live chat is offline. Check that the server is running.";

type User = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

type Conversation = {
  id: string;
  type: "direct" | "group";
  title: string | null;
  avatarUrl: string | null;
  lastMessage: string | null;
  lastMessageSenderUserId: string | null;
  lastMessageSenderName: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  memberCount: number;
  isMuted: boolean;
  directUserId: string | null;
  directUsername: string | null;
};

type SearchUser = User;

type ConversationMember = User & {
  role: "owner" | "admin" | "member";
  isOnline: boolean;
};

type ViewedProfile = User & {
  isOnline: boolean;
};

type MembersChangedEvent = {
  conversationId: string;
  memberCount: number;
};

type ConversationRenamedEvent = {
  conversationId: string;
  title: string;
};

type ConversationRemovedEvent = {
  conversationId: string;
};

type ConversationMuteChangedEvent = {
  conversationId: string;
  isMuted: boolean;
};

type UserBlockChangedEvent = {
  username: string;
  isBlocked: boolean;
};

type UserAvatarUpdatedEvent = {
  userId: string;
  avatarUrl: string;
};

type UserDisplayNameUpdatedEvent = {
  userId: string;
  displayName: string;
};

type ConversationAvatarUpdatedEvent = {
  conversationId: string;
  avatarUrl: string;
};

type Message = {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  username: string | null;
  senderAvatarUrl: string | null;
  content: string | null;
  messageType: string;
  clientMessageId: string | null;
  sequenceNumber: number;
  replyToMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  attachments?: ChatAttachment[] | null;
  reactions?: ChatReaction[] | null;
};

type MessageChangedEvent = {
  messageId: string;
  conversationId: string;
  content: string | null;
  editedAt: string | null;
  deletedAt: string | null;
};

type MessageReactionChangedEvent = {
  messageId: string;
  conversationId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  reaction: string;
  isAdded: boolean;
};

type TypingEvent = {
  conversationId: string;
  username: string;
  isTyping: boolean;
};

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";
type ConversationTab = "chat" | "files" | "photos";
const EMPTY_MESSAGES: Message[] = [];

function conversationDisplayTitle(
  conversation: Conversation | null | undefined,
  fallback = "Conversation",
) {
  const title = conversation?.title ?? fallback;
  return conversation?.type === "direct" && conversation.memberCount === 1
    ? `${title} (You)`
    : title;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

const MESSAGE_URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function MessageContent({ content }: { content: string }) {
  return (
    <p>
      {content.split(MESSAGE_URL_PATTERN).map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            href={part}
            key={`${index}-${part}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function messagePreview(message: Message) {
  if (message.messageType === "location") return "Shared a location";
  if (message.content) return message.content;
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return null;
  if (
    attachments.every((attachment) =>
      attachment.contentType.startsWith("image/"),
    )
  ) {
    return attachments.length === 1
      ? "Sent an image"
      : `Sent ${attachments.length} images`;
  }
  if (
    attachments.every((attachment) =>
      attachment.contentType.startsWith("video/"),
    )
  ) {
    return attachments.length === 1
      ? "Sent a video"
      : `Sent ${attachments.length} videos`;
  }
  if (
    attachments.every((attachment) =>
      attachment.contentType.startsWith("audio/"),
    )
  ) {
    return attachments.length === 1
      ? "Sent a voice message"
      : `Sent ${attachments.length} voice messages`;
  }
  return attachments.length === 1
    ? "Sent a file"
    : `Sent ${attachments.length} files`;
}

function replyPreview(message: Message) {
  if (message.deletedAt) return "This message was deleted.";
  return messagePreview(message) ?? "Message";
}

function avatarSource(avatarUrl: string | null | undefined) {
  if (!avatarUrl) return null;
  try {
    return new URL(avatarUrl, API_URL).toString();
  } catch {
    return null;
  }
}

function AvatarContent({
  avatarUrl,
  name,
}: {
  avatarUrl: string | null | undefined;
  name: string;
}) {
  const source = avatarSource(avatarUrl);
  return source ? (
    <img className="avatar-image" src={source} alt="" />
  ) : (
    initials(name)
  );
}

function avatarColor(name: string) {
  const colors = ["#e7654b", "#7456d6", "#278b7b", "#d48c2f", "#3478c6"];
  const hash = [...name].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  return colors[hash % colors.length];
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAttachmentDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";

  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? "Something went wrong. Please try again.";
  } catch {
    return "The chat service could not complete that request.";
  }
}

function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) throw new Error(await readError(response));
      onLogin((await response.json()) as User);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The chat service is unavailable.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Welcome to Huddle">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <MessageCircleMore size={22} strokeWidth={2.5} />
          </span>
          <span>Huddle</span>
        </div>
        <div className="story-copy">
          <p className="eyebrow">A calmer place to chat</p>
          <h1>Good conversation starts with showing up.</h1>
          <p>
            Share an idea, ask a question, or simply say hello. Your team is
            already here.
          </p>
        </div>
        <div className="conversation-preview" aria-hidden="true">
          <div className="preview-avatar preview-avatar-one">AK</div>
          <div className="preview-bubble">
            <span className="preview-name">Avery</span>
            The new direction feels exactly right.
          </div>
          <div className="preview-bubble preview-reply">
            <span className="preview-name">Mina</span>
            Agreed — let’s share it with everyone ✨
          </div>
        </div>
        <p className="story-footer">Simple, real-time, and made for people.</p>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-brand brand">
            <span className="brand-mark" aria-hidden="true">
              <MessageCircleMore size={20} />
            </span>
            <span>Huddle</span>
          </div>
          <div>
            <p className="eyebrow">Welcome in</p>
            <h2>Join the conversation</h2>
            <p className="login-subtitle">
              Choose a name people will recognize.
            </p>
          </div>
          <label htmlFor="username">Your name</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoFocus
            maxLength={50}
            placeholder="e.g. Jamie Chen"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-describedby={error ? "login-error" : undefined}
          />
          {error && (
            <p className="form-error" id="login-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button"
            disabled={isSubmitting || username.trim().length < 2}
            type="submit"
          >
            {isSubmitting ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              "Enter Huddle"
            )}
          </button>
          <p className="login-note">
            No password needed. Just bring your good self.
          </p>
        </form>
      </section>
    </main>
  );
}

function ChatApp({
  user,
  onLogout,
  onUserUpdated,
}: {
  user: User;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversationTab, setConversationTab] =
    useState<ConversationTab>("chat");
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, Message[]>
  >({});
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [blockedUsernames, setBlockedUsernames] = useState<Set<string>>(
    () => new Set(),
  );
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState("");
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [conversationDialog, setConversationDialog] = useState<
    "direct" | "group" | "add-members" | null
  >(null);
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<SearchUser[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<SearchUser[]>([]);
  const [membersByConversation, setMembersByConversation] = useState<
    Record<string, ConversationMember[]>
  >({});
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [isSavingMembers, setIsSavingMembers] = useState(false);
  const [creatingDirectUserId, setCreatingDirectUserId] = useState<
    string | null
  >(null);
  const [dialogError, setDialogError] = useState("");
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [conversationToLeave, setConversationToLeave] =
    useState<Conversation | null>(null);
  const [leaveError, setLeaveError] = useState("");
  const [isLeaving, setIsLeaving] = useState(false);
  const [avatarDialog, setAvatarDialog] = useState<"user" | "group" | null>(
    null,
  );
  const [profileTab, setProfileTab] = useState<"avatar" | "display-name">(
    "avatar",
  );
  const [displayNameDraft, setDisplayNameDraft] = useState(user.displayName);
  const [displayNameError, setDisplayNameError] = useState("");
  const [isSavingDisplayName, setIsSavingDisplayName] = useState(false);
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [replyingToMessageId, setReplyingToMessageId] = useState<string | null>(
    null,
  );
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageDraft, setEditMessageDraft] = useState("");
  const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);
  const [isDeletingMessage, setIsDeletingMessage] = useState(false);
  const [conversationActionId, setConversationActionId] = useState<
    string | null
  >(null);
  const [userBlockActionName, setUserBlockActionName] = useState<string | null>(
    null,
  );
  const [viewedProfile, setViewedProfile] =
    useState<ViewedProfile | null>(null);
  const [memberActionId, setMemberActionId] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] =
    useState<ConversationMember | null>(null);
  const connectionRef = useRef<HubConnection | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const linkedConversationIdRef = useRef(
    new URLSearchParams(window.location.search).get("conversation"),
  );

  const activeConversation = conversations.find((item) => item.id === activeId);
  const activeMessages = activeId
    ? (messagesByConversation[activeId] ?? EMPTY_MESSAGES)
    : EMPTY_MESSAGES;
  const replyingToMessage = replyingToMessageId
    ? activeMessages.find((message) => message.id === replyingToMessageId)
    : undefined;
  const activeAttachmentItems = useMemo(
    () =>
      activeMessages.flatMap((message) =>
        message.deletedAt
          ? []
          : (message.attachments ?? []).map((attachment) => ({
              attachment,
              messageId: message.id,
              senderName:
                message.senderUserId === user.id
                  ? "You"
                  : (message.username ?? "Unknown user"),
              createdAt: message.createdAt,
            })),
      ),
    [activeMessages, user.id],
  );
  const activePhotoItems = useMemo(
    () =>
      activeAttachmentItems.filter(
        ({ attachment }) =>
          attachment.contentType.startsWith("image/") ||
          attachment.contentType.startsWith("video/"),
      ),
    [activeAttachmentItems],
  );
  const activeFileItems = useMemo(
    () =>
      activeAttachmentItems.filter(
        ({ attachment }) =>
          !attachment.contentType.startsWith("image/") &&
          !attachment.contentType.startsWith("video/"),
      ),
    [activeAttachmentItems],
  );
  const activeMembers = activeId ? (membersByConversation[activeId] ?? []) : [];
  const directParticipant =
    activeConversation?.type === "direct"
      ? (activeMembers.find((member) => member.id !== user.id) ??
        activeMembers.find((member) => member.id === user.id))
      : undefined;
  const directParticipantProfile: ViewedProfile | null = directParticipant
    ? {
        ...directParticipant,
        isOnline:
          directParticipant.id === user.id ||
          onlineUsers.some(
            (onlineUser) => onlineUser.id === directParticipant.id,
          ),
      }
    : null;
  const directParticipantNormalizedUsername =
    directParticipantProfile?.username.toLocaleLowerCase() ?? null;
  const isDirectParticipantBlocked = directParticipantNormalizedUsername
    ? blockedUsernames.has(directParticipantNormalizedUsername)
    : false;
  const isActiveDirectMessagingBlocked =
    activeConversation?.type === "direct" && isDirectParticipantBlocked;
  const canManageGroupMembers = activeMembers.some(
    (member) => member.id === user.id && member.role === "owner",
  );

  const removeConversation = useCallback((conversationId: string) => {
    setConversations((current) =>
      current.filter((conversation) => conversation.id !== conversationId),
    );
    setActiveId((current) => (current === conversationId ? null : current));
    setMessagesByConversation((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    setMembersByConversation((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    setIsRenameDialogOpen(false);
    setConversationToLeave(null);
    setAvatarDialog(null);
  }, []);

  const receiveMessage = useCallback((message: Message) => {
    setMessagesByConversation((current) => {
      const existing = current[message.conversationId] ?? [];
      const found = existing.some(
        (item) =>
          item.id === message.id ||
          (item.clientMessageId &&
            item.clientMessageId === message.clientMessageId &&
            item.senderUserId === message.senderUserId),
      );
      if (found) return current;

      return {
        ...current,
        [message.conversationId]: [...existing, message].sort(
          (a, b) => a.sequenceNumber - b.sequenceNumber,
        ),
      };
    });
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === message.conversationId
          ? {
              ...conversation,
              lastMessage: messagePreview(message),
              lastMessageSenderUserId: message.senderUserId,
              lastMessageSenderName: message.username,
              lastMessageAt: message.createdAt,
              unreadCount:
                activeIdRef.current === message.conversationId
                  ? 0
                  : conversation.unreadCount + 1,
            }
          : conversation,
      ),
    );
    if (
      activeIdRef.current === message.conversationId &&
      connectionRef.current?.state === HubConnectionState.Connected
    ) {
      void connectionRef.current.invoke(
        "MarkRead",
        message.conversationId,
        message.sequenceNumber,
      );
    }
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (!activeId && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations]);

  useEffect(() => {
    const linkedConversationId = linkedConversationIdRef.current;
    if (!linkedConversationId || conversations.length === 0) return;

    if (
      conversations.some(
        (conversation) => conversation.id === linkedConversationId,
      )
    ) {
      setActiveId(linkedConversationId);
    }
    linkedConversationIdRef.current = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("conversation");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [conversations]);

  const loadConversations = useCallback(async () => {
    const response = await fetch(
      `${API_URL}/api/conversations?username=${encodeURIComponent(user.username)}`,
    );
    if (!response.ok) throw new Error(await readError(response));
    const items = (await response.json()) as Conversation[];
    setConversations(items);
    setActiveId((current) => current ?? items[0]?.id ?? null);
  }, [user.username]);

  const loadMembers = useCallback(
    async (conversationId: string) => {
      const response = await fetch(
        `${API_URL}/api/conversations/${conversationId}/members?username=${encodeURIComponent(
          user.username,
        )}`,
      );
      if (!response.ok) throw new Error(await readError(response));
      const members = (await response.json()) as ConversationMember[];
      setMembersByConversation((current) => ({
        ...current,
        [conversationId]: members,
      }));
      return members;
    },
    [user.username],
  );

  useEffect(() => {
    loadConversations().catch((requestError) => {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load chats.",
      );
    });
  }, [loadConversations]);

  useEffect(() => {
    fetch(
      `${API_URL}/api/users/blocked?username=${encodeURIComponent(user.username)}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as string[];
      })
      .then((usernames) =>
        setBlockedUsernames(
          new Set(usernames.map((name) => name.toLocaleLowerCase())),
        ),
      )
      .catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load blocked users.",
        );
      });
  }, [user.username]);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | null = null;
    const connection = new HubConnectionBuilder()
      .withUrl(
        `${API_URL}/hubs/chat?username=${encodeURIComponent(user.username)}`,
      )
      .withAutomaticReconnect([0, 1500, 4000, 8000])
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on("MessageReceived", receiveMessage);
    connection.on("MessageChanged", (event: MessageChangedEvent) => {
      setMessagesByConversation((current) => ({
        ...current,
        [event.conversationId]: (current[event.conversationId] ?? []).map(
          (message) =>
            message.id === event.messageId
              ? {
                  ...message,
                  content: event.content,
                  editedAt: event.editedAt,
                  deletedAt: event.deletedAt,
                  attachments: event.deletedAt ? [] : message.attachments,
                  reactions: event.deletedAt ? [] : message.reactions,
                }
              : message,
        ),
      }));
      void loadConversations();
    });
    connection.on(
      "MessageReactionChanged",
      (event: MessageReactionChangedEvent) => {
        setMessagesByConversation((current) => ({
          ...current,
          [event.conversationId]: (current[event.conversationId] ?? []).map(
            (message) => {
              if (message.id !== event.messageId) return message;

              const reactions = [...(message.reactions ?? [])];
              const index = reactions.findIndex(
                (item) => item.reaction === event.reaction,
              );
              const isOwnReaction = event.userId === user.id;
              if (event.isAdded) {
                if (index >= 0) {
                  const users = reactions[index].users.some(
                    (reactingUser) => reactingUser.id === event.userId,
                  )
                    ? reactions[index].users
                    : [
                        ...reactions[index].users,
                        {
                          id: event.userId,
                          displayName: event.displayName,
                          avatarUrl: event.avatarUrl,
                        },
                      ];
                  reactions[index] = {
                    ...reactions[index],
                    count: users.length,
                    isOwn: reactions[index].isOwn || isOwnReaction,
                    users,
                  };
                } else {
                  reactions.push({
                    reaction: event.reaction,
                    count: 1,
                    isOwn: isOwnReaction,
                    users: [
                      {
                        id: event.userId,
                        displayName: event.displayName,
                        avatarUrl: event.avatarUrl,
                      },
                    ],
                  });
                }
              } else if (index >= 0) {
                const users = reactions[index].users.filter(
                  (reactingUser) => reactingUser.id !== event.userId,
                );
                const nextCount = users.length;
                if (nextCount <= 0) {
                  reactions.splice(index, 1);
                } else {
                  reactions[index] = {
                    ...reactions[index],
                    count: nextCount,
                    isOwn: isOwnReaction ? false : reactions[index].isOwn,
                    users,
                  };
                }
              }
              return { ...message, reactions };
            },
          ),
        }));
      },
    );
    connection.on("PresenceChanged", (users: User[]) => {
      setOnlineUsers(users);
      setViewedProfile((current) => {
        if (!current) return null;
        const onlineUser = users.find(
          (candidate) => candidate.id === current.id,
        );
        return onlineUser
          ? { ...onlineUser, isOnline: true }
          : { ...current, isOnline: false };
      });
      const onlineSet = new Set(
        users.map((onlineUser) =>
          onlineUser.username.toLocaleLowerCase(),
        ),
      );
      setMembersByConversation((current) =>
        Object.fromEntries(
          Object.entries(current).map(([conversationId, members]) => [
            conversationId,
            members.map((member) => ({
              ...member,
              isOnline: onlineSet.has(member.username.toLocaleLowerCase()),
            })),
          ]),
        ),
      );
    });
    connection.on("ConversationAdded", (conversation: Conversation) => {
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ]);
    });
    connection.on("MembersChanged", (event: MembersChangedEvent) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === event.conversationId
            ? { ...conversation, memberCount: event.memberCount }
            : conversation,
        ),
      );
      if (activeIdRef.current === event.conversationId) {
        void loadMembers(event.conversationId);
      }
    });
    connection.on("ConversationRenamed", (event: ConversationRenamedEvent) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === event.conversationId
            ? { ...conversation, title: event.title }
            : conversation,
        ),
      );
    });
    connection.on(
      "ConversationAvatarUpdated",
      (event: ConversationAvatarUpdatedEvent) => {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === event.conversationId
              ? { ...conversation, avatarUrl: event.avatarUrl }
              : conversation,
          ),
        );
      },
    );
    connection.on("UserAvatarUpdated", (event: UserAvatarUpdatedEvent) => {
      if (event.userId === user.id) {
        onUserUpdated({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: event.avatarUrl,
        });
      }
      setUserResults((current) =>
        current.map((item) =>
          item.id === event.userId
            ? { ...item, avatarUrl: event.avatarUrl }
            : item,
        ),
      );
      setOnlineUsers((current) =>
        current.map((item) =>
          item.id === event.userId
            ? { ...item, avatarUrl: event.avatarUrl }
            : item,
        ),
      );
      setViewedProfile((current) =>
        current?.id === event.userId
          ? { ...current, avatarUrl: event.avatarUrl }
          : current,
      );
      setSelectedUsers((current) =>
        current.map((item) =>
          item.id === event.userId
            ? { ...item, avatarUrl: event.avatarUrl }
            : item,
        ),
      );
      setMembersByConversation((current) =>
        Object.fromEntries(
          Object.entries(current).map(([conversationId, members]) => [
            conversationId,
            members.map((member) =>
              member.id === event.userId
                ? { ...member, avatarUrl: event.avatarUrl }
                : member,
            ),
          ]),
        ),
      );
      setMessagesByConversation((current) =>
        Object.fromEntries(
          Object.entries(current).map(([conversationId, messages]) => [
            conversationId,
            messages.map((message) =>
              message.senderUserId === event.userId
                ? { ...message, senderAvatarUrl: event.avatarUrl }
                : message,
            ),
          ]),
        ),
      );
      void loadConversations();
    });
    connection.on(
      "UserDisplayNameUpdated",
      (event: UserDisplayNameUpdatedEvent) => {
        if (event.userId === user.id) {
          onUserUpdated({
            id: user.id,
            username: user.username,
            displayName: event.displayName,
            avatarUrl: user.avatarUrl,
          });
        }
        setUserResults((current) =>
          current.map((item) =>
            item.id === event.userId
              ? { ...item, displayName: event.displayName }
              : item,
          ),
        );
        setOnlineUsers((current) =>
          current
            .map((item) =>
              item.id === event.userId
                ? { ...item, displayName: event.displayName }
                : item,
            )
            .sort((left, right) =>
              left.displayName.localeCompare(right.displayName),
            ),
        );
        setViewedProfile((current) =>
          current?.id === event.userId
            ? { ...current, displayName: event.displayName }
            : current,
        );
        setSelectedUsers((current) =>
          current.map((item) =>
            item.id === event.userId
              ? { ...item, displayName: event.displayName }
              : item,
          ),
        );
        setMembersByConversation((current) =>
          Object.fromEntries(
            Object.entries(current).map(([conversationId, members]) => [
              conversationId,
              members.map((member) =>
                member.id === event.userId
                  ? { ...member, displayName: event.displayName }
                  : member,
              ),
            ]),
          ),
        );
        setConversations((current) =>
          current.map((conversation) =>
            conversation.lastMessageSenderUserId === event.userId
              ? { ...conversation, lastMessageSenderName: event.displayName }
              : conversation,
          ),
        );
        void loadConversations();
      },
    );
    connection.on("ConversationRemoved", (event: ConversationRemovedEvent) => {
      removeConversation(event.conversationId);
    });
    connection.on(
      "ConversationMuteChanged",
      (event: ConversationMuteChangedEvent) => {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === event.conversationId
              ? { ...conversation, isMuted: event.isMuted }
              : conversation,
          ),
        );
      },
    );
    connection.on("UserBlockChanged", (event: UserBlockChangedEvent) => {
      setBlockedUsernames((current) => {
        const next = new Set(current);
        const normalized = event.username.toLocaleLowerCase();
        if (event.isBlocked) {
          next.add(normalized);
        } else {
          next.delete(normalized);
        }
        return next;
      });
    });
    connection.on("UserTyping", (event: TypingEvent) => {
      setTypingUsers((current) => {
        const previous = current[event.conversationId] ?? [];
        const next = event.isTyping
          ? [...new Set([...previous, event.username])]
          : previous.filter(
              (name) =>
                name.toLocaleLowerCase() !== event.username.toLocaleLowerCase(),
            );
        return { ...current, [event.conversationId]: next };
      });
    });
    const markConnected = () => {
      if (disposed) return;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      setStatus("connected");
      setError((current) =>
        current === LIVE_CHAT_OFFLINE_ERROR ? "" : current,
      );
    };

    const scheduleConnectionRetry = () => {
      if (disposed || retryTimer !== null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void startConnection();
      }, 30_000);
    };

    const startConnection = async () => {
      if (disposed || connection.state !== HubConnectionState.Disconnected) {
        return;
      }

      try {
        await connection.start();
        markConnected();
      } catch {
        if (disposed) return;
        setStatus("offline");
        setError(LIVE_CHAT_OFFLINE_ERROR);
        scheduleConnectionRetry();
      }
    };

    connection.onreconnecting(() => {
      if (!disposed) setStatus("reconnecting");
    });
    connection.onreconnected(markConnected);
    connection.onclose(() => {
      if (disposed) return;
      setStatus("offline");
      scheduleConnectionRetry();
    });

    connectionRef.current = connection;
    void startConnection();

    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      connectionRef.current = null;
      void connection.stop();
    };
  }, [
    loadConversations,
    loadMembers,
    onUserUpdated,
    removeConversation,
    receiveMessage,
    user.avatarUrl,
    user.displayName,
    user.id,
    user.username,
  ]);

  useEffect(() => {
    if (!conversationDialog) return;

    const abortController = new AbortController();
    const timer = window.setTimeout(() => {
      setIsSearchingUsers(true);
      const conversationFilter =
        conversationDialog === "add-members" && activeId
          ? `&conversationId=${encodeURIComponent(activeId)}`
          : "";
      fetch(
        `${API_URL}/api/users?currentUsername=${encodeURIComponent(
          user.username,
        )}&query=${encodeURIComponent(userQuery.trim())}${conversationFilter}`,
        { signal: abortController.signal },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error(await readError(response));
          return (await response.json()) as SearchUser[];
        })
        .then(setUserResults)
        .catch((requestError) => {
          if (
            requestError instanceof DOMException &&
            requestError.name === "AbortError"
          ) {
            return;
          }
          setDialogError(
            requestError instanceof Error
              ? requestError.message
              : "Could not find people.",
          );
        })
        .finally(() => {
          if (!abortController.signal.aborted) setIsSearchingUsers(false);
        });
    }, 220);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [activeId, conversationDialog, user.username, userQuery]);

  useEffect(() => {
    if (!activeId) return;
    setIsLoadingMessages(true);
    setConversations((current) =>
      current.map((item) =>
        item.id === activeId ? { ...item, unreadCount: 0 } : item,
      ),
    );

    fetch(
      `${API_URL}/api/conversations/${activeId}/messages?username=${encodeURIComponent(user.username)}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as Message[];
      })
      .then((messages) => {
        setMessagesByConversation((current) => ({
          ...current,
          [activeId]: messages,
        }));
        const lastMessage = messages.at(-1);
        if (
          lastMessage &&
          connectionRef.current?.state === HubConnectionState.Connected
        ) {
          return connectionRef.current.invoke(
            "MarkRead",
            activeId,
            lastMessage.sequenceNumber,
          );
        }
      })
      .catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load messages.",
        );
      })
      .finally(() => setIsLoadingMessages(false));
  }, [activeId, user.username]);

  useEffect(() => {
    setAttachmentFiles([]);
    setReplyingToMessageId(null);
    setConversationTab("chat");
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    loadMembers(activeId).catch((requestError) => {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load conversation members.",
      );
    });
  }, [activeId, loadMembers]);

  useEffect(() => {
    if (conversationTab === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeMessages.length, activeId, conversationTab]);

  const groupedMessages = useMemo(() => {
    return activeMessages.map((message, index) => {
      const previous = activeMessages[index - 1];
      const startsDay =
        !previous ||
        new Date(previous.createdAt).toDateString() !==
          new Date(message.createdAt).toDateString();
      const startsGroup =
        !previous ||
        previous.senderUserId !== message.senderUserId ||
        new Date(message.createdAt).getTime() -
          new Date(previous.createdAt).getTime() >
          5 * 60 * 1000;
      return { message, startsDay, startsGroup };
    });
  }, [activeMessages]);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    const connection = connectionRef.current;
    if (
      (!content && attachmentFiles.length === 0) ||
      !activeId ||
      !connection ||
      connection.state !== HubConnectionState.Connected ||
      isActiveDirectMessagingBlocked ||
      isSendingMessage
    ) {
      return;
    }

    const filesToSend = attachmentFiles;
    const replyToMessageId = replyingToMessageId;
    setDraft("");
    setAttachmentFiles([]);
    setReplyingToMessageId(null);
    setIsSendingMessage(true);
    setError("");
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    try {
      await connection.invoke("SetTyping", activeId, false);
      if (filesToSend.length > 0) {
        const formData = new FormData();
        filesToSend.forEach((file) => formData.append("files", file));
        formData.append("content", content);
        formData.append("clientMessageId", crypto.randomUUID());
        if (replyToMessageId) {
          formData.append("replyToMessageId", replyToMessageId);
        }
        const response = await fetch(
          `${API_URL}/api/conversations/${activeId}/messages/attachments?username=${encodeURIComponent(
            user.username,
          )}`,
          { method: "POST", body: formData },
        );
        if (!response.ok) throw new Error(await readError(response));
        receiveMessage((await response.json()) as Message);
      } else {
        await connection.invoke("SendMessage", {
          conversationId: activeId,
          content,
          clientMessageId: crypto.randomUUID(),
          replyToMessageId,
        });
      }
    } catch (requestError) {
      setDraft(content);
      setAttachmentFiles(filesToSend);
      setReplyingToMessageId(replyToMessageId);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Your message was not sent.",
      );
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function shareCurrentLocation(location: SharedLocation) {
    const connection = connectionRef.current;
    if (
      !activeId ||
      !connection ||
      connection.state !== HubConnectionState.Connected
    ) {
      throw new Error(LIVE_CHAT_OFFLINE_ERROR);
    }

    await connection.invoke("SendMessage", {
      conversationId: activeId,
      content: `My current location: ${location.url}`,
      clientMessageId: crypto.randomUUID(),
      messageType: "location",
      replyToMessageId: replyingToMessageId,
    });
    setReplyingToMessageId(null);
  }

  async function editMessage(
    event: FormEvent<HTMLFormElement>,
    messageId: string,
  ) {
    event.preventDefault();
    const content = editMessageDraft.trim();
    if (!content) return;

    try {
      const response = await fetch(
        `${API_URL}/api/messages/${messageId}?username=${encodeURIComponent(
          user.username,
        )}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      setEditingMessageId(null);
      setEditMessageDraft("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not edit the message.",
      );
    }
  }

  async function deleteMessage() {
    if (!deletingMessage || isDeletingMessage) return;

    setIsDeletingMessage(true);
    try {
      const response = await fetch(
        `${API_URL}/api/messages/${deletingMessage.id}?username=${encodeURIComponent(
          user.username,
        )}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await readError(response));
      setDeletingMessage(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not delete the message.",
      );
    } finally {
      setIsDeletingMessage(false);
    }
  }

  async function toggleMessageReaction(messageId: string, reaction: string) {
    try {
      const response = await fetch(
        `${API_URL}/api/messages/${messageId}/reactions?username=${encodeURIComponent(
          user.username,
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reaction }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update the reaction.",
      );
    }
  }

  async function updateGroupMemberRole(
    member: ConversationMember,
    role: "owner" | "member",
  ) {
    if (!activeId || memberActionId) return;

    setMemberActionId(member.id);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${activeId}/members/${
          member.id
        }/role?username=${encodeURIComponent(user.username)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));

      const members = (await response.json()) as ConversationMember[];
      setMembersByConversation((current) => ({
        ...current,
        [activeId]: members,
      }));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : role === "owner"
            ? "Could not make this person an owner."
            : "Could not remove this person’s Owner role.",
      );
    } finally {
      setMemberActionId(null);
    }
  }

  async function removeGroupMember() {
    if (!activeId || !memberToRemove || memberActionId) return;

    const member = memberToRemove;
    setMemberActionId(member.id);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${activeId}/members/${
          member.id
        }?username=${encodeURIComponent(user.username)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await readError(response));

      setMemberToRemove(null);
      await loadMembers(activeId);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not remove this person from the group.",
      );
    } finally {
      setMemberActionId(null);
    }
  }

  async function copyMessage(message: Message) {
    const copyText =
      message.content ??
      (message.attachments ?? [])
        .map((attachment) => attachment.fileName)
        .join(", ");
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      setError("Could not copy this message.");
    }
  }

  function beginReply(message: Message) {
    setReplyingToMessageId(message.id);
    setEditingMessageId(null);
    window.requestAnimationFrame(() => draftInputRef.current?.focus());
  }

  function scrollToMessage(messageId: string) {
    const messageElement = document.getElementById(`message-${messageId}`);
    messageElement?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => messageElement?.focus(), 350);
  }

  function attachmentUrl(attachmentId: string, download = false) {
    return `${API_URL}/api/attachments/${attachmentId}?username=${encodeURIComponent(
      user.username,
    )}${download ? "&download=true" : ""}`;
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    const connection = connectionRef.current;
    if (!activeId || connection?.state !== HubConnectionState.Connected) return;

    void connection.invoke("SetTyping", activeId, value.trim().length > 0);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      void connection.invoke("SetTyping", activeId, false);
    }, 1200);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function insertEmoji(emoji: string) {
    const input = draftInputRef.current;
    const selectionStart = input?.selectionStart ?? draft.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const nextDraft =
      draft.slice(0, selectionStart) + emoji + draft.slice(selectionEnd);
    if (nextDraft.length > 2000) return;

    handleDraftChange(nextDraft);
    const nextCursor = selectionStart + emoji.length;
    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    const title = newGroupTitle.trim();
    if (title.length < 2 || selectedUsers.length === 0) return;

    setIsSavingMembers(true);
    setDialogError("");
    try {
      const response = await fetch(
        `${API_URL}/api/conversations?username=${encodeURIComponent(user.username)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            usernames: selectedUsers.map(
              (selectedUser) => selectedUser.username,
            ),
          }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));

      const conversation = (await response.json()) as Conversation;
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ]);
      setActiveId(conversation.id);
      setNewGroupTitle("");
      setSelectedUsers([]);
      setUserQuery("");
      setConversationDialog(null);
      setIsSidebarOpen(false);
      await connectionRef.current?.invoke("JoinConversation", conversation.id);
    } catch (requestError) {
      setDialogError(
        requestError instanceof Error
          ? requestError.message
          : "Could not create the group.",
      );
    } finally {
      setIsSavingMembers(false);
    }
  }

  async function createDirectConversation(
    targetUser: SearchUser,
    showDialogError = true,
  ) {
    setCreatingDirectUserId(targetUser.id);
    if (showDialogError) setDialogError("");
    else setError("");

    try {
      const response = await fetch(
        `${API_URL}/api/conversations/direct?username=${encodeURIComponent(
          user.username,
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: targetUser.username }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));

      const conversation = (await response.json()) as Conversation;
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ]);
      setActiveId(conversation.id);
      setConversationTab("chat");
      setConversationDialog(null);
      setUserQuery("");
      setIsSidebarOpen(false);
      await connectionRef.current?.invoke("JoinConversation", conversation.id);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Could not start that conversation.";
      if (showDialogError) setDialogError(message);
      else setError(message);
    } finally {
      setCreatingDirectUserId(null);
    }
  }

  function toggleSelectedUser(selectedUser: SearchUser) {
    setSelectedUsers((current) =>
      current.some((item) => item.id === selectedUser.id)
        ? current.filter((item) => item.id !== selectedUser.id)
        : [...current, selectedUser],
    );
    setDialogError("");
  }

  function openConversationDialog(mode: "direct" | "group" | "add-members") {
    setConversationDialog(mode);
    setDialogError("");
    setUserQuery("");
    setUserResults([]);
    setSelectedUsers([]);
  }

  async function addMembers(event: FormEvent) {
    event.preventDefault();
    if (!activeId || selectedUsers.length === 0) return;

    setIsSavingMembers(true);
    setDialogError("");
    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${activeId}/members?username=${encodeURIComponent(
          user.username,
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usernames: selectedUsers.map(
              (selectedUser) => selectedUser.username,
            ),
          }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));

      const members = (await response.json()) as ConversationMember[];
      setMembersByConversation((current) => ({
        ...current,
        [activeId]: members,
      }));
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeId
            ? { ...conversation, memberCount: members.length }
            : conversation,
        ),
      );
      setConversationDialog(null);
      setSelectedUsers([]);
      setUserQuery("");
    } catch (requestError) {
      setDialogError(
        requestError instanceof Error
          ? requestError.message
          : "Could not add those people.",
      );
    } finally {
      setIsSavingMembers(false);
    }
  }

  function openRenameDialog() {
    if (!activeConversation || activeConversation.type !== "group") return;
    setRenameTitle(activeConversation.title ?? "");
    setRenameError("");
    setIsRenameDialogOpen(true);
  }

  async function renameGroup(event: FormEvent) {
    event.preventDefault();
    if (!activeConversation || activeConversation.type !== "group") return;

    const title = renameTitle.trim();
    if (title.length < 2 || title === activeConversation.title || isRenaming) {
      return;
    }

    setIsRenaming(true);
    setRenameError("");
    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${
          activeConversation.id
        }/title?username=${encodeURIComponent(user.username)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));

      const renamed = (await response.json()) as ConversationRenamedEvent;
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === renamed.conversationId
            ? { ...conversation, title: renamed.title }
            : conversation,
        ),
      );
      setIsRenameDialogOpen(false);
    } catch (requestError) {
      setRenameError(
        requestError instanceof Error
          ? requestError.message
          : "Could not rename the group.",
      );
    } finally {
      setIsRenaming(false);
    }
  }

  async function leaveGroup() {
    if (
      !conversationToLeave ||
      conversationToLeave.type !== "group" ||
      isLeaving
    ) {
      return;
    }

    const conversation = conversationToLeave;
    setIsLeaving(true);
    setLeaveError("");
    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${
          conversation.id
        }/members/me?username=${encodeURIComponent(user.username)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await readError(response));

      removeConversation(conversation.id);
      setConversationToLeave(null);
    } catch (requestError) {
      setLeaveError(
        requestError instanceof Error
          ? requestError.message
          : "Could not leave the group.",
      );
    } finally {
      setIsLeaving(false);
    }
  }

  async function toggleConversationMute(conversation: Conversation) {
    if (conversationActionId) return;

    setConversationActionId(conversation.id);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${
          conversation.id
        }/members/me/mute?username=${encodeURIComponent(user.username)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isMuted: !conversation.isMuted }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));

      const changed = (await response.json()) as ConversationMuteChangedEvent;
      setConversations((current) =>
        current.map((item) =>
          item.id === changed.conversationId
            ? { ...item, isMuted: changed.isMuted }
            : item,
        ),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update conversation notifications.",
      );
    } finally {
      setConversationActionId(null);
    }
  }

  async function toggleUserBlock(targetUsername: string) {
    if (userBlockActionName) return;

    const normalizedTarget = targetUsername.toLocaleLowerCase();
    const isBlocked = blockedUsernames.has(normalizedTarget);
    setUserBlockActionName(normalizedTarget);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/users/blocked/${encodeURIComponent(
          targetUsername,
        )}?username=${encodeURIComponent(user.username)}`,
        { method: isBlocked ? "DELETE" : "PUT" },
      );
      if (!response.ok) throw new Error(await readError(response));

      const changed = (await response.json()) as UserBlockChangedEvent;
      setBlockedUsernames((current) => {
        const next = new Set(current);
        const changedUsername = changed.username.toLocaleLowerCase();
        if (changed.isBlocked) {
          next.add(changedUsername);
        } else {
          next.delete(changedUsername);
        }
        return next;
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `Could not ${isBlocked ? "unblock" : "block"} this user.`,
      );
    } finally {
      setUserBlockActionName(null);
    }
  }

  async function uploadUserAvatar(file: File) {
    const formData = new FormData();
    formData.append("image", file);
    const response = await fetch(
      `${API_URL}/api/users/avatar?username=${encodeURIComponent(user.username)}`,
      { method: "POST", body: formData },
    );
    if (!response.ok) throw new Error(await readError(response));

    const updatedUser = (await response.json()) as User;
    onUserUpdated(updatedUser);
  }

  async function updateDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingDisplayName) return;

    const displayName = displayNameDraft.trim();
    if (displayName.length < 2 || displayName.length > 100) {
      setDisplayNameError("Display name must be between 2 and 100 characters.");
      return;
    }

    setIsSavingDisplayName(true);
    setDisplayNameError("");
    try {
      const response = await fetch(
        `${API_URL}/api/users/display-name?username=${encodeURIComponent(
          user.username,
        )}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));

      const updatedUser = (await response.json()) as User;
      onUserUpdated(updatedUser);
      setDisplayNameDraft(updatedUser.displayName);
      setAvatarDialog(null);
    } catch (requestError) {
      setDisplayNameError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update your display name.",
      );
    } finally {
      setIsSavingDisplayName(false);
    }
  }

  async function uploadGroupAvatar(file: File) {
    if (!activeConversation || activeConversation.type !== "group") {
      throw new Error("Choose a group conversation first.");
    }

    const formData = new FormData();
    formData.append("image", file);
    const response = await fetch(
      `${API_URL}/api/conversations/${
        activeConversation.id
      }/avatar?username=${encodeURIComponent(user.username)}`,
      { method: "POST", body: formData },
    );
    if (!response.ok) throw new Error(await readError(response));

    const updated = (await response.json()) as ConversationAvatarUpdatedEvent;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === updated.conversationId
          ? { ...conversation, avatarUrl: updated.avatarUrl }
          : conversation,
      ),
    );
  }

  const currentTypingUsers = activeId ? (typingUsers[activeId] ?? []) : [];
  const isOnline = status === "connected";

  return (
    <main className="chat-shell">
      <button
        className={`mobile-scrim ${isSidebarOpen ? "visible" : ""}`}
        aria-label="Close conversation menu"
        onClick={() => setIsSidebarOpen(false)}
      />
      <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <div className="sidebar-brand brand">
          <span className="brand-mark">
            <MessageCircleMore size={20} strokeWidth={2.5} />
          </span>
          <span>Huddle</span>
          <button
            className="icon-button mobile-close"
            aria-label="Close menu"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-heading">
            <span>Conversations</span>
            <button
              className="icon-button"
              aria-label="Create a conversation"
              onClick={() => openConversationDialog("direct")}
            >
              <Plus size={17} />
            </button>
          </div>
          <nav aria-label="Conversations">
            {conversations.map((conversation) => (
              <div
                className={`conversation-row ${
                  conversation.id === activeId ? "active" : ""
                }`}
                key={conversation.id}
              >
                <button
                  className="conversation-item"
                  onClick={() => {
                    setActiveId(conversation.id);
                    setIsSidebarOpen(false);
                  }}
                >
                  <span
                    className={`channel-icon ${
                      conversation.type === "direct" ? "direct-icon" : ""
                    }`}
                    style={
                      conversation.type === "direct" && !conversation.avatarUrl
                        ? {
                            backgroundColor: avatarColor(
                              conversation.title ?? "",
                            ),
                          }
                        : undefined
                    }
                  >
                    {conversation.avatarUrl ? (
                      <AvatarContent
                        avatarUrl={conversation.avatarUrl}
                        name={conversation.title ?? "Conversation"}
                      />
                    ) : conversation.type === "direct" ? (
                      initials(conversation.title ?? "Direct")
                    ) : (
                      <Hash size={17} />
                    )}
                  </span>
                  <span className="conversation-copy">
                    <strong>{conversationDisplayTitle(conversation)}</strong>
                    {conversation.lastMessage && conversation.lastMessageAt ? (
                      <small className="conversation-summary">
                        <span className="preview-sender">
                          {conversation.lastMessageSenderUserId === null
                            ? "System"
                            : conversation.lastMessageSenderUserId === user.id
                              ? "You"
                              : (conversation.lastMessageSenderName ??
                                "Someone")}
                          :
                        </span>
                        <span className="preview-message">
                          {conversation.lastMessage}
                        </span>
                        <time dateTime={conversation.lastMessageAt}>
                          {formatTime(conversation.lastMessageAt)}
                        </time>
                      </small>
                    ) : (
                      <small>Start the conversation</small>
                    )}
                  </span>
                  <span className="conversation-indicators">
                    {conversation.isMuted && (
                      <BellOff
                        className="conversation-muted-icon"
                        size={13}
                        aria-label="Muted"
                      />
                    )}
                    {conversation.unreadCount > 0 && (
                      <span className="unread-badge">
                        {conversation.unreadCount}
                      </span>
                    )}
                  </span>
                </button>
                <ConversationActions
                  title={conversationDisplayTitle(conversation)}
                  isMuted={conversation.isMuted}
                  canToggleBlock={
                    conversation.type === "direct" &&
                    Boolean(conversation.directUsername) &&
                    conversation.directUserId !== user.id
                  }
                  isBlocked={Boolean(
                    conversation.directUsername &&
                      blockedUsernames.has(
                        conversation.directUsername.toLocaleLowerCase(),
                      ),
                  )}
                  canLeave={
                    conversation.type === "group" &&
                    conversation.title !== "General"
                  }
                  disabled={
                    conversationActionId === conversation.id ||
                    Boolean(
                      conversation.directUsername &&
                        userBlockActionName ===
                          conversation.directUsername.toLocaleLowerCase(),
                    )
                  }
                  onToggleMute={() => void toggleConversationMute(conversation)}
                  onToggleBlock={() => {
                    if (conversation.directUsername) {
                      void toggleUserBlock(conversation.directUsername);
                    }
                  }}
                  onLeave={() => {
                    setLeaveError("");
                    setConversationToLeave(conversation);
                  }}
                />
              </div>
            ))}
          </nav>
        </div>

        <div className="sidebar-user">
          <button
            className="avatar avatar-small avatar-edit-trigger"
            type="button"
            aria-label="Edit your profile"
            style={
              !user.avatarUrl
                ? { backgroundColor: avatarColor(user.username) }
                : undefined
            }
            onClick={() => {
              setProfileTab("avatar");
              setDisplayNameDraft(user.displayName);
              setDisplayNameError("");
              setAvatarDialog("user");
            }}
          >
            <AvatarContent avatarUrl={user.avatarUrl} name={user.displayName} />
            <i className="presence-dot" aria-label="Online" />
          </button>
          <span className="sidebar-user-copy">
            <strong>{user.displayName}</strong>
            <small>Online</small>
          </span>
          <PushNotificationButton
            apiUrl={API_URL}
            username={user.username}
            onError={setError}
          />
          <button
            className="icon-button"
            type="button"
            aria-label="Sign out"
            onClick={() => setIsLogoutDialogOpen(true)}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <section
        className={`conversation-panel ${
          conversationTab === "chat" ? "" : "detail-mode"
        }`}
      >
        <header className="conversation-header">
          <button
            className="icon-button mobile-menu"
            aria-label="Open conversation menu"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="conversation-title">
            {activeConversation?.type === "group" ? (
              <button
                className="header-channel-icon avatar-edit-trigger group-avatar-trigger"
                type="button"
                aria-label="Update this group's avatar"
                title="Change group avatar"
                onClick={() => setAvatarDialog("group")}
              >
                {activeConversation.avatarUrl ? (
                  <AvatarContent
                    avatarUrl={activeConversation.avatarUrl}
                    name={activeConversation.title ?? "Group"}
                  />
                ) : (
                  <Hash size={19} />
                )}
              </button>
            ) : activeConversation?.type === "direct" ? (
              <button
                className="header-channel-icon direct-icon direct-profile-trigger"
                type="button"
                disabled={!directParticipantProfile}
                aria-label={`View ${conversationDisplayTitle(
                  activeConversation,
                )}'s profile`}
                title="View profile"
                style={
                  !directParticipantProfile?.avatarUrl
                    ? {
                        backgroundColor: avatarColor(
                          directParticipantProfile?.username ??
                            activeConversation.title ??
                            "",
                        ),
                      }
                    : undefined
                }
                onClick={() => {
                  if (directParticipantProfile) {
                    setViewedProfile(directParticipantProfile);
                  }
                }}
              >
                {directParticipantProfile?.avatarUrl ? (
                  <AvatarContent
                    avatarUrl={directParticipantProfile.avatarUrl}
                    name={directParticipantProfile.displayName}
                  />
                ) : (
                  initials(
                    directParticipantProfile?.displayName ??
                      activeConversation.title ??
                      "Direct",
                  )
                )}
              </button>
            ) : (
              <span
                className="header-channel-icon"
              >
                <Hash size={19} />
              </span>
            )}
            <div>
              <h1>{conversationDisplayTitle(activeConversation, "Welcome")}</h1>
              <p>
                {activeConversation?.type === "direct"
                  ? "Direct conversation"
                  : `${activeConversation?.memberCount ?? 0} ${
                      activeConversation?.memberCount === 1
                        ? "member"
                        : "members"
                    } · ${activeMembers.filter((member) => member.isOnline).length} online`}
              </p>
            </div>
          </div>
          {activeConversation?.type === "group" && (
            <div className="header-group-actions">
              <button
                className={`icon-button header-group-action mute-conversation-action ${
                  activeConversation.isMuted ? "active" : ""
                }`}
                type="button"
                disabled={conversationActionId !== null}
                aria-label={
                  activeConversation.isMuted
                    ? "Unmute this group"
                    : "Mute this group"
                }
                title={
                  activeConversation.isMuted ? "Unmute group" : "Mute group"
                }
                onClick={() =>
                  void toggleConversationMute(activeConversation)
                }
              >
                {conversationActionId === activeConversation.id ? (
                  <LoaderCircle className="spin" size={16} />
                ) : activeConversation.isMuted ? (
                  <Bell size={16} />
                ) : (
                  <BellOff size={16} />
                )}
              </button>
              {activeConversation.title !== "General" && (
                <button
                  className="icon-button header-group-action"
                  type="button"
                  aria-label="Rename this group"
                  onClick={openRenameDialog}
                >
                  <Pencil size={16} />
                </button>
              )}
              <button
                className="icon-button header-group-action"
                type="button"
                aria-label="Add people to this group"
                onClick={() => openConversationDialog("add-members")}
              >
                <UserRoundPlus size={17} />
              </button>
              {activeConversation.title !== "General" && (
                <button
                  className="icon-button header-group-action leave-group-action"
                  type="button"
                  aria-label="Leave this group"
                  onClick={() => {
                    setLeaveError("");
                    setConversationToLeave(activeConversation);
                  }}
                >
                  <LogOut size={16} />
                </button>
              )}
            </div>
          )}
          {activeConversation?.type === "direct" && (
            <div className="header-group-actions">
              <button
                className={`icon-button header-group-action mute-conversation-action ${
                  activeConversation.isMuted ? "active" : ""
                }`}
                type="button"
                disabled={conversationActionId !== null}
                aria-label={
                  activeConversation.isMuted
                    ? "Unmute this conversation"
                    : "Mute this conversation"
                }
                title={
                  activeConversation.isMuted
                    ? "Unmute conversation"
                    : "Mute conversation"
                }
                onClick={() =>
                  void toggleConversationMute(activeConversation)
                }
              >
                {conversationActionId === activeConversation.id ? (
                  <LoaderCircle className="spin" size={16} />
                ) : activeConversation.isMuted ? (
                  <Bell size={16} />
                ) : (
                  <BellOff size={16} />
                )}
              </button>
              {directParticipantProfile &&
                directParticipantProfile.id !== user.id && (
                <button
                  className={`icon-button header-group-action ${
                    isDirectParticipantBlocked
                      ? "unblock-user-action"
                      : "block-user-action"
                  }`}
                  type="button"
                  disabled={userBlockActionName !== null}
                  aria-label={
                    isDirectParticipantBlocked
                      ? `Unblock ${directParticipantProfile.displayName}`
                      : `Block ${directParticipantProfile.displayName}`
                  }
                  title={
                    isDirectParticipantBlocked ? "Unblock user" : "Block user"
                  }
                  onClick={() =>
                    void toggleUserBlock(directParticipantProfile.username)
                  }
                >
                  {userBlockActionName ===
                  directParticipantNormalizedUsername ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : isDirectParticipantBlocked ? (
                    <Check size={16} />
                  ) : (
                    <Ban size={16} />
                  )}
                </button>
                )}
            </div>
          )}
          <div className={`connection-pill ${status}`}>
            {status === "offline" ? <WifiOff size={13} /> : <span />}
            {status === "connected"
              ? "Live"
              : status === "reconnecting"
                ? "Reconnecting"
                : status === "offline"
                  ? "Offline"
                  : "Connecting"}
          </div>
        </header>

        {error && (
          <div className="chat-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}

        <nav
          className="conversation-tabs"
          aria-label="Conversation details"
          role="tablist"
        >
          <button
            id="conversation-tab-chat"
            type="button"
            role="tab"
            aria-selected={conversationTab === "chat"}
            aria-controls="conversation-chat-panel"
            onClick={() => setConversationTab("chat")}
          >
            <MessageCircleMore size={16} />
            Chat
          </button>
          <button
            id="conversation-tab-files"
            type="button"
            role="tab"
            aria-selected={conversationTab === "files"}
            aria-controls="conversation-files-panel"
            onClick={() => setConversationTab("files")}
          >
            <FileText size={16} />
            Files
            {activeFileItems.length > 0 && (
              <span>{activeFileItems.length}</span>
            )}
          </button>
          <button
            id="conversation-tab-photos"
            type="button"
            role="tab"
            aria-selected={conversationTab === "photos"}
            aria-controls="conversation-photos-panel"
            onClick={() => setConversationTab("photos")}
          >
            <Images size={16} />
            Photos
            {activePhotoItems.length > 0 && (
              <span>{activePhotoItems.length}</span>
            )}
          </button>
        </nav>

        <div
          className="message-list"
          id="conversation-chat-panel"
          role="tabpanel"
          aria-labelledby="conversation-tab-chat"
          aria-live="polite"
          hidden={conversationTab !== "chat"}
        >
          {isLoadingMessages ? (
            <div className="center-state">
              <LoaderCircle className="spin" size={24} />
              <p>Bringing in the conversation…</p>
            </div>
          ) : activeMessages.length === 0 ? (
            <div className="empty-chat">
              <span className="empty-icon">
                <MessageCircleMore size={26} />
              </span>
              <h2>This is the beginning.</h2>
              <p>
                {activeConversation?.type === "direct" ? (
                  <>
                    Say hello to{" "}
                    <strong>
                      {conversationDisplayTitle(
                        activeConversation,
                        "this person",
                      )}
                    </strong>
                    . A good conversation only needs one first message.
                  </>
                ) : (
                  <>
                    Say hello in{" "}
                    <strong>#{activeConversation?.title ?? "this chat"}</strong>
                    . A good conversation only needs one first message.
                  </>
                )}
              </p>
            </div>
          ) : (
            groupedMessages.map(({ message, startsDay, startsGroup }) => {
              const isOwnMessage = message.senderUserId === user.id;
              const replyTarget = message.replyToMessageId
                ? activeMessages.find(
                    (candidate) => candidate.id === message.replyToMessageId,
                  )
                : undefined;

              return (
                <div key={message.id}>
                  {startsDay && (
                    <div className="date-divider">
                      <span>{dateLabel(message.createdAt)}</span>
                    </div>
                  )}
                  {message.messageType === "system" ? (
                    <article className="system-message">
                      <p>{message.content}</p>
                      <time dateTime={message.createdAt}>
                        {formatTime(message.createdAt)}
                      </time>
                    </article>
                  ) : (
                    <article
                      id={`message-${message.id}`}
                      className={`message ${
                        startsGroup ? "group-start" : "compact"
                      } ${isOwnMessage ? "own-message" : ""}`}
                      tabIndex={0}
                    >
                      {startsGroup && !isOwnMessage ? (
                        <span
                          className="avatar"
                          style={
                            !message.senderAvatarUrl
                              ? {
                                  backgroundColor: avatarColor(
                                    message.username ?? "System",
                                  ),
                                }
                              : undefined
                          }
                        >
                          <AvatarContent
                            avatarUrl={message.senderAvatarUrl}
                            name={message.username ?? "System"}
                          />
                        </span>
                      ) : !startsGroup ? (
                        <time className="compact-time">
                          {formatTime(message.createdAt)}
                        </time>
                      ) : null}
                      <div className="message-body">
                        {startsGroup && (
                          <div className="message-meta">
                            {!isOwnMessage && (
                              <strong>{message.username ?? "System"}</strong>
                            )}
                            <time dateTime={message.createdAt}>
                              {formatTime(message.createdAt)}
                            </time>
                          </div>
                        )}
                        {message.deletedAt ? (
                          <p className="deleted-message">
                            This message was deleted.
                          </p>
                        ) : (
                          <>
                            {message.replyToMessageId && (
                              <button
                                className="message-reply-reference"
                                type="button"
                                disabled={!replyTarget}
                                aria-label={
                                  replyTarget
                                    ? `Go to message from ${
                                        replyTarget.senderUserId === user.id
                                          ? "you"
                                          : (replyTarget.username ??
                                            "unknown user")
                                      }`
                                    : "Original message unavailable"
                                }
                                onClick={() =>
                                  scrollToMessage(message.replyToMessageId!)
                                }
                              >
                                <strong>
                                  {replyTarget
                                    ? replyTarget.senderUserId === user.id
                                      ? "You"
                                      : (replyTarget.username ?? "Unknown user")
                                    : "Original message"}
                                </strong>
                                <span>
                                  {replyTarget
                                    ? replyPreview(replyTarget)
                                    : "Message unavailable"}
                                </span>
                              </button>
                            )}
                            <MessageAttachmentList
                              attachments={message.attachments ?? []}
                              getUrl={attachmentUrl}
                            />
                            {editingMessageId === message.id ? (
                              <form
                                className="message-edit-form"
                                onSubmit={(event) =>
                                  void editMessage(event, message.id)
                                }
                              >
                                <textarea
                                  autoFocus
                                  maxLength={2000}
                                  rows={2}
                                  value={editMessageDraft}
                                  onChange={(event) =>
                                    setEditMessageDraft(event.target.value)
                                  }
                                />
                                <div>
                                  <button
                                    className="secondary-button"
                                    type="button"
                                    onClick={() => setEditingMessageId(null)}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="message-edit-save"
                                    type="submit"
                                    disabled={!editMessageDraft.trim()}
                                  >
                                    Save
                                  </button>
                                </div>
                              </form>
                            ) : (
                              message.content && (
                                <MessageContent content={message.content} />
                              )
                            )}
                            {message.editedAt &&
                              editingMessageId !== message.id && (
                                <small className="message-edited">Edited</small>
                              )}
                            <MessageActions
                              isOwn={isOwnMessage}
                              canEdit={
                                message.messageType !== "location" &&
                                Boolean(message.content)
                              }
                              canCopy={Boolean(
                                message.content ||
                                (message.attachments?.length ?? 0) > 0,
                              )}
                              disabled={
                                !isOnline || editingMessageId === message.id
                              }
                              reactions={message.reactions ?? []}
                              resolveAvatarUrl={avatarSource}
                              onReaction={(reaction) =>
                                void toggleMessageReaction(message.id, reaction)
                              }
                              onReply={() => beginReply(message)}
                              onEdit={() => {
                                setEditingMessageId(message.id);
                                setEditMessageDraft(message.content ?? "");
                              }}
                              onDelete={() => setDeletingMessage(message)}
                              onCopy={() => void copyMessage(message)}
                            />
                          </>
                        )}
                      </div>
                    </article>
                  )}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {conversationTab === "files" && (
          <div
            className="conversation-assets"
            id="conversation-files-panel"
            role="tabpanel"
            aria-labelledby="conversation-tab-files"
          >
            <div className="conversation-assets-heading">
              <div>
                <p className="eyebrow">Shared files</p>
                <h2>Files in this conversation</h2>
              </div>
              <span>
                {activeFileItems.length}{" "}
                {activeFileItems.length === 1 ? "file" : "files"}
              </span>
            </div>
            {isLoadingMessages ? (
              <div className="center-state">
                <LoaderCircle className="spin" size={24} />
                <p>Loading shared files…</p>
              </div>
            ) : activeFileItems.length === 0 ? (
              <div className="empty-assets">
                <span>
                  <FileText size={25} />
                </span>
                <h3>No files shared yet</h3>
                <p>
                  Documents and other downloadable attachments will appear here.
                </p>
              </div>
            ) : (
              <div className="conversation-file-grid">
                {activeFileItems.map(
                  ({ attachment, messageId, senderName, createdAt }) => (
                    <a
                      className="conversation-file-card"
                      key={`${messageId}-${attachment.id}`}
                      href={attachmentUrl(attachment.id, true)}
                      download={attachment.fileName}
                    >
                      <span className="conversation-file-icon">
                        <FileText size={21} />
                      </span>
                      <span className="conversation-file-copy">
                        <strong>{attachment.fileName}</strong>
                        <small>
                          {formatAttachmentSize(attachment.fileSize)} ·{" "}
                          {senderName}
                        </small>
                        <time dateTime={createdAt}>
                          {formatAttachmentDate(createdAt)}
                        </time>
                      </span>
                      <Download size={17} />
                    </a>
                  ),
                )}
              </div>
            )}
          </div>
        )}

        {conversationTab === "photos" && (
          <div
            className="conversation-assets"
            id="conversation-photos-panel"
            role="tabpanel"
            aria-labelledby="conversation-tab-photos"
          >
            <div className="conversation-assets-heading">
              <div>
                <p className="eyebrow">Shared media</p>
                <h2>Photos and videos</h2>
              </div>
              <span>
                {activePhotoItems.length}{" "}
                {activePhotoItems.length === 1 ? "item" : "items"}
              </span>
            </div>
            {isLoadingMessages ? (
              <div className="center-state">
                <LoaderCircle className="spin" size={24} />
                <p>Loading shared media…</p>
              </div>
            ) : activePhotoItems.length === 0 ? (
              <div className="empty-assets">
                <span>
                  <Images size={25} />
                </span>
                <h3>No photos or videos yet</h3>
                <p>
                  Images, camera captures, videos, and screen recordings appear
                  here.
                </p>
              </div>
            ) : (
              <div className="conversation-media-grid">
                {activePhotoItems.map(
                  ({ attachment, messageId, senderName, createdAt }) => (
                    <article
                      className="conversation-media-card"
                      key={`${messageId}-${attachment.id}`}
                    >
                      <div className="conversation-media-preview">
                        {attachment.contentType.startsWith("image/") ? (
                          <a
                            href={attachmentUrl(attachment.id)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${attachment.fileName}`}
                          >
                            <img
                              src={attachmentUrl(attachment.id)}
                              alt={attachment.fileName}
                              loading="lazy"
                            />
                          </a>
                        ) : (
                          <video
                            src={attachmentUrl(attachment.id)}
                            controls
                            playsInline
                            preload="metadata"
                          />
                        )}
                      </div>
                      <div className="conversation-media-meta">
                        <div>
                          <strong>{attachment.fileName}</strong>
                          <small>
                            {senderName} · {formatAttachmentDate(createdAt)}
                          </small>
                        </div>
                        <a
                          href={attachmentUrl(attachment.id, true)}
                          download={attachment.fileName}
                          aria-label={`Download ${attachment.fileName}`}
                          title="Download"
                        >
                          <Download size={16} />
                        </a>
                      </div>
                    </article>
                  ),
                )}
              </div>
            )}
          </div>
        )}

        <div
          className="typing-line"
          aria-live="polite"
          hidden={conversationTab !== "chat"}
        >
          {currentTypingUsers.length > 0 && (
            <>
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
              {currentTypingUsers.length === 1
                ? `${currentTypingUsers[0]} is typing`
                : `${currentTypingUsers.slice(0, 2).join(" and ")} are typing`}
            </>
          )}
        </div>

        <form
          className="composer"
          onSubmit={sendMessage}
          hidden={conversationTab !== "chat"}
        >
          {replyingToMessageId && (
            <div className="composer-reply-preview">
              <span>
                <strong>
                  Replying to{" "}
                  {replyingToMessage
                    ? replyingToMessage.senderUserId === user.id
                      ? "yourself"
                      : (replyingToMessage.username ?? "Unknown user")
                    : "a message"}
                </strong>
                <small>
                  {replyingToMessage
                    ? replyPreview(replyingToMessage)
                    : "Message unavailable"}
                </small>
              </span>
              <button
                type="button"
                aria-label="Cancel reply"
                title="Cancel reply"
                onClick={() => setReplyingToMessageId(null)}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <MessageAttachmentPicker
            files={attachmentFiles}
            disabled={
              !activeConversation ||
              !isOnline ||
              isSendingMessage ||
              isActiveDirectMessagingBlocked
            }
            onChange={setAttachmentFiles}
            onError={setError}
          />
          <textarea
            ref={draftInputRef}
            aria-label={`Message ${conversationDisplayTitle(
              activeConversation,
              "conversation",
            )}`}
            disabled={
              !activeConversation ||
              !isOnline ||
              isSendingMessage ||
              isActiveDirectMessagingBlocked
            }
            maxLength={2000}
            placeholder={
              isActiveDirectMessagingBlocked
                ? `Unblock ${
                    directParticipantProfile?.displayName ?? "this user"
                  } to send messages`
                : isOnline
                ? `Message ${
                    activeConversation?.type === "direct" ? "" : "#"
                  }${conversationDisplayTitle(activeConversation, "conversation")}`
                : "Waiting for a live connection…"
            }
            rows={1}
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <EmojiPicker
            disabled={
              !activeConversation ||
              !isOnline ||
              isSendingMessage ||
              isActiveDirectMessagingBlocked
            }
            onSelect={insertEmoji}
          />
          <LocationShareButton
            key={activeId}
            disabled={
              !activeConversation ||
              !isOnline ||
              isSendingMessage ||
              isActiveDirectMessagingBlocked
            }
            onShare={shareCurrentLocation}
            onError={setError}
          />
          <button
            className="send-button"
            type="submit"
            disabled={
              (!draft.trim() && attachmentFiles.length === 0) ||
              !isOnline ||
              isSendingMessage ||
              isActiveDirectMessagingBlocked
            }
            aria-label="Send message"
          >
            <Send size={18} />
          </button>
          <span className="composer-hint">
            Enter to send · Shift + Enter for a new line
          </span>
        </form>
      </section>

      <aside className="people-panel">
        <div className="people-heading">
          <Users size={17} />
          <span>
            {activeConversation?.type === "group"
              ? "Group members"
              : "Online now"}
          </span>
          <strong>
            {activeConversation?.type === "group"
              ? activeConversation.memberCount
              : onlineUsers.length}
          </strong>
          {activeConversation?.type === "group" && (
            <button
              className="icon-button add-member-button"
              aria-label="Add people to this group"
              onClick={() => openConversationDialog("add-members")}
            >
              <UserRoundPlus size={16} />
            </button>
          )}
        </div>
        <div className="people-list">
          {activeConversation?.type === "group"
            ? activeMembers.map((member) => {
                const canManageMember =
                  member.id !== user.id &&
                  canManageGroupMembers &&
                  (member.role !== "owner" ||
                    activeConversation.title !== "General");

                return (
                  <div className="person" key={member.id}>
                    <span
                      className="avatar avatar-small"
                      style={
                        !member.avatarUrl
                          ? { backgroundColor: avatarColor(member.username) }
                          : undefined
                      }
                    >
                      <AvatarContent
                        avatarUrl={member.avatarUrl}
                        name={member.displayName}
                      />
                      {member.isOnline && <i className="presence-dot" />}
                    </span>
                    <span className="person-copy">
                      <strong>
                        {member.displayName}
                        {member.id === user.id ? " (you)" : ""}
                      </strong>
                      <small>
                        {member.role === "owner"
                          ? "Owner"
                          : member.isOnline
                            ? "Online"
                            : "Offline"}
                      </small>
                    </span>
                    {member.id !== user.id && (
                      <GroupMemberActions
                        displayName={member.displayName}
                        isOwner={member.role === "owner"}
                        canChangeRole={canManageMember}
                        canRemove={
                          canManageMember &&
                          activeConversation.title !== "General"
                        }
                        disabled={
                          memberActionId === member.id ||
                          creatingDirectUserId === member.id
                        }
                        onChat={() =>
                          void createDirectConversation(member, false)
                        }
                        onViewProfile={() => setViewedProfile(member)}
                        onMakeOwner={() =>
                          void updateGroupMemberRole(member, "owner")
                        }
                        onRemoveOwner={() =>
                          void updateGroupMemberRole(member, "member")
                        }
                        onRemove={() => setMemberToRemove(member)}
                      />
                    )}
                  </div>
                );
              })
            : onlineUsers.map((onlineUser) => {
                const normalizedName =
                  onlineUser.username.toLocaleLowerCase();
                const isCurrentUser =
                  normalizedName === user.username.toLocaleLowerCase();
                const isBlocked = blockedUsernames.has(normalizedName);

                return (
                  <div className="person" key={onlineUser.id}>
                    <span
                      className="avatar avatar-small"
                      style={
                        !onlineUser.avatarUrl
                          ? {
                              backgroundColor: avatarColor(
                                onlineUser.username,
                              ),
                            }
                          : undefined
                      }
                    >
                      <AvatarContent
                        avatarUrl={onlineUser.avatarUrl}
                        name={onlineUser.displayName}
                      />
                      <i className="presence-dot" />
                    </span>
                    <span className="person-copy">
                      <strong>{onlineUser.displayName}</strong>
                      <small>
                        {isCurrentUser
                          ? "You"
                          : isBlocked
                            ? "Blocked"
                            : "Available"}
                      </small>
                    </span>
                    {!isCurrentUser && (
                      <OnlineUserActions
                        displayName={onlineUser.displayName}
                        isBlocked={isBlocked}
                        disabled={
                          userBlockActionName === normalizedName ||
                          creatingDirectUserId === onlineUser.id
                        }
                        onChat={() =>
                          void createDirectConversation(onlineUser, false)
                        }
                        onViewProfile={() =>
                          setViewedProfile({
                            ...onlineUser,
                            isOnline: true,
                          })
                        }
                        onToggleBlock={() =>
                          void toggleUserBlock(onlineUser.username)
                        }
                      />
                    )}
                  </div>
                );
              })}
        </div>
        <div className="people-note">
          <span>✦</span>
          <p>Small conversations can lead to big ideas.</p>
        </div>
      </aside>

      {viewedProfile && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card online-profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="online-profile-title"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">User profile</p>
                <h2 id="online-profile-title">{viewedProfile.displayName}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close profile"
                onClick={() => setViewedProfile(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="online-profile-content">
              <span
                className="online-profile-avatar"
                style={
                  !viewedProfile.avatarUrl
                    ? {
                        backgroundColor: avatarColor(viewedProfile.username),
                      }
                    : undefined
                }
              >
                <AvatarContent
                  avatarUrl={viewedProfile.avatarUrl}
                  name={viewedProfile.displayName}
                />
                {viewedProfile.isOnline && <i className="presence-dot" />}
              </span>
              <strong>{viewedProfile.displayName}</strong>
              <span>@{viewedProfile.username}</span>
              <small className={viewedProfile.isOnline ? "" : "offline"}>
                {viewedProfile.isOnline ? "Online now" : "Offline"}
              </small>
            </div>
          </div>
        </div>
      )}

      {conversationDialog && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <p className="eyebrow">New conversation</p>
                <h2>
                  {conversationDialog === "direct"
                    ? "Message someone"
                    : conversationDialog === "group"
                      ? "Create a group"
                      : "Add people"}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => {
                  setConversationDialog(null);
                  setSelectedUsers([]);
                  setUserQuery("");
                }}
              >
                <X size={20} />
              </button>
            </div>
            {conversationDialog !== "add-members" && (
              <div
                className="dialog-tabs"
                role="tablist"
                aria-label="Conversation type"
              >
                <button
                  className={conversationDialog === "direct" ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={conversationDialog === "direct"}
                  onClick={() => openConversationDialog("direct")}
                >
                  <UserRoundPlus size={16} />
                  Direct message
                </button>
                <button
                  className={conversationDialog === "group" ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={conversationDialog === "group"}
                  onClick={() => openConversationDialog("group")}
                >
                  <Hash size={16} />
                  Group space
                </button>
              </div>
            )}

            {conversationDialog === "direct" ? (
              <div className="direct-picker">
                <label htmlFor="user-search">Find a person</label>
                <div className="search-field">
                  <Search size={17} />
                  <input
                    id="user-search"
                    autoFocus
                    placeholder="Search by name or username"
                    value={userQuery}
                    onChange={(event) => {
                      setDialogError("");
                      setUserQuery(event.target.value);
                    }}
                  />
                </div>
                <div className="user-results" aria-live="polite">
                  {isSearchingUsers ? (
                    <div className="picker-state">
                      <LoaderCircle className="spin" size={18} />
                      Finding people…
                    </div>
                  ) : userResults.length === 0 ? (
                    <div className="picker-state">No other users found.</div>
                  ) : (
                    userResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        className="user-result"
                        disabled={creatingDirectUserId !== null}
                        onClick={() => void createDirectConversation(result)}
                      >
                        <span
                          className="avatar avatar-small"
                          style={
                            !result.avatarUrl
                              ? {
                                  backgroundColor: avatarColor(result.username),
                                }
                              : undefined
                          }
                        >
                          <AvatarContent
                            avatarUrl={result.avatarUrl}
                            name={result.displayName}
                          />
                        </span>
                        <span>
                          <strong>{result.displayName}</strong>
                          <small>@{result.username}</small>
                        </span>
                        {creatingDirectUserId === result.id ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : (
                          <MessageCircleMore size={17} />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <form
                className="group-picker"
                onSubmit={
                  conversationDialog === "group" ? createGroup : addMembers
                }
              >
                {conversationDialog === "group" && (
                  <>
                    <label htmlFor="group-title">Group name</label>
                    <input
                      id="group-title"
                      autoFocus
                      maxLength={200}
                      placeholder="e.g. Product ideas"
                      value={newGroupTitle}
                      onChange={(event) => setNewGroupTitle(event.target.value)}
                    />
                  </>
                )}

                <div className="picker-label-row">
                  <label htmlFor="group-user-search">
                    {conversationDialog === "group"
                      ? "Add people"
                      : `Add to ${activeConversation?.title ?? "group"}`}
                  </label>
                  <span>{selectedUsers.length} selected</span>
                </div>

                {selectedUsers.length > 0 && (
                  <div className="selected-users" aria-label="Selected people">
                    {selectedUsers.map((selectedUser) => (
                      <button
                        key={selectedUser.id}
                        type="button"
                        onClick={() => toggleSelectedUser(selectedUser)}
                        aria-label={`Remove ${selectedUser.displayName}`}
                      >
                        <span
                          className="avatar"
                          style={{
                            backgroundColor: selectedUser.avatarUrl
                              ? undefined
                              : avatarColor(selectedUser.username),
                          }}
                        >
                          <AvatarContent
                            avatarUrl={selectedUser.avatarUrl}
                            name={selectedUser.displayName}
                          />
                        </span>
                        {selectedUser.displayName}
                        <X size={13} />
                      </button>
                    ))}
                  </div>
                )}

                <div className="search-field">
                  <Search size={17} />
                  <input
                    id="group-user-search"
                    autoFocus={conversationDialog === "add-members"}
                    placeholder="Search people"
                    value={userQuery}
                    onChange={(event) => {
                      setDialogError("");
                      setUserQuery(event.target.value);
                    }}
                  />
                </div>

                <div
                  className="user-results multi-select-results"
                  aria-live="polite"
                >
                  {isSearchingUsers ? (
                    <div className="picker-state">
                      <LoaderCircle className="spin" size={18} />
                      Finding people…
                    </div>
                  ) : userResults.length === 0 ? (
                    <div className="picker-state">
                      {conversationDialog === "add-members"
                        ? "Everyone available is already in this group."
                        : "No other users found."}
                    </div>
                  ) : (
                    userResults.map((result) => {
                      const isSelected = selectedUsers.some(
                        (selectedUser) => selectedUser.id === result.id,
                      );
                      return (
                        <button
                          key={result.id}
                          type="button"
                          className={`user-result ${isSelected ? "selected" : ""}`}
                          onClick={() => toggleSelectedUser(result)}
                          aria-pressed={isSelected}
                        >
                          <span
                            className="avatar avatar-small"
                            style={
                              !result.avatarUrl
                                ? {
                                    backgroundColor: avatarColor(
                                      result.username,
                                    ),
                                  }
                                : undefined
                            }
                          >
                            <AvatarContent
                              avatarUrl={result.avatarUrl}
                              name={result.displayName}
                            />
                          </span>
                          <span>
                            <strong>{result.displayName}</strong>
                            <small>@{result.username}</small>
                          </span>
                          <span className="selection-check">
                            {isSelected && <Check size={14} />}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <button
                  className="primary-button"
                  disabled={
                    isSavingMembers ||
                    selectedUsers.length === 0 ||
                    (conversationDialog === "group" &&
                      newGroupTitle.trim().length < 2)
                  }
                  type="submit"
                >
                  {isSavingMembers ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : conversationDialog === "group" ? (
                    `Create group with ${selectedUsers.length + 1} people`
                  ) : (
                    `Add ${selectedUsers.length} ${
                      selectedUsers.length === 1 ? "person" : "people"
                    }`
                  )}
                </button>
              </form>
            )}
            {dialogError && (
              <p className="form-error" role="alert">
                {dialogError}
              </p>
            )}
          </div>
        </div>
      )}

      {isRenameDialogOpen && activeConversation?.type === "group" && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card rename-group-form" onSubmit={renameGroup}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Group settings</p>
                <h2>Rename conversation</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setIsRenameDialogOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <label htmlFor="rename-group-title">Group name</label>
            <input
              id="rename-group-title"
              autoFocus
              maxLength={200}
              value={renameTitle}
              onChange={(event) => {
                setRenameTitle(event.target.value);
                setRenameError("");
              }}
            />
            <p className="rename-note">
              Everyone in the group will see a message about this change.
            </p>

            {renameError && (
              <p className="form-error" role="alert">
                {renameError}
              </p>
            )}

            <button
              className="primary-button"
              disabled={
                isRenaming ||
                renameTitle.trim().length < 2 ||
                renameTitle.trim() === activeConversation.title
              }
              type="submit"
            >
              {isRenaming ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                "Save new name"
              )}
            </button>
          </form>
        </div>
      )}

      {conversationToLeave?.type === "group" && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card leave-group-dialog">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Group settings</p>
                <h2>Leave {conversationToLeave.title}?</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setConversationToLeave(null)}
              >
                <X size={20} />
              </button>
            </div>

            <p>
              This conversation will be removed from your list. Everyone
              remaining in the group will see that you left.
            </p>

            {leaveError && (
              <p className="form-error" role="alert">
                {leaveError}
              </p>
            )}

            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isLeaving}
                onClick={() => setConversationToLeave(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={isLeaving}
                onClick={() => void leaveGroup()}
              >
                {isLeaving ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  "Leave conversation"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLogoutDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card confirmation-dialog">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Account</p>
                <h2>Sign out of Huddle?</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setIsLogoutDialogOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <p>You’ll return to the username sign-in screen.</p>

            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setIsLogoutDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => {
                  setIsLogoutDialogOpen(false);
                  onLogout();
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {avatarDialog &&
        (avatarDialog === "user" || activeConversation?.type === "group") && (
          <div className="modal-backdrop" role="presentation">
            <div className="modal-card avatar-dialog">
              <div className="modal-header">
                <div>
                  <p className="eyebrow">
                    {avatarDialog === "user"
                      ? "Your profile"
                      : "Group settings"}
                  </p>
                  <h2>
                    {avatarDialog === "user"
                      ? "Edit your profile"
                      : "Update group avatar"}
                  </h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    setAvatarDialog(null);
                    setDisplayNameError("");
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              {avatarDialog === "user" && (
                <div
                  className="dialog-tabs profile-tabs"
                  role="tablist"
                  aria-label="Profile settings"
                >
                  <button
                    className={profileTab === "avatar" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={profileTab === "avatar"}
                    onClick={() => {
                      setProfileTab("avatar");
                      setDisplayNameError("");
                    }}
                  >
                    Avatar
                  </button>
                  <button
                    className={profileTab === "display-name" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={profileTab === "display-name"}
                    onClick={() => {
                      setProfileTab("display-name");
                      setDisplayNameDraft(user.displayName);
                      setDisplayNameError("");
                    }}
                  >
                    Display name
                  </button>
                </div>
              )}

              {avatarDialog === "group" || profileTab === "avatar" ? (
                <AvatarPicker
                  imageUrl={avatarSource(
                    avatarDialog === "user"
                      ? user.avatarUrl
                      : activeConversation?.avatarUrl,
                  )}
                  fallback={initials(
                    avatarDialog === "user"
                      ? user.displayName
                      : (activeConversation?.title ?? "Group"),
                  )}
                  label={
                    avatarDialog === "user"
                      ? user.displayName
                      : (activeConversation?.title ?? "Group")
                  }
                  capture={avatarDialog === "user" ? "user" : "environment"}
                  onSelect={
                    avatarDialog === "user"
                      ? uploadUserAvatar
                      : uploadGroupAvatar
                  }
                />
              ) : (
                <form
                  className="profile-name-form"
                  onSubmit={updateDisplayName}
                >
                  <label htmlFor="profile-display-name">Display name</label>
                  <input
                    id="profile-display-name"
                    autoFocus
                    maxLength={100}
                    value={displayNameDraft}
                    onChange={(event) => {
                      setDisplayNameDraft(event.target.value);
                      setDisplayNameError("");
                    }}
                    placeholder="Enter your display name"
                  />
                  <p className="profile-name-note">
                    Your username @{user.username} will stay the same.
                  </p>
                  {displayNameError && (
                    <p className="form-error">{displayNameError}</p>
                  )}
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={
                      isSavingDisplayName ||
                      displayNameDraft.trim().length < 2 ||
                      displayNameDraft.trim() === user.displayName
                    }
                  >
                    {isSavingDisplayName ? "Saving..." : "Save display name"}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

      {deletingMessage && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-message-title"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Delete message</p>
                <h2 id="delete-message-title">Delete this message?</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setDeletingMessage(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p>This removes the message for everyone in the conversation.</p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDeletingMessage(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={isDeletingMessage}
                onClick={() => void deleteMessage()}
              >
                {isDeletingMessage ? "Deleting..." : "Delete message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {memberToRemove && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-member-title"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Remove member</p>
                <h2 id="remove-member-title">
                  Remove {memberToRemove.displayName}?
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setMemberToRemove(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              They will lose access to this group and its messages until someone
              adds them again.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setMemberToRemove(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={memberActionId === memberToRemove.id}
                onClick={() => void removeGroupMember()}
              >
                {memberActionId === memberToRemove.id
                  ? "Removing..."
                  : "Remove member"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);

  return user ? (
    <ChatApp
      user={user}
      onLogout={() => setUser(null)}
      onUserUpdated={setUser}
    />
  ) : (
    <LoginScreen onLogin={setUser} />
  );
}

export default App;
