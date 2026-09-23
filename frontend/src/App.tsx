import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from "@microsoft/signalr";
import {
  AlarmClock,
  AtSign,
  Ban,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  BellOff,
  CalendarDays,
  CalendarCheck2,
  ClipboardList,
  CirclePlay,
  CircleDot,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  GripVertical,
  HardDrive,
  Hash,
  Images,
  LoaderCircle,
  Link2,
  ListChecks,
  LocateFixed,
  LogOut,
  MapPinned,
  Maximize2,
  Menu,
  MessageCircleMore,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  Moon,
  Navigation,
  NotebookPen,
  Pencil,
  Phone,
  PhoneOff,
  Pin,
  PinOff,
  Plus,
  Route,
  Radio,
  RefreshCw,
  Send,
  Search,
  Square,
  Sun,
  Trash2,
  UserRoundPlus,
  Users,
  Video,
  VideoOff,
  WifiOff,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./App.css";
import "./theme.css";
import {
  applyTheme,
  getThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "./theme";
import { AvatarPicker } from "./components/AvatarPicker";
import { CalendarView } from "./components/CalendarView";
import { MeetingsView } from "./components/MeetingsView";
import { DocumentsView } from "./components/DocumentsView";
import { PublicDocumentsView } from "./components/PublicDocumentsView";
import { StorageManagementView } from "./components/StorageManagementView";
import { TasksView } from "./components/TasksView";
import { NotesView } from "./components/NotesView";
import { RemindersView } from "./components/RemindersView";
import { NotificationsView, type UserNotification } from "./components/NotificationsView";
import {
  type ChatAttachment,
  MessageAttachmentList,
  MessageAttachmentPicker,
} from "./components/MessageAttachments";
import {
  formatMediaDuration,
  resolveUnknownVideoDuration,
} from "./components/mediaDuration";
import { type ChatReaction, MessageActions } from "./components/MessageActions";
import {
  MessagePoll as MessagePollCard,
  type ChatPoll,
} from "./components/MessagePoll";
import { EmojiPicker } from "./components/EmojiPicker";
import { GroupMemberActions } from "./components/GroupMemberActions";
import {
  LocationShareButton,
  type SharedLocation,
} from "./components/LocationShareButton";
import { LiveLocationShareButton } from "./components/LiveLocationShareButton";
import { ConversationActions } from "./components/ConversationActions";
import { OnlineUserActions } from "./components/OnlineUserActions";
import { PushNotificationButton } from "./components/PushNotificationButton";
import {
  DirectCallOverlay,
  useDirectCall,
} from "./components/DirectCall";
import { GroupMeetingOverlay } from "./components/GroupMeeting";
import {
  type LiveStream,
  LiveStreamConversationControls,
  LiveStreams,
} from "./components/LiveStreams";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5045";
const LIVE_CHAT_OFFLINE_ERROR =
  "Live chat is offline. Check that the server is running.";
const LiveLocationMap = lazy(async () => {
  const module = await import("./components/LiveLocationMap");
  return { default: module.LiveLocationMap };
});

type User = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

type Conversation = {
  id: string;
  type: "direct" | "group" | "live_stream";
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

type MentionSearch = {
  start: number;
  end: number;
  query: string;
};

type MentionOption =
  | { kind: "everyone" }
  | { kind: "member"; member: ConversationMember };

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

type GroupMeetingParticipant = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  isMuted: boolean;
};

type GroupMeeting = {
  meetingId: string;
  conversationId: string;
  startedByUserId: string;
  startedByDisplayName: string;
  startedAt: string;
  screenSharingUserId: string | null;
  participants: GroupMeetingParticipant[];
};

type GroupMeetingChangedEvent = {
  conversationId: string;
  meeting: GroupMeeting | null;
};

type Message = {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  username: string | null;
  senderAvatarUrl: string | null;
  content: string | null;
  messageType: string;
  locationLatitude: number | null;
  locationLongitude: number | null;
  clientMessageId: string | null;
  sequenceNumber: number;
  replyToMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  attachments?: ChatAttachment[] | null;
  reactions?: ChatReaction[] | null;
  liveLocation?: LiveLocation | null;
  poll?: ChatPoll | null;
};

type SessionRecording = {
  id: string;
  conversationId: string;
  sessionId: string;
  startedByUserId: string;
  startedByDisplayName: string;
  startedByAvatarUrl: string | null;
  sessionType: string;
  provider: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMilliseconds: number | null;
  attachment: ChatAttachment | null;
  canCheckProviderStatus: boolean;
  providerStatus?: string | null;
  providerStatusCheckedAt?: string | null;
};

type RecordingStatusCheck = {
  recordingId: string;
  status: string;
  providerStatus: string;
  checkedAt: string;
};

type LiveLocation = {
  messageId: string;
  conversationId: string;
  userId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  startedAt: string;
  updatedAt: string;
  expiresAt: string;
  stoppedAt: string | null;
  isActive: boolean;
};

type LiveLocationStoppedEvent = {
  messageId: string;
  conversationId: string;
  stoppedAt: string;
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

type PinnedMessage = {
  messageId: string;
  conversationId: string;
  senderUserId: string | null;
  senderUsername: string | null;
  content: string | null;
  messageType: string;
  messageCreatedAt: string;
  pinnedByUserId: string;
  pinnedByDisplayName: string;
  pinnedAt: string;
};

type MessagePinChangedEvent = {
  conversationId: string;
  messageId: string;
  isPinned: boolean;
  pin: PinnedMessage | null;
};

type MessagePollVoteChangedEvent = {
  messageId: string;
  conversationId: string;
  userId: string;
  selectedOptionIds: string[];
  totalVotes: number;
  options: { id: string; voteCount: number }[];
};

type TypingEvent = {
  conversationId: string;
  username: string;
  isTyping: boolean;
};

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";
type ConversationTab =
  | "chat"
  | "polls"
  | "files"
  | "photos"
  | "locations"
  | "recordings";
const EMPTY_MESSAGES: Message[] = [];
const EMPTY_RECORDINGS: SessionRecording[] = [];

type PollDraftOption = { id: string; text: string };

function createPollDraftOptions(): PollDraftOption[] {
  return [
    { id: crypto.randomUUID(), text: "" },
    { id: crypto.randomUUID(), text: "" },
  ];
}

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

function sharedLocation(
  latitude: number | null,
  longitude: number | null,
) {
  if (
    latitude === null ||
    longitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  const formattedLatitude = latitude.toFixed(6);
  const formattedLongitude = longitude.toFixed(6);
  const offset = 0.008;
  const bounds = [
    longitude - offset,
    latitude - offset,
    longitude + offset,
    latitude + offset,
  ].join(",");
  const marker = `${latitude},${longitude}`;

  return {
    latitude,
    longitude,
    url:
      `https://www.openstreetmap.org/?mlat=${formattedLatitude}` +
      `&mlon=${formattedLongitude}#map=16/${formattedLatitude}/${formattedLongitude}`,
    previewUrl:
      `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bounds)}` +
      `&layer=mapnik&marker=${encodeURIComponent(marker)}`,
  };
}

function openOpenStreetMapDirections(
  destinationLatitude: number,
  destinationLongitude: number,
  onError: (message: string) => void,
) {
  if (!navigator.geolocation) {
    onError("Location services are not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      openOpenStreetMapRoute(
        coords.latitude,
        coords.longitude,
        destinationLatitude,
        destinationLongitude,
        onError,
      );
    },
    (locationError) => {
      onError(
        locationError.code === locationError.PERMISSION_DENIED
          ? "Location permission was denied."
          : "Your current location could not be determined.",
      );
    },
    {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 30_000,
    },
  );
}

function openOpenStreetMapRoute(
  originLatitude: number,
  originLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number,
  onError: (message: string) => void,
) {
  const route = [
    `${originLatitude.toFixed(6)},${originLongitude.toFixed(6)}`,
    `${destinationLatitude.toFixed(6)},${destinationLongitude.toFixed(6)}`,
  ].join(";");
  const parameters = new URLSearchParams({
    engine: "fossgis_osrm_car",
    route,
  });
  const directionsUrl =
    `https://www.openstreetmap.org/directions?${parameters.toString()}`;
  const routeWindow = window.open(directionsUrl, "_blank");

  if (routeWindow) {
    routeWindow.opener = null;
  } else {
    onError("Your browser blocked the directions tab.");
  }
}

function getCurrentPosition() {
  if (!navigator.geolocation) {
    return Promise.reject(
      new Error("Location services are not supported by this browser."),
    );
  }
  return new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 30_000,
    }),
  );
}

function isMentionUsernameCharacter(value: string | undefined) {
  return value !== undefined && /[\p{L}\p{N}_.-]/u.test(value);
}

function hasExactMention(content: string, username: string) {
  const loweredContent = content.toLocaleLowerCase();
  const token = `@${username}`.toLocaleLowerCase();
  let start = 0;
  while (start < loweredContent.length) {
    const index = loweredContent.indexOf(token, start);
    if (index < 0) return false;
    const after = index + token.length;
    if (
      !isMentionUsernameCharacter(content[index - 1]) &&
      !isMentionUsernameCharacter(content[after])
    ) {
      return true;
    }
    start = after;
  }
  return false;
}

function findMentionSearch(value: string, cursor: number): MentionSearch | null {
  const beforeCursor = value.slice(0, cursor);
  const start = beforeCursor.lastIndexOf("@");
  if (
    start < 0 ||
    isMentionUsernameCharacter(value[start - 1]) ||
    /[@\n\r]/.test(beforeCursor.slice(start + 1))
  ) {
    return null;
  }
  return { start, end: cursor, query: beforeCursor.slice(start + 1) };
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderMentions(
  text: string,
  members: ConversationMember[],
  keyPrefix: string,
) {
  const usernames = [
    ...new Set(["everyone", ...members.map((member) => member.username)]),
  ].sort((left, right) => right.length - left.length);
  if (usernames.length === 0) return text;

  const memberByUsername = new Map(
    members.map((member) => [member.username.toLocaleLowerCase(), member]),
  );
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_.-])(@(?:${usernames.map(escapeRegularExpression).join("|")}))(?=$|[^\\p{L}\\p{N}_.-])`,
    "giu",
  );
  const result: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const leading = match[1] ?? "";
    const mention = match[2];
    const member = memberByUsername.get(mention.slice(1).toLocaleLowerCase());
    result.push(text.slice(cursor, index), leading);
    result.push(
      <span
        className="message-mention"
        key={`${keyPrefix}-${index}`}
        title={member?.displayName ?? "Everyone in this conversation"}
      >
        {mention}
      </span>,
    );
    cursor = index + match[0].length;
  }
  result.push(text.slice(cursor));
  return result;
}

function MessageContent({
  content,
  members,
}: {
  content: string;
  members: ConversationMember[];
}) {
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
          renderMentions(part, members, `text-${index}`)
        ),
      )}
    </p>
  );
}

function LocationMessageMap({
  latitude,
  longitude,
  onError,
}: {
  latitude: number | null;
  longitude: number | null;
  onError: (message: string) => void;
}) {
  const location = sharedLocation(latitude, longitude);
  if (!location) return <p>Location unavailable.</p>;

  return (
    <div className="location-message-card">
      <iframe
        className="location-message-map"
        src={location.previewUrl}
        title="Shared location"
        loading="lazy"
      />
      <div className="location-message-meta">
        <span>
          <MapPinned size={15} />
          <strong>
            {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
          </strong>
        </span>
        <button
          type="button"
          aria-label="Get directions from your current location"
          title="Directions"
          onClick={() =>
            openOpenStreetMapDirections(
              location.latitude,
              location.longitude,
              onError,
            )
          }
        >
          <Navigation size={16} />
        </button>
        <a
          href={location.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open location in OpenStreetMap"
          title="Open location"
        >
          <ExternalLink size={16} />
        </a>
      </div>
    </div>
  );
}

function LiveDirectionsMap({
  destinationLatitude,
  destinationLongitude,
  onError,
}: {
  destinationLatitude: number;
  destinationLongitude: number;
  onError: (message: string) => void;
}) {
  const [currentPosition, setCurrentPosition] = useState<{
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
  } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<
    { latitude: number; longitude: number }[]
  >([]);
  const [routeStatus, setRouteStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const lastPositionUpdateAtRef = useRef(0);

  useEffect(() => {
    if (!navigator.geolocation) {
      const message = "Location services are not supported by this browser.";
      setLocationError(message);
      onError(message);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const now = Date.now();
        if (now - lastPositionUpdateAtRef.current < 5_000) return;
        lastPositionUpdateAtRef.current = now;
        setLocationError(null);
        setCurrentPosition({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: Number.isFinite(coords.accuracy)
            ? coords.accuracy
            : null,
        });
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Your current location could not be determined.";
        setLocationError(message);
        onError(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 10_000,
      },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [onError]);

  useEffect(() => {
    if (!currentPosition) return;

    const controller = new AbortController();
    const routeTimer = window.setTimeout(async () => {
      setRouteStatus("loading");
      const coordinates =
        `${currentPosition.longitude.toFixed(6)},${currentPosition.latitude.toFixed(6)};` +
        `${destinationLongitude.toFixed(6)},${destinationLatitude.toFixed(6)}`;
      const parameters = new URLSearchParams({
        geometries: "geojson",
        overview: "full",
        steps: "false",
      });

      try {
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coordinates}?${parameters.toString()}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("The routing service is unavailable.");

        const result = (await response.json()) as {
          code?: string;
          message?: string;
          routes?: {
            geometry?: {
              type?: string;
              coordinates?: [number, number][];
            };
          }[];
        };
        const geometry = result.routes?.[0]?.geometry;
        if (
          result.code !== "Ok" ||
          geometry?.type !== "LineString" ||
          !geometry.coordinates ||
          geometry.coordinates.length < 2
        ) {
          throw new Error(result.message ?? "No driving route was found.");
        }

        setRouteCoordinates(
          geometry.coordinates.map(([longitude, latitude]) => ({
            latitude,
            longitude,
          })),
        );
        setRouteStatus("ready");
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }
        setRouteCoordinates([]);
        setRouteStatus("error");
        onError(
          requestError instanceof Error
            ? requestError.message
            : "The driving route could not be calculated.",
        );
      }
    }, 350);

    return () => {
      window.clearTimeout(routeTimer);
      controller.abort();
    };
  }, [
    currentPosition,
    destinationLatitude,
    destinationLongitude,
    onError,
  ]);

  if (!currentPosition) {
    return (
      <div
        className="conversation-location-map live-directions-state"
        role="status"
      >
        {locationError ? (
          <span>{locationError}</span>
        ) : (
          <>
            <LoaderCircle className="spin" size={22} />
            <span>Finding your current location...</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="conversation-location-map live-directions-map-shell">
      <Suspense
        fallback={<div className="live-directions-map map-loading" role="status" />}
      >
        <LiveLocationMap
          latitude={currentPosition.latitude}
          longitude={currentPosition.longitude}
          accuracyMeters={currentPosition.accuracyMeters}
          destination={{
            latitude: destinationLatitude,
            longitude: destinationLongitude,
          }}
          routeCoordinates={routeCoordinates}
          followMarker={false}
          className="live-directions-map"
        />
      </Suspense>
      {routeStatus !== "ready" && (
        <span className={`live-directions-route-state ${routeStatus}`}>
          {routeStatus === "loading"
            ? "Calculating driving route..."
            : "Driving route unavailable"}
        </span>
      )}
    </div>
  );
}

function LiveLocationMessageMap({
  location,
  isOwn,
  isStopping,
  onStop,
  onError,
}: {
  location: LiveLocation;
  isOwn: boolean;
  isStopping: boolean;
  onStop: () => void;
  onError: (message: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const isActive =
    location.isActive && new Date(location.expiresAt).getTime() > now;
  const mapLocation = sharedLocation(location.latitude, location.longitude);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  const remainingMinutes = Math.max(
    0,
    Math.ceil((new Date(location.expiresAt).getTime() - now) / 60_000),
  );

  return (
    <div className="live-location-message-card">
      <Suspense
        fallback={<div className="live-location-message-map map-loading" />}
      >
        <LiveLocationMap
          latitude={location.latitude}
          longitude={location.longitude}
          accuracyMeters={location.accuracyMeters}
          followMarker
          className="live-location-message-map"
        />
      </Suspense>
      <div className="live-location-message-meta">
        <span>
          <strong>{isActive ? "Live location" : "Live location ended"}</strong>
          <small>
            {isActive
              ? `${remainingMinutes} min remaining`
              : `Last updated ${formatAttachmentDate(location.updatedAt)}`}
          </small>
        </span>
        {isActive && mapLocation && (
          <>
            <button
              type="button"
              aria-label="Get directions to live location"
              title="Directions"
              onClick={() =>
                openOpenStreetMapDirections(
                  location.latitude,
                  location.longitude,
                  onError,
                )
              }
            >
              <Navigation size={16} />
            </button>
            <a
              href={mapLocation.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open live location in OpenStreetMap"
              title="Open location"
            >
              <ExternalLink size={16} />
            </a>
          </>
        )}
        {isOwn && isActive && (
          <button
            className="live-location-stop"
            type="button"
            disabled={isStopping}
            onClick={onStop}
          >
            {isStopping ? <LoaderCircle className="spin" size={15} /> : "Stop"}
          </button>
        )}
      </div>
    </div>
  );
}

function messagePreview(message: Message) {
  if (message.messageType === "location") return "Shared a location";
  if (message.messageType === "live_location")
    return "Shared a live location";
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

function pinnedMessagePreview(pin: PinnedMessage) {
  if (pin.content) return pin.content;
  switch (pin.messageType) {
    case "image": return "Image";
    case "video": return "Video";
    case "audio": return "Audio message";
    case "file": return "File attachment";
    case "location": return "Shared location";
    case "live_location": return "Live location";
    default: return "Message";
  }
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

function ThemeSwitcher({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const options = [
    { value: "system", label: "System", Icon: Monitor },
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
  ] as const;
  const CurrentIcon = options.find((option) => option.value === preference)!.Icon;

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="theme-switcher" ref={containerRef}>
      <button
        className="icon-button theme-trigger"
        type="button"
        aria-label={`Theme: ${preference}. Choose theme`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="Choose theme"
        onClick={() => setIsOpen((current) => !current)}
      >
        <CurrentIcon size={18} />
      </button>
      {isOpen && (
        <div className="theme-menu" role="menu" aria-label="Theme">
          {options.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={preference === value}
              onClick={() => {
                onChange(value);
                setIsOpen(false);
              }}
            >
              <Icon size={16} />
              <span>{label}</span>
              {preference === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LoginScreen({
  onLogin,
  themeControl,
}: {
  onLogin: (user: User) => void;
  themeControl: ReactNode;
}) {
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
        {themeControl}
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
  themeControl,
}: {
  user: User;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
  themeControl: ReactNode;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversationTab, setConversationTab] =
    useState<ConversationTab>("chat");
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [maximizedLocation, setMaximizedLocation] = useState<{
    messageId: string;
    host: HTMLElement;
  } | null>(null);
  const [liveDirectionsMessageId, setLiveDirectionsMessageId] = useState<
    string | null
  >(null);
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, Message[]>
  >({});
  const [pinnedMessagesByConversation, setPinnedMessagesByConversation] =
    useState<Record<string, PinnedMessage[]>>({});
  const [isPinnedMessagesOpen, setIsPinnedMessagesOpen] = useState(false);
  const [pinActionMessageId, setPinActionMessageId] = useState<string | null>(
    null,
  );
  const [messageJumpVersion, setMessageJumpVersion] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [historicalConversationId, setHistoricalConversationId] = useState<string | null>(null);
  const [recordingsByConversation, setRecordingsByConversation] = useState<
    Record<string, SessionRecording[]>
  >({});
  const [loadingRecordingsConversationId, setLoadingRecordingsConversationId] =
    useState<string | null>(null);
  const [checkingRecordingId, setCheckingRecordingId] = useState<string | null>(
    null,
  );
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(
    null,
  );
  const [recordingToDelete, setRecordingToDelete] =
    useState<SessionRecording | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [blockedUsernames, setBlockedUsernames] = useState<Set<string>>(
    () => new Set(),
  );
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
  const [groupMeetings, setGroupMeetings] = useState<
    Record<string, GroupMeeting | null>
  >({});
  const [meetingInvite, setMeetingInvite] = useState<GroupMeeting | null>(
    null,
  );
  const [meetingInviteMicEnabled, setMeetingInviteMicEnabled] =
    useState(true);
  const [meetingInviteCameraEnabled, setMeetingInviteCameraEnabled] =
    useState(false);
  const [meetingMediaPreferences, setMeetingMediaPreferences] = useState<
    Record<
      string,
      { microphoneEnabled: boolean; cameraEnabled: boolean }
    >
  >({});
  const [meetingAction, setMeetingAction] = useState<
    "start" | "join" | "leave" | "stop" | null
  >(null);
  const [draft, setDraft] = useState("");
  const [isPollDialogOpen, setIsPollDialogOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollMode, setPollMode] = useState<"single" | "multiple">("single");
  const [pollExpiresAt, setPollExpiresAt] = useState("");
  const [pollOptions, setPollOptions] = useState<PollDraftOption[]>(
    createPollDraftOptions,
  );
  const [draggedPollOptionId, setDraggedPollOptionId] = useState<string | null>(
    null,
  );
  const [pollOptionDropTargetId, setPollOptionDropTargetId] = useState<
    string | null
  >(null);
  const [isCreatingPoll, setIsCreatingPoll] = useState(false);
  const [pollVoteMessageId, setPollVoteMessageId] = useState<string | null>(
    null,
  );
  const [mentionSearch, setMentionSearch] = useState<MentionSearch | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [draftMentionUserIds, setDraftMentionUserIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState("");
  const [hubConnection, setHubConnection] = useState<HubConnection | null>(
    null,
  );
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isMeetingsOpen, setIsMeetingsOpen] = useState(false);
  const [isDocumentsOpen, setIsDocumentsOpen] = useState(false);
  const [isStorageManagementOpen, setIsStorageManagementOpen] = useState(false);
  const [isTasksOpen, setIsTasksOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isRemindersOpen, setIsRemindersOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState<number | null>(null);
  const [notificationMeetingTarget, setNotificationMeetingTarget] = useState<{ id: string; request: number } | null>(null);
  const [notificationDocumentTarget, setNotificationDocumentTarget] = useState<{ id: string; kind: "folder" | "file"; request: number } | null>(null);
  const [notificationTaskTarget, setNotificationTaskTarget] = useState<{ id: string; request: number } | null>(null);
  const [notificationNoteTarget, setNotificationNoteTarget] = useState<{ id: string; request: number } | null>(null);
  const [isLiveStreamsOpen, setIsLiveStreamsOpen] = useState(false);
  useEffect(() => {
    let activeRequest: AbortController | null = null;
    setNotificationUnreadCount(null);
    const checkUnreadCount = async () => {
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      try {
        const response = await fetch(`${API_URL}/api/user-notifications/unread-count?username=${encodeURIComponent(user.username)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        const result = await response.json() as { unreadCount: number };
        if (!controller.signal.aborted && Number.isInteger(result.unreadCount))
          setNotificationUnreadCount(result.unreadCount);
      } catch {
        // Keep the last known count until the next poll.
      }
    };
    void checkUnreadCount();
    const timer = window.setInterval(() => void checkUnreadCount(), 30_000);
    return () => { window.clearInterval(timer); activeRequest?.abort(); };
  }, [user.username]);
  const [requestedLiveStream, setRequestedLiveStream] =
    useState<LiveStream | null>(null);
  const [activeLiveStreamIds, setActiveLiveStreamIds] = useState<Set<string>>(
    () => new Set(),
  );
  const handleActiveLiveStreamsChanged = useCallback(
    (conversationIds: string[]) => {
      setActiveLiveStreamIds(new Set(conversationIds));
    },
    [],
  );
  const [conversationDialog, setConversationDialog] = useState<
    "direct" | "group" | "live-stream" | "add-members" | null
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
  const [sharedConversation, setSharedConversation] =
    useState<Conversation | null>(null);
  const [isJoinLinkCopied, setIsJoinLinkCopied] = useState(false);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isStartingLiveLocation, setIsStartingLiveLocation] = useState(false);
  const [stoppingLiveLocationId, setStoppingLiveLocationId] =
    useState<string | null>(null);
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
  const dismissedMeetingInvitesRef = useRef(new Set<string>());
  const activeIdRef = useRef<string | null>(null);
  const loadedRecordingConversationIdsRef = useRef(new Set<string>());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const pendingMessageJumpRef = useRef<{
    conversationId: string;
    messageId: string;
    ready: boolean;
  } | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const liveLocationWatchRef = useRef<{
    messageId: string;
    watchId: number;
    lastSentAt: number;
  } | null>(null);
  const linkedConversationIdRef = useRef(
    new URLSearchParams(window.location.search).get("conversation"),
  );
  const directCall = useDirectCall({
    connection: hubConnection,
    apiUrl: API_URL,
    username: user.username,
    localUserId: user.id,
    localDisplayName: user.displayName,
    onError: setError,
    resolveAvatarUrl: avatarSource,
  });
  const directCallIsActive = directCall.call !== null;
  const endDirectCall = directCall.endCall;

  useEffect(() => {
    if (status === "offline" && directCallIsActive) {
      void endDirectCall();
    }
  }, [directCallIsActive, endDirectCall, status]);

  const activeConversation = conversations.find((item) => item.id === activeId);
  const joinConversationUrl = sharedConversation
    ? `${window.location.origin}/conversasions/join/${encodeURIComponent(sharedConversation.id)}`
    : "";
  const joinQrCodeUrl = sharedConversation
    ? `${API_URL}/api/conversations/${encodeURIComponent(sharedConversation.id)}/join-qr-code?origin=${encodeURIComponent(window.location.origin)}`
    : "";
  const meetingConversationIdsKey = conversations
    .map((conversation) => conversation.id)
    .sort()
    .join(",");
  const activeGroupMeeting = activeConversation
    ? (groupMeetings[activeConversation.id] ?? null)
    : null;
  const isInActiveGroupMeeting = Boolean(
    activeGroupMeeting?.participants.some(
      (participant) => participant.userId === user.id,
    ),
  );
  const isActiveGroupMeetingStarter =
    activeGroupMeeting?.startedByUserId === user.id;
  const joinedGroupMeeting =
    Object.values(groupMeetings).find((meeting) =>
      meeting?.participants.some(
        (participant) => participant.userId === user.id,
      ),
    ) ?? null;
  const joinedGroupConversation = joinedGroupMeeting
    ? conversations.find(
        (conversation) =>
          conversation.id === joinedGroupMeeting.conversationId,
      )
    : null;
  const meetingInviteConversation = meetingInvite
    ? conversations.find(
        (conversation) =>
          conversation.id === meetingInvite.conversationId,
      )
    : null;
  const meetingInviteIsBlocked = Boolean(
    meetingInviteConversation?.type === "direct" &&
      meetingInviteConversation.directUsername &&
      blockedUsernames.has(
        meetingInviteConversation.directUsername.toLocaleLowerCase(),
      ),
  );
  const meetingInviteId = meetingInvite?.meetingId ?? null;
  const activeMessages = activeId
    ? (messagesByConversation[activeId] ?? EMPTY_MESSAGES)
    : EMPTY_MESSAGES;
  const activePinnedMessages = activeId
    ? (pinnedMessagesByConversation[activeId] ?? [])
    : [];
  const activeRecordings = activeId
    ? (recordingsByConversation[activeId] ?? EMPTY_RECORDINGS)
    : EMPTY_RECORDINGS;
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
  const activePollItems = useMemo(
    () =>
      activeMessages.flatMap((message) =>
        !message.deletedAt && message.messageType === "poll" && message.poll
          ? [
              {
                messageId: message.id,
                poll: message.poll,
                senderName:
                  message.senderUserId === user.id
                    ? "You"
                    : (message.username ?? "Unknown user"),
                createdAt: message.createdAt,
              },
            ]
          : [],
      ),
    [activeMessages, user.id],
  );
  const activeLocationItems = useMemo(
    () =>
      activeMessages.flatMap((message) => {
        if (
          message.deletedAt ||
          (message.messageType !== "location" &&
            message.messageType !== "live_location")
        ) {
          return [];
        }
        const liveLocation =
          message.messageType === "live_location"
            ? (message.liveLocation ?? null)
            : null;
        const location = sharedLocation(
          liveLocation?.latitude ?? message.locationLatitude,
          liveLocation?.longitude ?? message.locationLongitude,
        );
        return location
          ? [
              {
                location,
                liveLocation,
                messageId: message.id,
                senderName:
                  message.senderUserId === user.id
                    ? "You"
                    : (message.username ?? "Unknown user"),
                createdAt: message.createdAt,
              },
            ]
          : [];
      }),
    [activeMessages, user.id],
  );
  const selectedLocationItems = selectedLocationIds.flatMap((messageId) => {
    const item = activeLocationItems.find(
      (candidate) => candidate.messageId === messageId,
    );
    return item ? [item] : [];
  });
  const activeMembers = activeId ? (membersByConversation[activeId] ?? []) : [];
  const mentionOptions: MentionOption[] = mentionSearch
    ? [
        ...("everyone".includes(
          mentionSearch.query.trim().toLocaleLowerCase(),
        )
          ? ([{ kind: "everyone" }] as MentionOption[])
          : []),
        ...activeMembers
          .filter(
            (member) =>
              member.id !== user.id &&
              `${member.displayName} ${member.username}`
                .toLocaleLowerCase()
                .includes(mentionSearch.query.trim().toLocaleLowerCase()),
          )
          .slice(0, 6)
          .map((member): MentionOption => ({ kind: "member", member })),
      ]
    : [];
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
    setPinnedMessagesByConversation((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    setRecordingsByConversation((current) => {
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    loadedRecordingConversationIdsRef.current.delete(conversationId);
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
    setMentionSearch(null);
    setDraftMentionUserIds(new Set());
    setIsPinnedMessagesOpen(false);
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
    return items;
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
    connection.on("MessagePinChanged", (event: MessagePinChangedEvent) => {
      setPinnedMessagesByConversation((current) => {
        const existing = current[event.conversationId] ?? [];
        const withoutMessage = existing.filter(
          (pin) => pin.messageId !== event.messageId,
        );
        return {
          ...current,
          [event.conversationId]:
            event.isPinned && event.pin
              ? [event.pin, ...withoutMessage]
              : withoutMessage,
        };
      });
    });
    connection.on(
      "MessagePollVoteChanged",
      (event: MessagePollVoteChangedEvent) => {
        const resultByOption = new Map(
          event.options.map((option) => [option.id, option.voteCount]),
        );
        setMessagesByConversation((current) => ({
          ...current,
          [event.conversationId]: (current[event.conversationId] ?? []).map(
            (message) =>
              message.id === event.messageId && message.poll
                ? {
                    ...message,
                    poll: {
                      ...message.poll,
                      totalVotes: event.totalVotes,
                      options: message.poll.options.map((option) => ({
                        ...option,
                        voteCount: resultByOption.get(option.id) ?? 0,
                        isSelected:
                          event.userId === user.id
                            ? event.selectedOptionIds.includes(option.id)
                            : option.isSelected,
                      })),
                    },
                  }
                : message,
          ),
        }));
      },
    );
    connection.on("LiveLocationUpdated", (event: LiveLocation) => {
      setMessagesByConversation((current) => ({
        ...current,
        [event.conversationId]: (
          current[event.conversationId] ?? []
        ).map((message) =>
          message.id === event.messageId
            ? { ...message, liveLocation: event }
            : message,
        ),
      }));
    });
    connection.on(
      "LiveLocationStopped",
      (event: LiveLocationStoppedEvent) => {
        setMessagesByConversation((current) => ({
          ...current,
          [event.conversationId]: (
            current[event.conversationId] ?? []
          ).map((message) =>
            message.id === event.messageId && message.liveLocation
              ? {
                  ...message,
                  liveLocation: {
                    ...message.liveLocation,
                    isActive: false,
                    stoppedAt: event.stoppedAt,
                  },
                }
              : message,
          ),
        }));
        if (liveLocationWatchRef.current?.messageId === event.messageId) {
          navigator.geolocation.clearWatch(
            liveLocationWatchRef.current.watchId,
          );
          liveLocationWatchRef.current = null;
        }
      },
    );
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
    connection.on("MeetingConversationChanged", () => {
      void loadConversations();
    });
    connection.on(
      "GroupMeetingChanged",
      (event: GroupMeetingChangedEvent) => {
        setGroupMeetings((current) => ({
          ...current,
          [event.conversationId]: event.meeting,
        }));
        if (!event.meeting) {
          setMeetingInvite((current) =>
            current?.conversationId === event.conversationId
              ? null
              : current,
          );
          return;
        }

        const isParticipant = event.meeting.participants.some(
          (participant) => participant.userId === user.id,
        );
        if (isParticipant) {
          setMeetingInvite((current) =>
            current?.meetingId === event.meeting?.meetingId
              ? null
              : current,
          );
        } else if (
          !dismissedMeetingInvitesRef.current.has(event.meeting.meetingId)
        ) {
          setMeetingInvite(event.meeting);
        }
      },
    );
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
    setHubConnection(connection);
    void startConnection();

    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      connectionRef.current = null;
      setHubConnection(null);
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
    if (
      status !== "connected" ||
      hubConnection?.state !== HubConnectionState.Connected ||
      !meetingConversationIdsKey
    ) {
      return;
    }

    let cancelled = false;
    const conversationIds = meetingConversationIdsKey.split(",");
    void Promise.all(
      conversationIds.map(async (conversationId) => ({
        conversationId,
        meeting: await hubConnection.invoke<GroupMeeting | null>(
          "GetGroupMeeting",
          conversationId,
        ),
      })),
    )
      .then((results) => {
        if (cancelled) return;
        setGroupMeetings((current) => {
          const next = { ...current };
          for (const result of results) {
            next[result.conversationId] = result.meeting;
          }
          return next;
        });
      })
      .catch(() => {
        // Real-time meeting events will continue keeping known state current.
      });
    return () => {
      cancelled = true;
    };
  }, [meetingConversationIdsKey, hubConnection, status]);

  useEffect(() => {
    const conversationId = activeConversation?.id;
    if (
      status !== "connected" ||
      hubConnection?.state !== HubConnectionState.Connected ||
      !conversationId
    ) {
      return;
    }

    let cancelled = false;
    void hubConnection
      .invoke<GroupMeeting | null>(
        "GetGroupMeeting",
        conversationId,
      )
      .then((meeting) => {
        if (cancelled) return;
        setGroupMeetings((current) => ({
          ...current,
          [conversationId]: meeting,
        }));
      })
      .catch(() => {
        // The next real-time meeting event will refresh this state.
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeConversation?.id,
    hubConnection,
    status,
  ]);

  useEffect(() => {
    if (!meetingInviteId) return;
    setMeetingInviteMicEnabled(true);
    setMeetingInviteCameraEnabled(false);
  }, [meetingInviteId]);

  useEffect(
    () => () => {
      if (liveLocationWatchRef.current) {
        navigator.geolocation.clearWatch(
          liveLocationWatchRef.current.watchId,
        );
        liveLocationWatchRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!conversationDialog || conversationDialog === "live-stream") return;

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
    if (pendingMessageJumpRef.current?.conversationId !== activeId) {
      pendingMessageJumpRef.current = null;
    }
    const jump = pendingMessageJumpRef.current;
    const abortController = new AbortController();
    setIsLoadingMessages(true);
    if (!jump) {
      setConversations((current) =>
        current.map((item) =>
          item.id === activeId ? { ...item, unreadCount: 0 } : item,
        ),
      );
    }

    fetch(
      `${API_URL}/api/conversations/${activeId}/messages?username=${encodeURIComponent(user.username)}${jump ? `&aroundMessageId=${encodeURIComponent(jump.messageId)}` : ""}`,
      { signal: abortController.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as Message[];
      })
      .then((messages) => {
        if (abortController.signal.aborted) return;
        if (jump) jump.ready = true;
        setHistoricalConversationId(jump ? activeId : null);
        setMessagesByConversation((current) => ({
          ...current,
          [activeId]: messages,
        }));
        const lastMessage = messages.at(-1);
        if (!jump &&
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
        if (abortController.signal.aborted) return;
        if (jump) pendingMessageJumpRef.current = null;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load messages.",
        );
      })
      .finally(() => {
        if (!abortController.signal.aborted) setIsLoadingMessages(false);
      });
    return () => abortController.abort();
  }, [activeId, user.username, messageJumpVersion]);

  useEffect(() => {
    if (!activeId) return;
    const conversationId = activeId;
    const abortController = new AbortController();
    fetch(
      `${API_URL}/api/conversations/${conversationId}/pinned-messages?username=${encodeURIComponent(user.username)}`,
      { signal: abortController.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as PinnedMessage[];
      })
      .then((pins) => {
        if (!abortController.signal.aborted) {
          setPinnedMessagesByConversation((current) => ({
            ...current,
            [conversationId]: pins,
          }));
        }
      })
      .catch((requestError) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load pinned messages.",
        );
      });
    return () => abortController.abort();
  }, [activeId, user.username]);

  useEffect(() => {
    if (!activeId) return;
    if (
      conversationTab !== "recordings" &&
      loadedRecordingConversationIdsRef.current.has(activeId)
    ) {
      return;
    }
    const conversationId = activeId;
    const abortController = new AbortController();
    setLoadingRecordingsConversationId(conversationId);

    fetch(
      `${API_URL}/api/recordings/conversation/${conversationId}?username=${encodeURIComponent(user.username)}`,
      { signal: abortController.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as SessionRecording[];
      })
      .then((recordings) => {
        loadedRecordingConversationIdsRef.current.add(conversationId);
        setRecordingsByConversation((current) => ({
          ...current,
          [conversationId]: recordings,
        }));
      })
      .catch((requestError) => {
        if (abortController.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load recordings.",
        );
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setLoadingRecordingsConversationId((current) =>
            current === conversationId ? null : current,
          );
        }
      });

    return () => abortController.abort();
  }, [activeId, conversationTab, user.username]);

  useEffect(() => {
    setAttachmentFiles([]);
    setReplyingToMessageId(null);
    setConversationTab("chat");
    setSelectedLocationIds([]);
    setMaximizedLocation(null);
    setLiveDirectionsMessageId(null);
    setRecordingToDelete(null);
  }, [activeId]);

  useEffect(() => {
    if (!maximizedLocation) return;
    const restoreOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMaximizedLocation(null);
    };
    window.addEventListener("keydown", restoreOnEscape);
    return () => window.removeEventListener("keydown", restoreOnEscape);
  }, [maximizedLocation]);

  useEffect(() => {
    if (conversationTab !== "locations") {
      setMaximizedLocation(null);
      setLiveDirectionsMessageId(null);
    }
  }, [conversationTab]);

  useEffect(() => {
    setSelectedLocationIds((current) =>
      current.filter((messageId) =>
        activeLocationItems.some((item) => item.messageId === messageId),
      ),
    );
    setMaximizedLocation((current) =>
      current &&
      activeLocationItems.some((item) => item.messageId === current.messageId)
        ? current
        : null,
    );
    setLiveDirectionsMessageId((current) =>
      current &&
      activeLocationItems.some(
        (item) => item.messageId === current && !item.liveLocation,
      )
        ? current
        : null,
    );
  }, [activeLocationItems]);

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
    if (conversationTab === "chat" && pendingMessageJumpRef.current?.conversationId !== activeId && historicalConversationId !== activeId) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeMessages.length, activeId, conversationTab, historicalConversationId]);

  useEffect(() => {
    const jump = pendingMessageJumpRef.current;
    if (!jump?.ready || jump.conversationId !== activeId || isLoadingMessages || conversationTab !== "chat") return;
    if (!activeMessages.some((message) => message.id === jump.messageId)) {
      pendingMessageJumpRef.current = null;
      setError("This message is no longer available.");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`message-${jump.messageId}`);
      element?.scrollIntoView({ behavior: "instant", block: "center" });
      element?.focus({ preventScroll: true });
      setHighlightedMessageId(jump.messageId);
      pendingMessageJumpRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, activeMessages, isLoadingMessages, conversationTab]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 3500);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId]);

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
    const mentionedUserIds = [...draftMentionUserIds].filter((memberId) => {
      const member = activeMembers.find((item) => item.id === memberId);
      return member ? hasExactMention(content, member.username) : false;
    });
    const mentionEveryone = hasExactMention(content, "everyone");
    setDraft("");
    setMentionSearch(null);
    setDraftMentionUserIds(new Set());
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
        mentionedUserIds.forEach((memberId) =>
          formData.append("mentionedUserIds", memberId),
        );
        formData.append("mentionEveryone", String(mentionEveryone));
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
          mentionedUserIds,
          mentionEveryone,
        });
      }
    } catch (requestError) {
      setDraft(content);
      setDraftMentionUserIds(new Set(mentionedUserIds));
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

  async function createPoll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeId || isCreatingPoll) return;
    const question = pollQuestion.trim();
    const options = pollOptions
      .map((option) => option.text.trim())
      .filter(Boolean);
    if (question.length === 0 || options.length < 2) return;

    setIsCreatingPoll(true);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${activeId}/polls?username=${encodeURIComponent(user.username)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            options,
            isMultiple: pollMode === "multiple",
            expiresAt: pollExpiresAt
              ? new Date(pollExpiresAt).toISOString()
              : null,
            clientMessageId: crypto.randomUUID(),
          }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      receiveMessage((await response.json()) as Message);
      setIsPollDialogOpen(false);
      setPollQuestion("");
      setPollMode("single");
      setPollExpiresAt("");
      setPollOptions(createPollDraftOptions());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not create the poll.",
      );
    } finally {
      setIsCreatingPoll(false);
    }
  }

  async function voteInPoll(messageId: string, optionId: string, poll: ChatPoll) {
    if (pollVoteMessageId) return;
    setPollVoteMessageId(messageId);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/messages/${messageId}/poll-vote?username=${encodeURIComponent(user.username)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            optionIds: poll.isMultiple
              ? poll.options
                  .filter((option) =>
                    option.id === optionId ? !option.isSelected : option.isSelected,
                  )
                  .map((option) => option.id)
              : [optionId],
          }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not record your vote.",
      );
    } finally {
      setPollVoteMessageId(null);
    }
  }

  function movePollOption(optionId: string, targetIndex: number) {
    setPollOptions((current) => {
      const sourceIndex = current.findIndex((option) => option.id === optionId);
      if (sourceIndex < 0) return current;
      const boundedTarget = Math.max(0, Math.min(targetIndex, current.length - 1));
      if (sourceIndex === boundedTarget) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(boundedTarget, 0, moved);
      return next;
    });
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
      clientMessageId: crypto.randomUUID(),
      messageType: "location",
      locationLatitude: Number(location.latitude.toFixed(6)),
      locationLongitude: Number(location.longitude.toFixed(6)),
      replyToMessageId: replyingToMessageId,
    });
    setReplyingToMessageId(null);
  }

  async function startLiveLocation(durationMinutes: number) {
    const connection = connectionRef.current;
    if (
      !activeId ||
      !connection ||
      connection.state !== HubConnectionState.Connected
    ) {
      throw new Error(LIVE_CHAT_OFFLINE_ERROR);
    }
    if (liveLocationWatchRef.current) {
      throw new Error("Stop your current live location before starting another.");
    }

    setIsStartingLiveLocation(true);
    try {
      const position = await getCurrentPosition();
      const message = await connection.invoke<Message>("StartLiveLocation", {
        conversationId: activeId,
        clientMessageId: crypto.randomUUID(),
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6)),
        accuracyMeters: Number(position.coords.accuracy.toFixed(2)),
        durationMinutes,
        replyToMessageId: replyingToMessageId,
      });
      receiveMessage(message);
      setReplyingToMessageId(null);

      const watchId = navigator.geolocation.watchPosition(
        (nextPosition) => {
          const tracking = liveLocationWatchRef.current;
          if (!tracking || tracking.messageId !== message.id) return;
          const now = Date.now();
          if (now - tracking.lastSentAt < 10_000) return;
          tracking.lastSentAt = now;
          const activeConnection = connectionRef.current;
          if (activeConnection?.state !== HubConnectionState.Connected) return;
          void activeConnection
            .invoke("UpdateLiveLocation", {
              messageId: message.id,
              latitude: Number(nextPosition.coords.latitude.toFixed(6)),
              longitude: Number(nextPosition.coords.longitude.toFixed(6)),
              accuracyMeters: Number(nextPosition.coords.accuracy.toFixed(2)),
            })
            .catch((updateError) =>
              setError(
                updateError instanceof Error
                  ? updateError.message
                  : "Live location could not be updated.",
              ),
            );
        },
        (locationError) =>
          setError(
            locationError.code === locationError.PERMISSION_DENIED
              ? "Location permission was denied."
              : "Live location could not be updated.",
          ),
        {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 10_000,
        },
      );
      liveLocationWatchRef.current = {
        messageId: message.id,
        watchId,
        lastSentAt: Date.now(),
      };
    } finally {
      setIsStartingLiveLocation(false);
    }
  }

  async function stopLiveLocation(messageId: string) {
    const connection = connectionRef.current;
    if (!connection || connection.state !== HubConnectionState.Connected) {
      setError(LIVE_CHAT_OFFLINE_ERROR);
      return;
    }
    setStoppingLiveLocationId(messageId);
    try {
      await connection.invoke("StopLiveLocation", messageId);
      if (liveLocationWatchRef.current?.messageId === messageId) {
        navigator.geolocation.clearWatch(
          liveLocationWatchRef.current.watchId,
        );
        liveLocationWatchRef.current = null;
      }
    } catch (stopError) {
      setError(
        stopError instanceof Error
          ? stopError.message
          : "Live location could not be stopped.",
      );
    } finally {
      setStoppingLiveLocationId(null);
    }
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

  async function checkRecordingStatus(recordingId: string) {
    if (!activeId || checkingRecordingId) return;
    setCheckingRecordingId(recordingId);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/recordings/${recordingId}/check-status?username=${encodeURIComponent(user.username)}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await readError(response));
      const result = (await response.json()) as RecordingStatusCheck;
      setRecordingsByConversation((current) => ({
        ...current,
        [activeId]: (current[activeId] ?? []).map((recording) =>
          recording.id === result.recordingId
            ? {
                ...recording,
                status: result.status,
                providerStatus: result.providerStatus,
                providerStatusCheckedAt: result.checkedAt,
              }
            : recording,
        ),
      }));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not check the Azure recording status.",
      );
    } finally {
      setCheckingRecordingId(null);
    }
  }

  async function deleteIncompleteRecording() {
    if (!activeId || !recordingToDelete || deletingRecordingId) return;
    const recording = recordingToDelete;

    setDeletingRecordingId(recording.id);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/recordings/${recording.id}?username=${encodeURIComponent(user.username)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await readError(response));
      setRecordingsByConversation((current) => ({
        ...current,
        [activeId]: (current[activeId] ?? []).filter(
          (item) => item.id !== recording.id,
        ),
      }));
      setRecordingToDelete(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not delete the recording.",
      );
    } finally {
      setDeletingRecordingId(null);
    }
  }

  function handleDraftChange(value: string, cursor = value.length) {
    setDraft(value);
    setDraftMentionUserIds((current) => {
      const retained = [...current].filter((memberId) => {
        const member = activeMembers.find((item) => item.id === memberId);
        return member ? hasExactMention(value, member.username) : false;
      });
      return retained.length === current.size ? current : new Set(retained);
    });
    setMentionSearch(findMentionSearch(value, cursor));
    setActiveMentionIndex(0);
    const connection = connectionRef.current;
    if (!activeId || connection?.state !== HubConnectionState.Connected) return;

    void connection.invoke("SetTyping", activeId, value.trim().length > 0);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      void connection.invoke("SetTyping", activeId, false);
    }, 1200);
  }

  async function toggleMessagePin(messageId: string, isPinned: boolean) {
    if (pinActionMessageId) return;
    setPinActionMessageId(messageId);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/messages/${messageId}/pin?username=${encodeURIComponent(user.username)}`,
        { method: isPinned ? "DELETE" : "POST" },
      );
      if (!response.ok) throw new Error(await readError(response));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `Could not ${isPinned ? "unpin" : "pin"} the message.`,
      );
    } finally {
      setPinActionMessageId(null);
    }
  }

  function jumpToPinnedMessage(messageId: string) {
    if (!activeId) return;
    setConversationTab("chat");
    setIsPinnedMessagesOpen(false);
    const messageElement = document.getElementById(`message-${messageId}`);
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: "smooth", block: "center" });
      messageElement.focus({ preventScroll: true });
      setHighlightedMessageId(messageId);
      return;
    }

    pendingMessageJumpRef.current = {
      conversationId: activeId,
      messageId,
      ready: false,
    };
    setHighlightedMessageId(null);
    setMessageJumpVersion((current) => current + 1);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionSearch && mentionOptions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveMentionIndex((current) =>
          (current + direction + mentionOptions.length) %
          mentionOptions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectMention(
          mentionOptions[Math.min(activeMentionIndex, mentionOptions.length - 1)],
        );
        return;
      }
    }
    if (event.key === "Escape" && mentionSearch) {
      event.preventDefault();
      setMentionSearch(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function selectMention(option: MentionOption) {
    if (!mentionSearch) return;
    const username =
      option.kind === "everyone" ? "everyone" : option.member.username;
    const insertion = `@${username} `;
    const nextDraft =
      draft.slice(0, mentionSearch.start) +
      insertion +
      draft.slice(mentionSearch.end);
    if (nextDraft.length > 2000) return;

    const nextCursor = mentionSearch.start + insertion.length;
    if (option.kind === "member") {
      setDraftMentionUserIds((current) => new Set(current).add(option.member.id));
    }
    handleDraftChange(nextDraft, nextCursor);
    setMentionSearch(null);
    window.requestAnimationFrame(() => {
      draftInputRef.current?.focus();
      draftInputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
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
      setIsNotificationsOpen(false);
      setIsMeetingsOpen(false);
      setIsStorageManagementOpen(false);
      setIsTasksOpen(false);
      setIsNotesOpen(false);
      setIsRemindersOpen(false);
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
      setIsNotificationsOpen(false);
      setIsMeetingsOpen(false);
      setIsStorageManagementOpen(false);
      setIsTasksOpen(false);
      setIsNotesOpen(false);
      setIsRemindersOpen(false);
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

  function openConversationDialog(
    mode: "direct" | "group" | "live-stream" | "add-members",
  ) {
    setConversationDialog(mode);
    setDialogError("");
    setUserQuery("");
    setUserResults([]);
    setSelectedUsers([]);
  }

  async function openCalendarConversation(
    conversationId: string,
    action: "chat" | "join",
  ) {
    const connection = connectionRef.current;
    if (action === "join") {
      if (connection?.state !== HubConnectionState.Connected) {
        throw new Error("Connect to chat before joining the meeting.");
      }
      if (meetingAction !== null) {
        throw new Error("Finish the current meeting action first.");
      }
      if (directCall.call !== null) {
        throw new Error("End your current call before joining this meeting.");
      }
      if (joinedGroupMeeting && joinedGroupMeeting.conversationId !== conversationId) {
        throw new Error("Leave your current meeting before joining another one.");
      }
    }

    if (connection?.state === HubConnectionState.Connected) {
      try {
        await connection.invoke("JoinConversation", conversationId);
      } catch (error) {
        if (action === "join") throw error;
      }
    }

    if (action === "join" && connection) {
      setMeetingAction("join");
      try {
        let joined: GroupMeeting | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const existing = await connection.invoke<GroupMeeting | null>(
            "GetGroupMeeting",
            conversationId,
          );
          try {
            joined = await connection.invoke<GroupMeeting>(
              existing ? "JoinGroupMeeting" : "StartGroupMeeting",
              conversationId,
            );
            if (!joined.participants.some((participant) => participant.userId === user.id)) {
              joined = await connection.invoke<GroupMeeting>(
                "JoinGroupMeeting",
                conversationId,
              );
            }
            break;
          } catch (error) {
            if (attempt > 0 || await connection.invoke<GroupMeeting | null>(
              "GetGroupMeeting",
              conversationId,
            )) {
              throw error;
            }
          }
        }
        if (!joined) throw new Error("Could not start or join the meeting.");
        setGroupMeetings((current) => ({ ...current, [conversationId]: joined }));
      } finally {
        setMeetingAction(null);
      }
    }

    try {
      await loadConversations();
    } catch (error) {
      if (action === "chat") throw error;
      setError("The meeting is open, but chats could not be refreshed.");
    }
    setActiveId(conversationId);
    setConversationTab("chat");
    setIsNotificationsOpen(false);
    setIsCalendarOpen(false);
    setIsMeetingsOpen(false);
    setIsStorageManagementOpen(false);
    setIsTasksOpen(false);
    setIsNotesOpen(false);
    setIsRemindersOpen(false);
    setIsSidebarOpen(false);
  }

  async function openNotification(notification: UserNotification) {
    const request = Date.now();
    const showDestination = () => {
      setIsNotificationsOpen(false);
      setIsCalendarOpen(false);
      setIsMeetingsOpen(false);
      setIsDocumentsOpen(false);
      setIsStorageManagementOpen(false);
      setIsTasksOpen(false);
      setIsNotesOpen(false);
      setIsRemindersOpen(false);
    };

    if (notification.type === "message_reaction" || notification.type === "message_mention" || notification.type === "message_reply" || notification.type === "recording_ready") {
      if (!notification.contextId) throw new Error("This notification does not have a conversation destination.");
      const items = await loadConversations();
      if (!items.some((item) => item.id === notification.contextId))
        throw new Error("This conversation is no longer available.");
      showDestination();
      pendingMessageJumpRef.current = {
        conversationId: notification.contextId,
        messageId: notification.targetId,
        ready: false,
      };
      setHighlightedMessageId(null);
      setMessageJumpVersion((current) => current + 1);
      setActiveId(notification.contextId);
      setConversationTab("chat");
      setIsSidebarOpen(false);
      return;
    }

    showDestination();

    if (notification.type.startsWith("meeting_")) {
      setNotificationMeetingTarget({ id: notification.targetId, request });
      setIsMeetingsOpen(true);
      return;
    }
    if (notification.type === "note_share") {
      setNotificationNoteTarget({ id: notification.targetId, request });
      setIsNotesOpen(true);
      return;
    }
    if (notification.type === "task_share" || notification.type === "task_assignment") {
      setNotificationTaskTarget({ id: notification.targetId, request });
      setIsTasksOpen(true);
      return;
    }
    if (notification.type === "document_file_share" || notification.type === "document_folder_share") {
      setNotificationDocumentTarget({
        id: notification.targetId,
        kind: notification.type === "document_file_share" ? "file" : "folder",
        request,
      });
      setIsDocumentsOpen(true);
      return;
    }
  }

  async function changeGroupMeeting(
    action: "start" | "join" | "leave" | "stop",
    conversationId = activeConversation?.id,
  ) {
    const conversation = conversations.find(
      (item) => item.id === conversationId,
    );
    if (
      !conversationId ||
      !conversation ||
      meetingAction ||
      ((action === "start" || action === "join") &&
        (directCall.call !== null ||
          (joinedGroupMeeting !== null &&
            joinedGroupMeeting.conversationId !== conversationId))) ||
      hubConnection?.state !== HubConnectionState.Connected
    ) {
      return;
    }

    const method = {
      start: "StartGroupMeeting",
      join: "JoinGroupMeeting",
      leave: "LeaveGroupMeeting",
      stop: "StopGroupMeeting",
    }[action];
    setMeetingAction(action);
    try {
      if (action === "stop") {
        await hubConnection.invoke(method, conversationId);
        setGroupMeetings((current) => ({
          ...current,
          [conversationId]: null,
        }));
      } else {
        const meeting = await hubConnection.invoke<GroupMeeting | null>(
          method,
          conversationId,
        );
        setGroupMeetings((current) => ({
          ...current,
          [conversationId]: meeting,
        }));
      }
    } catch (meetingError) {
      setError(
        meetingError instanceof Error
          ? meetingError.message
          : "The meeting action could not be completed.",
      );
    } finally {
      setMeetingAction(null);
    }
  }

  async function joinMeetingInvite() {
    if (!meetingInvite) return;
    dismissedMeetingInvitesRef.current.add(meetingInvite.meetingId);
    setMeetingMediaPreferences((current) => ({
      ...current,
      [meetingInvite.meetingId]: {
        microphoneEnabled: meetingInviteMicEnabled,
        cameraEnabled: meetingInviteCameraEnabled,
      },
    }));
    const conversationId = meetingInvite.conversationId;
    setMeetingInvite(null);
    await changeGroupMeeting("join", conversationId);
  }

  function dismissMeetingInvite() {
    if (!meetingInvite) return;
    dismissedMeetingInvitesRef.current.add(meetingInvite.meetingId);
    setMeetingInvite(null);
  }

  async function createLiveStream(event: FormEvent) {
    event.preventDefault();
    const title = newGroupTitle.trim();
    if (title.length < 2) return;

    setIsSavingMembers(true);
    setDialogError("");
    try {
      const response = await fetch(
        `${API_URL}/api/live-streams?username=${encodeURIComponent(user.username)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      const created = (await response.json()) as { conversationId: string };
      await loadConversations();
      setActiveId(created.conversationId);
      setIsStorageManagementOpen(false);
      setIsTasksOpen(false);
      setIsNotesOpen(false);
      setIsRemindersOpen(false);
      setConversationTab("chat");
      setConversationDialog(null);
      setNewGroupTitle("");
      setIsSidebarOpen(false);
      await connectionRef.current?.invoke(
        "JoinConversation",
        created.conversationId,
      );
    } catch (requestError) {
      setDialogError(
        requestError instanceof Error
          ? requestError.message
          : "Could not create the live stream.",
      );
    } finally {
      setIsSavingMembers(false);
    }
  }

  function renderMeetingControls() {
    if (!activeConversation) return null;

    if (!activeGroupMeeting) {
      return (
        <button
          className="icon-button header-group-action group-meeting-action start-meeting-action"
          type="button"
          disabled={
            status !== "connected" ||
            meetingAction !== null ||
            directCall.call !== null ||
            (activeConversation.type === "direct" &&
              isDirectParticipantBlocked) ||
            joinedGroupMeeting !== null
          }
          aria-label="Start meeting"
          title="Start meeting"
          onClick={() => void changeGroupMeeting("start")}
        >
          {meetingAction === "start" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Video size={15} />
          )}
          <span>Start meeting</span>
        </button>
      );
    }

    return (
      <>
        <span
          className="group-meeting-status"
          title={`Started by ${activeGroupMeeting.startedByDisplayName}`}
        >
          <Video size={14} />
          {activeGroupMeeting.participants.length} in meeting
        </span>
        {!isInActiveGroupMeeting && (
          <button
            className="icon-button header-group-action group-meeting-action"
            type="button"
            disabled={
              status !== "connected" ||
              meetingAction !== null ||
              directCall.call !== null ||
              (activeConversation.type === "direct" &&
                isDirectParticipantBlocked) ||
              (joinedGroupMeeting !== null &&
                joinedGroupMeeting.meetingId !== activeGroupMeeting.meetingId)
            }
            aria-label="Join meeting"
            title="Join meeting"
            onClick={() => void changeGroupMeeting("join")}
          >
            {meetingAction === "join" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Video size={15} />
            )}
            <span>Join</span>
          </button>
        )}
        {isInActiveGroupMeeting && (
          <button
            className="icon-button header-group-action group-meeting-action"
            type="button"
            disabled={status !== "connected" || meetingAction !== null}
            aria-label="Leave meeting"
            title="Leave meeting"
            onClick={() => void changeGroupMeeting("leave")}
          >
            {meetingAction === "leave" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <PhoneOff size={15} />
            )}
            <span>Leave</span>
          </button>
        )}
        {isActiveGroupMeetingStarter && (
          <button
            className="icon-button header-group-action group-meeting-action stop-meeting-action"
            type="button"
            disabled={status !== "connected" || meetingAction !== null}
            aria-label="Stop meeting"
            title="Stop meeting for everyone"
            onClick={() => void changeGroupMeeting("stop")}
          >
            {meetingAction === "stop" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Square size={14} />
            )}
            <span>Stop</span>
          </button>
        )}
      </>
    );
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
  const isChatOpen =
    !isCalendarOpen &&
    !isMeetingsOpen &&
    !isDocumentsOpen &&
    !isStorageManagementOpen &&
    !isTasksOpen &&
    !isNotesOpen &&
    !isRemindersOpen &&
    !isNotificationsOpen;

  return (
    <main className={`chat-shell ${isChatOpen ? "chat-open" : "section-open"} ${isCalendarOpen ? "calendar-open" : ""} ${isMeetingsOpen ? "meetings-open" : ""} ${isDocumentsOpen ? "documents-open" : ""} ${isStorageManagementOpen ? "storage-management-open" : ""} ${isTasksOpen ? "tasks-open" : ""} ${isNotesOpen ? "notes-open" : ""} ${isRemindersOpen ? "reminders-open" : ""} ${isNotificationsOpen ? "notifications-open" : ""}`}>
      <button
        className={`mobile-scrim ${isSidebarOpen ? "visible" : ""}`}
        aria-label="Close conversation menu"
        onClick={() => setIsSidebarOpen(false)}
      />
      <header className="layout-header">
        <div className="layout-brand brand">
          <span className="brand-mark">
            <MessageCircleMore size={20} strokeWidth={2.5} />
          </span>
          <span>Huddle</span>
        </div>
        <div className="layout-header-actions">
          {themeControl}
          <div className="layout-user">
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
          {isSidebarOpen && <button
            className="icon-button mobile-close"
            aria-label="Close menu"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={20} />
          </button>}
        </div>
      </header>
      <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <nav className="sidebar-rail" aria-label="Main sections">
          <button
            className={`sidebar-rail-button ${isNotificationsOpen ? "active" : ""}`}
            type="button"
            aria-label={
              notificationUnreadCount
                ? `Notifications, ${notificationUnreadCount} unread`
                : "Notifications"
            }
            title={
              notificationUnreadCount
                ? `Notifications (${notificationUnreadCount} unread)`
                : "Notifications"
            }
            aria-current={isNotificationsOpen ? "page" : undefined}
            onClick={() => {
              setIsNotificationsOpen(true);
              setIsCalendarOpen(false);
              setIsMeetingsOpen(false);
              setIsDocumentsOpen(false);
              setIsStorageManagementOpen(false);
              setIsTasksOpen(false);
              setIsNotesOpen(false);
              setIsRemindersOpen(false);
              setIsSidebarOpen(false);
            }}
          >
            <Bell size={21} />
            {notificationUnreadCount !== null &&
              notificationUnreadCount > 0 && (
                <span className="sidebar-rail-unread-badge" aria-hidden="true">
                  {notificationUnreadCount > 99
                    ? "99+"
                    : notificationUnreadCount}
                </span>
              )}
          </button>
          <button
            className={`sidebar-rail-button ${isChatOpen ? "active" : ""}`}
            type="button"
            aria-label="Chat"
            title="Chat"
            aria-current={isChatOpen ? "page" : undefined}
            onClick={() => {
              setIsCalendarOpen(false);
              setIsMeetingsOpen(false);
              setIsDocumentsOpen(false);
              setIsStorageManagementOpen(false);
              setIsTasksOpen(false);
              setIsNotesOpen(false);
              setIsRemindersOpen(false);
              setIsNotificationsOpen(false);
              setIsSidebarOpen(false);
            }}
          ><MessageCircleMore size={21} /></button>
          <button
            className={`sidebar-rail-button ${isMeetingsOpen ? "active" : ""}`}
            type="button"
            aria-label="Meetings"
            title="Meetings"
            aria-current={isMeetingsOpen ? "page" : undefined}
            onClick={() => {
              setIsMeetingsOpen(true);
              setIsNotificationsOpen(false);
              setIsCalendarOpen(false);
              setIsDocumentsOpen(false);
              setIsStorageManagementOpen(false);
              setIsTasksOpen(false);
              setIsNotesOpen(false);
              setIsRemindersOpen(false);
              setIsSidebarOpen(false);
            }}
          ><CalendarCheck2 size={21} /></button>
          <button
            className={`sidebar-rail-button ${isCalendarOpen ? "active" : ""}`}
            type="button"
            aria-label="Calendar"
            title="Calendar"
            aria-current={isCalendarOpen ? "page" : undefined}
            onClick={() => {
              setIsCalendarOpen(true);
              setIsNotificationsOpen(false);
              setIsMeetingsOpen(false);
              setIsDocumentsOpen(false);
              setIsStorageManagementOpen(false);
              setIsTasksOpen(false);
              setIsNotesOpen(false);
              setIsRemindersOpen(false);
              setIsSidebarOpen(false);
            }}
          ><CalendarDays size={21} /></button>
          <button
            className={`sidebar-rail-button ${isDocumentsOpen ? "active" : ""}`}
            type="button"
            aria-label="My Documents"
            title="My Documents"
            aria-current={isDocumentsOpen ? "page" : undefined}
            onClick={() => {
              setIsDocumentsOpen(true);
              setIsNotificationsOpen(false);
              setIsCalendarOpen(false);
              setIsMeetingsOpen(false);
              setIsStorageManagementOpen(false);
              setIsTasksOpen(false);
              setIsNotesOpen(false);
              setIsRemindersOpen(false);
              setIsSidebarOpen(false);
            }}
          ><FolderOpen size={21} /></button>
          <button
            className={`sidebar-rail-button ${isTasksOpen ? "active" : ""}`}
            type="button"
            aria-label="Tasks"
            title="Tasks"
            aria-current={isTasksOpen ? "page" : undefined}
            onClick={() => {
              setIsTasksOpen(true);
              setIsNotificationsOpen(false);
              setIsCalendarOpen(false);
              setIsMeetingsOpen(false);
              setIsDocumentsOpen(false);
              setIsStorageManagementOpen(false);
              setIsNotesOpen(false);
              setIsRemindersOpen(false);
              setIsSidebarOpen(false);
            }}
          ><ClipboardList size={21} /></button>
          <button
            className={`sidebar-rail-button ${isRemindersOpen ? "active" : ""}`}
            type="button"
            aria-label="Reminders"
            title="Reminders"
            aria-current={isRemindersOpen ? "page" : undefined}
            onClick={() => {
              setIsRemindersOpen(true);
              setIsNotificationsOpen(false);
              setIsCalendarOpen(false);
              setIsMeetingsOpen(false);
              setIsDocumentsOpen(false);
              setIsStorageManagementOpen(false);
              setIsTasksOpen(false);
              setIsNotesOpen(false);
              setIsSidebarOpen(false);
            }}
          ><AlarmClock size={21} /></button>
          <button
            className={`sidebar-rail-button ${isNotesOpen ? "active" : ""}`}
            type="button"
            aria-label="Notes"
            title="Notes"
            aria-current={isNotesOpen ? "page" : undefined}
            onClick={() => {
              setIsNotesOpen(true);
              setIsNotificationsOpen(false);
              setIsCalendarOpen(false);
              setIsMeetingsOpen(false);
              setIsDocumentsOpen(false);
              setIsTasksOpen(false);
              setIsStorageManagementOpen(false);
              setIsRemindersOpen(false);
              setIsSidebarOpen(false);
            }}
          ><NotebookPen size={21} /></button>
          <button
            className={`sidebar-rail-button ${isStorageManagementOpen ? "active" : ""}`}
            type="button"
            aria-label="Storage management"
            title="Storage management"
            aria-current={isStorageManagementOpen ? "page" : undefined}
            onClick={() => {
              setIsStorageManagementOpen(true);
              setIsNotificationsOpen(false);
              setIsCalendarOpen(false);
              setIsMeetingsOpen(false);
              setIsDocumentsOpen(false);
              setIsTasksOpen(false);
              setIsNotesOpen(false);
              setIsRemindersOpen(false);
              setIsSidebarOpen(false);
            }}
          ><HardDrive size={21} /></button>
        </nav>

      </aside>

      {isChatOpen && <aside className={`conversations-panel ${isSidebarOpen ? "open" : ""}`} aria-label="Chat navigation">
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
            <button
              className="live-streams-nav-button"
              type="button"
              onClick={() => setIsLiveStreamsOpen(true)}
            >
              <span className="channel-icon live-streams-nav-icon"><Radio size={17} /></span>
              <span className="conversation-copy">
                <strong>Live streams</strong>
                <small>Browse broadcasts</small>
              </span>
            </button>
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
                    setIsNotificationsOpen(false);
                    setIsCalendarOpen(false);
                    setIsMeetingsOpen(false);
                    setIsDocumentsOpen(false);
                    setIsStorageManagementOpen(false);
                    setIsTasksOpen(false);
                    setIsNotesOpen(false);
                    setIsRemindersOpen(false);
                    setIsSidebarOpen(false);
                  }}
                >
                  <span
                    className={`channel-icon ${
                      conversation.type === "direct" ? "direct-icon" : ""
                    } ${
                      conversation.type === "live_stream"
                        ? "live-stream-conversation-icon"
                        : ""
                    } ${
                      activeLiveStreamIds.has(conversation.id)
                        ? "is-live"
                        : ""
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
                    ) : conversation.type === "live_stream" ? (
                      <Radio size={17} />
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
                    {groupMeetings[conversation.id] && (
                      <span
                        className="active-conversation-call"
                        aria-label="Active meeting"
                        title="Active meeting"
                      >
                        <Video size={12} />
                      </span>
                    )}
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

      </aside>}

      <CalendarView
        apiUrl={API_URL}
        currentUsername={user.username}
        onBack={() => setIsCalendarOpen(false)}
        onOpenConversation={openCalendarConversation}
        onOpenTasks={() => { setIsCalendarOpen(false); setIsNotesOpen(false); setIsRemindersOpen(false); setIsTasksOpen(true); }}
        onOpenReminders={() => { setIsCalendarOpen(false); setIsTasksOpen(false); setIsNotesOpen(false); setIsRemindersOpen(true); }}
        hidden={!isCalendarOpen}
      />
      <MeetingsView
        apiUrl={API_URL}
        currentUsername={user.username}
        onBack={() => setIsMeetingsOpen(false)}
        onOpenConversation={openCalendarConversation}
        openTarget={notificationMeetingTarget}
        hidden={!isMeetingsOpen}
      />
      <DocumentsView
        apiUrl={API_URL}
        currentUsername={user.username}
        onBack={() => setIsDocumentsOpen(false)}
        onOpenConversation={async (conversationId, messageId) => {
          const items = await loadConversations();
          if (!items.some((item) => item.id === conversationId)) {
            throw new Error("This conversation is no longer available.");
          }
          pendingMessageJumpRef.current = { conversationId, messageId, ready: false };
          setHighlightedMessageId(null);
          setMessageJumpVersion((current) => current + 1);
          setActiveId(conversationId);
          setConversationTab("chat");
          setIsDocumentsOpen(false);
          setIsCalendarOpen(false);
          setIsMeetingsOpen(false);
          setIsStorageManagementOpen(false);
          setIsTasksOpen(false);
          setIsNotesOpen(false);
          setIsRemindersOpen(false);
          setIsSidebarOpen(false);
        }}
        openTarget={notificationDocumentTarget}
        hidden={!isDocumentsOpen}
      />
      <StorageManagementView
        apiUrl={API_URL}
        currentUsername={user.username}
        onBack={() => setIsStorageManagementOpen(false)}
        hidden={!isStorageManagementOpen}
      />
      <TasksView
        apiUrl={API_URL}
        currentUsername={user.username}
        onBack={() => setIsTasksOpen(false)}
        openTarget={notificationTaskTarget}
        hidden={!isTasksOpen}
      />
      <NotesView
        apiUrl={API_URL}
        currentUsername={user.username}
        onBack={() => setIsNotesOpen(false)}
        openTarget={notificationNoteTarget}
        hidden={!isNotesOpen}
      />
      <RemindersView
        apiUrl={API_URL}
        currentUsername={user.username}
        onBack={() => setIsRemindersOpen(false)}
        hidden={!isRemindersOpen}
      />
      <NotificationsView
        apiUrl={API_URL}
        currentUsername={user.username}
        onBack={() => setIsNotificationsOpen(false)}
        onOpen={openNotification}
        onUnreadCountChange={setNotificationUnreadCount}
        hidden={!isNotificationsOpen}
      />

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
                {activeConversation?.type === "live_stream" ? (
                  <Radio size={19} />
                ) : (
                  <Hash size={19} />
                )}
              </span>
            )}
            <div>
              <h1>{conversationDisplayTitle(activeConversation, "Welcome")}</h1>
              <p>
                {activeConversation?.type === "direct"
                  ? "Direct conversation"
                  : activeConversation?.type === "live_stream"
                    ? "Live stream conversation"
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
              {renderMeetingControls()}
              <button
                className="icon-button header-group-action"
                type="button"
                aria-label="Show conversation join link"
                title="Join link"
                onClick={() => {
                  setIsJoinLinkCopied(false);
                  setSharedConversation(activeConversation);
                }}
              >
                <Link2 size={17} />
              </button>
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
              {renderMeetingControls()}
              {directParticipantProfile &&
                directParticipantProfile.id !== user.id && (
                  <>
                    <button
                      className="icon-button header-group-action"
                      type="button"
                      disabled={
                        status !== "connected" ||
                        isDirectParticipantBlocked ||
                        directCall.call !== null ||
                        activeGroupMeeting !== null ||
                        joinedGroupMeeting !== null
                      }
                      aria-label={`Start an audio call with ${directParticipantProfile.displayName}`}
                      title="Audio call"
                      onClick={() =>
                        void directCall.startCall(
                          activeConversation.id,
                          directParticipantProfile,
                          false,
                        )
                      }
                    >
                      <Phone size={16} />
                    </button>
                    <button
                      className="icon-button header-group-action"
                      type="button"
                      disabled={
                        status !== "connected" ||
                        isDirectParticipantBlocked ||
                        directCall.call !== null ||
                        activeGroupMeeting !== null ||
                        joinedGroupMeeting !== null
                      }
                      aria-label={`Start a video call with ${directParticipantProfile.displayName}`}
                      title="Video call"
                      onClick={() =>
                        void directCall.startCall(
                          activeConversation.id,
                          directParticipantProfile,
                          true,
                        )
                      }
                    >
                      <Video size={17} />
                    </button>
                  </>
                )}
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
          {activeConversation?.type === "live_stream" && (
            <div className="header-group-actions">
              <LiveStreamConversationControls
                apiUrl={API_URL}
                username={user.username}
                conversationId={activeConversation.id}
                connection={hubConnection}
                onOpenStage={setRequestedLiveStream}
                onError={setError}
              />
              <button
                className="icon-button header-group-action"
                type="button"
                aria-label="Show conversation join link"
                title="Join link"
                onClick={() => {
                  setIsJoinLinkCopied(false);
                  setSharedConversation(activeConversation);
                }}
              >
                <Link2 size={17} />
              </button>
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
            id="conversation-tab-polls"
            type="button"
            role="tab"
            aria-selected={conversationTab === "polls"}
            aria-controls="conversation-polls-panel"
            onClick={() => setConversationTab("polls")}
          >
            <BarChart3 size={16} />
            Polls
            {activePollItems.length > 0 && (
              <span>{activePollItems.length}</span>
            )}
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
          <button
            id="conversation-tab-locations"
            type="button"
            role="tab"
            aria-selected={conversationTab === "locations"}
            aria-controls="conversation-locations-panel"
            onClick={() => setConversationTab("locations")}
          >
            <MapPinned size={16} />
            Locations
            {activeLocationItems.length > 0 && (
              <span>{activeLocationItems.length}</span>
            )}
          </button>
          <button
            id="conversation-tab-recordings"
            type="button"
            role="tab"
            aria-selected={conversationTab === "recordings"}
            aria-controls="conversation-recordings-panel"
            onClick={() => setConversationTab("recordings")}
          >
            <CirclePlay size={16} />
            Recordings
            {activeRecordings.length > 0 && (
              <span>{activeRecordings.length}</span>
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
          {activePinnedMessages.length > 0 && (
            <div className="pinned-messages">
              <button
                className="pinned-messages-summary"
                type="button"
                aria-expanded={isPinnedMessagesOpen}
                aria-controls="pinned-message-list"
                onClick={() =>
                  setIsPinnedMessagesOpen((current) => !current)
                }
              >
                <Pin size={16} />
                <span>
                  <strong>
                    {activePinnedMessages.length}{" "}
                    {activePinnedMessages.length === 1
                      ? "pinned message"
                      : "pinned messages"}
                  </strong>
                  <small>
                    {pinnedMessagePreview(activePinnedMessages[0])}
                  </small>
                </span>
                <ChevronDown
                  className={isPinnedMessagesOpen ? "expanded" : ""}
                  size={16}
                />
              </button>
              {isPinnedMessagesOpen && (
                <div
                  className="pinned-message-list"
                  id="pinned-message-list"
                >
                  {activePinnedMessages.map((pin) => (
                    <div className="pinned-message-item" key={pin.messageId}>
                      <button
                        type="button"
                        onClick={() => jumpToPinnedMessage(pin.messageId)}
                      >
                        <strong>{pin.senderUsername ?? "System"}</strong>
                        <span>{pinnedMessagePreview(pin)}</span>
                        <small>
                          Pinned by {pin.pinnedByDisplayName}
                        </small>
                      </button>
                      <button
                        className="pinned-message-unpin"
                        type="button"
                        disabled={pinActionMessageId === pin.messageId}
                        aria-label={`Unpin message from ${pin.senderUsername ?? "System"}`}
                        title="Unpin"
                        onClick={() =>
                          void toggleMessagePin(pin.messageId, true)
                        }
                      >
                        {pinActionMessageId === pin.messageId ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <PinOff size={15} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {historicalConversationId === activeId && !isLoadingMessages && (
            <button className="message-back-to-latest" type="button" onClick={() => {
              pendingMessageJumpRef.current = null;
              setMessageJumpVersion((current) => current + 1);
            }}>Back to latest messages</button>
          )}
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
              const isPinned = activePinnedMessages.some(
                (pin) => pin.messageId === message.id,
              );
              const replyTarget = message.replyToMessageId
                ? activeMessages.find(
                    (candidate) => candidate.id === message.replyToMessageId,
                  )
                : undefined;
              const isRecordingAttachment =
                message.senderUserId === null &&
                message.messageType === "video" &&
                (message.attachments ?? []).some((attachment) =>
                  attachment.contentType.startsWith("video/"),
                );
              const isSystemMessage =
                message.messageType === "system" ||
                isRecordingAttachment;
              const hasSystemAttachments =
                isSystemMessage &&
                (message.attachments?.length ?? 0) > 0;

              return (
                <div key={message.id}>
                  {startsDay && (
                    <div className="date-divider">
                      <span>{dateLabel(message.createdAt)}</span>
                    </div>
                  )}
                  {isSystemMessage ? (
                    <article
                      id={`message-${message.id}`}
                      className={`system-message ${
                        hasSystemAttachments ? "has-attachments" : ""
                      } ${highlightedMessageId === message.id ? "message-jump-highlight" : ""}`}
                      tabIndex={-1}
                    >
                      <p>{message.content}</p>
                      {hasSystemAttachments ? (
                        <MessageAttachmentList
                          attachments={message.attachments ?? []}
                          getUrl={attachmentUrl}
                        />
                      ) : null}
                      <time dateTime={message.createdAt}>
                        {formatTime(message.createdAt)}
                      </time>
                    </article>
                  ) : (
                    <article
                      id={`message-${message.id}`}
                      className={`message ${
                        startsGroup ? "group-start" : "compact"
                      } ${isOwnMessage ? "own-message" : ""} ${highlightedMessageId === message.id ? "message-jump-highlight" : ""}`}
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
                            ) : message.messageType === "poll" && message.poll ? (
                              <MessagePollCard
                                poll={message.poll}
                                disabled={
                                  !isOnline || pollVoteMessageId === message.id
                                }
                                onVote={(optionId) =>
                                  void voteInPoll(message.id, optionId, message.poll!)
                                }
                              />
                            ) : message.messageType === "live_location" ? (
                              message.liveLocation ? (
                                <LiveLocationMessageMap
                                  location={message.liveLocation}
                                  isOwn={isOwnMessage}
                                  isStopping={
                                    stoppingLiveLocationId === message.id
                                  }
                                  onStop={() =>
                                    void stopLiveLocation(message.id)
                                  }
                                  onError={setError}
                                />
                              ) : (
                                <p>Live location unavailable.</p>
                              )
                            ) : message.messageType === "location" ? (
                              <LocationMessageMap
                                latitude={message.locationLatitude}
                                longitude={message.locationLongitude}
                                onError={setError}
                              />
                            ) : (
                              message.content && (
                                <MessageContent
                                  content={message.content}
                                  members={activeMembers}
                                />
                              )
                            )}
                            {message.editedAt &&
                              editingMessageId !== message.id && (
                                <small className="message-edited">Edited</small>
                              )}
                            {isPinned && (
                              <small className="message-pinned-label">
                                <Pin size={11} /> Pinned
                              </small>
                            )}
                            <MessageActions
                              isOwn={isOwnMessage}
                              canEdit={
                                message.messageType !== "location" &&
                                message.messageType !== "poll" &&
                                Boolean(message.content)
                              }
                              canCopy={Boolean(
                                message.content ||
                                (message.attachments?.length ?? 0) > 0,
                              )}
                              isPinned={isPinned}
                              disabled={
                                !isOnline ||
                                editingMessageId === message.id ||
                                pinActionMessageId === message.id
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
                              onTogglePin={() =>
                                void toggleMessagePin(message.id, isPinned)
                              }
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

        {conversationTab === "polls" && (
          <div
            className="conversation-assets"
            id="conversation-polls-panel"
            role="tabpanel"
            aria-labelledby="conversation-tab-polls"
          >
            <div className="conversation-assets-heading">
              <div>
                <p className="eyebrow">Conversation polls</p>
                <h2>Polls in this conversation</h2>
              </div>
              <span>
                {activePollItems.length}{" "}
                {activePollItems.length === 1 ? "poll" : "polls"}
              </span>
            </div>
            {isLoadingMessages ? (
              <div className="center-state">
                <LoaderCircle className="spin" size={24} />
                <p>Loading polls...</p>
              </div>
            ) : activePollItems.length === 0 ? (
              <div className="empty-assets">
                <span>
                  <BarChart3 size={25} />
                </span>
                <h3>No polls yet</h3>
                <p>Polls created in the chat will appear here.</p>
              </div>
            ) : (
              <div className="conversation-poll-grid">
                {[...activePollItems].reverse().map((item) => (
                  <article className="conversation-poll-card" key={item.messageId}>
                    <div className="conversation-poll-meta">
                      <strong>{item.senderName}</strong>
                      <time dateTime={item.createdAt}>
                        {formatAttachmentDate(item.createdAt)}
                      </time>
                    </div>
                    <MessagePollCard
                      poll={item.poll}
                      disabled={!isOnline || pollVoteMessageId === item.messageId}
                      onVote={(optionId) =>
                        void voteInPoll(item.messageId, optionId, item.poll)
                      }
                    />
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

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
                            onLoadedMetadata={(event) =>
                              resolveUnknownVideoDuration(
                                event.currentTarget,
                                attachment.durationMs,
                              )
                            }
                          />
                        )}
                      </div>
                      <div className="conversation-media-meta">
                        <div>
                          <strong>{attachment.fileName}</strong>
                          {attachment.durationMs !== null ? (
                            <small>
                              Duration{" "}
                              {formatMediaDuration(attachment.durationMs)}
                            </small>
                          ) : null}
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

        {conversationTab === "locations" && (
          <div
            className="conversation-assets"
            id="conversation-locations-panel"
            role="tabpanel"
            aria-labelledby="conversation-tab-locations"
          >
            <div className="conversation-assets-heading">
              <div>
                <p className="eyebrow">Shared places</p>
                <h2>Locations in this conversation</h2>
              </div>
              <div className="conversation-location-heading-actions">
                <span>
                  {activeLocationItems.length}{" "}
                  {activeLocationItems.length === 1 ? "location" : "locations"}
                </span>
                <button
                  type="button"
                  disabled={selectedLocationItems.length !== 2}
                  onClick={() => {
                    const [origin, destination] = selectedLocationItems;
                    if (!origin || !destination) return;
                    openOpenStreetMapRoute(
                      origin.location.latitude,
                      origin.location.longitude,
                      destination.location.latitude,
                      destination.location.longitude,
                      setError,
                    );
                  }}
                >
                  <Navigation size={15} />
                  Directions ({selectedLocationItems.length}/2)
                </button>
              </div>
            </div>
            {isLoadingMessages ? (
              <div className="center-state">
                <LoaderCircle className="spin" size={24} />
                <p>Loading shared locations...</p>
              </div>
            ) : activeLocationItems.length === 0 ? (
              <div className="empty-assets">
                <span>
                  <MapPinned size={25} />
                </span>
                <h3>No locations shared yet</h3>
                <p>Locations shared in the chat will appear here.</p>
              </div>
            ) : (
              <div className="conversation-location-grid">
                {activeLocationItems.map(
                  ({
                    location,
                    liveLocation,
                    messageId,
                    senderName,
                    createdAt,
                  }) => {
                    const isSelected =
                      selectedLocationIds.includes(messageId);
                    const isSelectionDisabled =
                      !isSelected && selectedLocationIds.length >= 2;
                    const isMaximized =
                      maximizedLocation?.messageId === messageId;
                    const isShowingLiveDirections =
                      !liveLocation &&
                      liveDirectionsMessageId === messageId;
                    const card = (
                      <article
                        className={`conversation-location-card ${
                          isSelected ? "selected" : ""
                        } ${isMaximized ? "maximized" : ""}`.trim()}
                        key={messageId}
                      >
                        <label className="location-card-selector">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isSelectionDisabled}
                            aria-label={`Select location at ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`}
                            onChange={() =>
                              setSelectedLocationIds((current) =>
                                current.includes(messageId)
                                  ? current.filter((id) => id !== messageId)
                                  : current.length < 2
                                    ? [...current, messageId]
                                    : current,
                              )
                            }
                          />
                        </label>
                        {liveLocation ? (
                          <Suspense
                            fallback={
                              <div className="conversation-location-map map-loading" />
                            }
                          >
                            <LiveLocationMap
                              latitude={liveLocation.latitude}
                              longitude={liveLocation.longitude}
                              accuracyMeters={liveLocation.accuracyMeters}
                              followMarker
                              className="conversation-location-map"
                            />
                          </Suspense>
                        ) : isShowingLiveDirections ? (
                          <LiveDirectionsMap
                            destinationLatitude={location.latitude}
                            destinationLongitude={location.longitude}
                            onError={setError}
                          />
                        ) : (
                          <iframe
                            className="conversation-location-map"
                            src={location.previewUrl}
                            title={`Location shared by ${senderName}`}
                            loading="lazy"
                          />
                        )}
                        <div className="conversation-location-meta">
                          <span>
                            <strong>
                              {liveLocation
                                ? liveLocation.isActive
                                  ? "Live location"
                                  : "Live location ended"
                                : `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`}
                            </strong>
                            <small>
                              {senderName} /{" "}
                              {formatAttachmentDate(
                                liveLocation?.updatedAt ?? createdAt,
                              )}
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={
                              isMaximized
                                ? `Restore ${liveLocation ? "live location" : "location"} map`
                                : `Maximize ${liveLocation ? "live location" : "location"} map`
                            }
                            title={
                              isMaximized ? "Restore map" : "Maximize map"
                            }
                            aria-pressed={isMaximized}
                            onClick={(event) => {
                              if (isMaximized) {
                                setMaximizedLocation(null);
                                return;
                              }
                              const host =
                                event.currentTarget.closest<HTMLElement>(
                                  ".conversation-panel",
                                );
                              if (host) {
                                setMaximizedLocation({ messageId, host });
                              }
                            }}
                          >
                            {isMaximized ? (
                              <Minimize2 size={16} />
                            ) : (
                              <Maximize2 size={16} />
                            )}
                          </button>
                          {liveLocation ? (
                            <button
                              type="button"
                              aria-label="Get directions to live location"
                              title="Directions"
                              onClick={() =>
                                openOpenStreetMapDirections(
                                  location.latitude,
                                  location.longitude,
                                  setError,
                                )
                              }
                            >
                              <Navigation size={16} />
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                aria-label="View directions from your current location"
                                title="View directions"
                                onClick={() =>
                                  openOpenStreetMapDirections(
                                    location.latitude,
                                    location.longitude,
                                    setError,
                                  )
                                }
                              >
                                <Route size={16} />
                              </button>
                              <button
                                type="button"
                                aria-label={
                                  isShowingLiveDirections
                                    ? "Stop live directions"
                                    : "View live directions from your current location"
                                }
                                title={
                                  isShowingLiveDirections
                                    ? "Stop live directions"
                                    : "View live directions"
                                }
                                aria-pressed={isShowingLiveDirections}
                                onClick={() =>
                                  setLiveDirectionsMessageId((current) =>
                                    current === messageId ? null : messageId,
                                  )
                                }
                              >
                                <LocateFixed size={16} />
                              </button>
                            </>
                          )}
                          <a
                            href={location.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open location in OpenStreetMap"
                            title="Open location"
                          >
                            <ExternalLink size={16} />
                          </a>
                        </div>
                      </article>
                    );
                    return isMaximized && maximizedLocation
                      ? createPortal(card, maximizedLocation.host, messageId)
                      : card;
                  },
                )}
              </div>
            )}
          </div>
        )}

        {conversationTab === "recordings" && (
          <div
            className="conversation-assets"
            id="conversation-recordings-panel"
            role="tabpanel"
            aria-labelledby="conversation-tab-recordings"
          >
            <div className="conversation-assets-heading">
              <div>
                <p className="eyebrow">Saved recordings</p>
                <h2>Recordings in this conversation</h2>
              </div>
              <span>
                {activeRecordings.length}{" "}
                {activeRecordings.length === 1
                  ? "recording"
                  : "recordings"}
              </span>
            </div>
            {loadingRecordingsConversationId === activeId ? (
              <div className="center-state">
                <LoaderCircle className="spin" size={24} />
                <p>Loading recordings...</p>
              </div>
            ) : activeRecordings.length === 0 ? (
              <div className="empty-assets">
                <span>
                  <CirclePlay size={25} />
                </span>
                <h3>No recordings yet</h3>
                <p>
                  Call, meeting, and live-stream recording sessions will
                  appear here.
                </p>
              </div>
            ) : (
              <div className="conversation-media-grid">
                {activeRecordings.map((recording) => {
                  const attachment = recording.attachment;
                  const duration =
                    recording.durationMilliseconds ??
                    attachment?.durationMs ??
                    null;
                  const starterName =
                    recording.startedByUserId === user.id
                      ? "You"
                      : recording.startedByDisplayName;
                  const canDeleteRecording =
                    recording.startedByUserId === user.id ||
                    canManageGroupMembers;
                  return (
                    <article
                      className="conversation-media-card"
                      key={recording.id}
                    >
                      <div className="conversation-recording-preview video">
                        {attachment ? (
                          <video
                            controls
                            preload="metadata"
                            src={attachmentUrl(attachment.id)}
                            onLoadedMetadata={(event) =>
                              resolveUnknownVideoDuration(
                                event.currentTarget,
                                duration,
                              )
                            }
                          />
                        ) : (
                          <div className="conversation-recording-state">
                            {recording.status === "recording" ||
                            recording.status === "processing" ? (
                              <LoaderCircle className="spin" size={28} />
                            ) : (
                              <CirclePlay size={28} />
                            )}
                            <strong>
                              {recording.status.replaceAll("-", " ")}
                            </strong>
                          </div>
                        )}
                      </div>
                      <div className="conversation-media-meta">
                        <div>
                          <strong>
                            {recording.sessionType.replaceAll("_", " ")}{" "}
                            recording
                          </strong>
                          {duration !== null ? (
                            <small>
                              Duration {formatMediaDuration(duration)}
                            </small>
                          ) : null}
                          <small>
                            {starterName} ·{" "}
                            {formatAttachmentDate(recording.startedAt)}
                          </small>
                          {recording.providerStatus ? (
                            <small>
                              Azure: {recording.providerStatus}
                            </small>
                          ) : null}
                        </div>
                        <div className="conversation-recording-actions">
                          {recording.status !== "completed" ? (
                            <>
                              <button
                                type="button"
                                disabled={
                                  !recording.canCheckProviderStatus ||
                                  checkingRecordingId !== null ||
                                  deletingRecordingId !== null
                                }
                                title={
                                  recording.canCheckProviderStatus
                                    ? "Check status in Azure Communication Services"
                                    : "Azure status is unavailable until recording starts"
                                }
                                aria-label="Check recording status in Azure"
                                onClick={() =>
                                  void checkRecordingStatus(recording.id)
                                }
                              >
                                {checkingRecordingId === recording.id ? (
                                  <LoaderCircle className="spin" size={14} />
                                ) : (
                                  <RefreshCw size={16} />
                                )}
                              </button>
                              {canDeleteRecording ? (
                                <button
                                  className="delete-recording"
                                  type="button"
                                  disabled={
                                    checkingRecordingId !== null ||
                                    deletingRecordingId !== null
                                  }
                                  title="Delete incomplete recording"
                                  aria-label="Delete incomplete recording"
                                  onClick={() => setRecordingToDelete(recording)}
                                >
                                  {deletingRecordingId === recording.id ? (
                                    <LoaderCircle className="spin" size={14} />
                                  ) : (
                                    <Trash2 size={16} />
                                  )}
                                </button>
                              ) : null}
                            </>
                          ) : null}
                          {attachment ? (
                            <a
                              href={attachmentUrl(attachment.id, true)}
                              download={attachment.fileName}
                              aria-label={`Download ${attachment.fileName}`}
                              title="Download"
                            >
                              <Download size={16} />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
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
          <button
            className="poll-button"
            type="button"
            disabled={
              !activeConversation ||
              !isOnline ||
              isSendingMessage ||
              isActiveDirectMessagingBlocked
            }
            aria-label="Create a poll"
            title="Poll"
            onClick={() => {
              setPollQuestion("");
              setPollMode("single");
              setPollExpiresAt("");
              setPollOptions(createPollDraftOptions());
              setIsPollDialogOpen(true);
            }}
          >
            <BarChart3 size={17} />
          </button>
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
            aria-autocomplete="list"
            aria-controls={
              mentionOptions.length > 0
                ? "composer-mention-results"
                : undefined
            }
            aria-expanded={mentionOptions.length > 0}
            onChange={(event) =>
              handleDraftChange(
                event.target.value,
                event.target.selectionStart ?? event.target.value.length,
              )
            }
            onKeyDown={handleComposerKeyDown}
          />
          {mentionOptions.length > 0 && (
            <div
              className="composer-mentions"
              id="composer-mention-results"
              role="listbox"
              aria-label="Tag a person"
            >
              <div className="composer-mentions-heading">
                <AtSign size={14} />
                Tag people
              </div>
              {mentionOptions.map((option, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeMentionIndex}
                  className={index === activeMentionIndex ? "active" : ""}
                  key={
                    option.kind === "everyone"
                      ? "everyone"
                      : option.member.id
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMention(option)}
                >
                  <span className="composer-mention-avatar">
                    {option.kind === "everyone" ? (
                      <Users size={16} />
                    ) : (
                      <AvatarContent
                        avatarUrl={option.member.avatarUrl}
                        name={option.member.displayName}
                      />
                    )}
                  </span>
                  <span>
                    <strong>
                      {option.kind === "everyone"
                        ? "Everyone"
                        : option.member.displayName}
                    </strong>
                    <small>
                      @{option.kind === "everyone"
                        ? "everyone"
                        : option.member.username}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
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
          <LiveLocationShareButton
            disabled={
              !activeConversation ||
              !isOnline ||
              isSendingMessage ||
              isActiveDirectMessagingBlocked
            }
            isStarting={isStartingLiveLocation}
            onStart={startLiveLocation}
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
                      : conversationDialog === "live-stream"
                        ? "Create a live stream"
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
                <button
                  className={conversationDialog === "live-stream" ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={conversationDialog === "live-stream"}
                  onClick={() => openConversationDialog("live-stream")}
                >
                  <Radio size={16} />
                  Live stream
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
            ) : conversationDialog === "live-stream" ? (
              <form className="group-picker" onSubmit={createLiveStream}>
                <label htmlFor="live-stream-title">Live stream name</label>
                <input
                  id="live-stream-title"
                  autoFocus
                  maxLength={200}
                  placeholder="e.g. Weekly product update"
                  value={newGroupTitle}
                  onChange={(event) => setNewGroupTitle(event.target.value)}
                />
                <p className="picker-state">
                  Create it now, then start or stop broadcasts from its conversation.
                </p>
                <button
                  className="primary-button"
                  disabled={isSavingMembers || newGroupTitle.trim().length < 2}
                  type="submit"
                >
                  {isSavingMembers ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <><Radio size={17} /> Create live stream</>
                  )}
                </button>
              </form>
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

      {sharedConversation && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card join-link-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-link-dialog-title"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Invite people</p>
                <h2 id="join-link-dialog-title">Join this conversation</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => setSharedConversation(null)}
              >
                <X size={20} />
              </button>
            </div>

            <img
              className="join-link-qr-code"
              src={joinQrCodeUrl}
              alt={`QR code to join ${conversationDisplayTitle(sharedConversation, "conversation")}`}
            />

            <div className="join-link-field">
              <a href={joinConversationUrl} target="_blank" rel="noreferrer">
                {joinConversationUrl}
              </a>
              <button
                className="secondary-button"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(joinConversationUrl);
                    setIsJoinLinkCopied(true);
                  } catch {
                    setError("Could not copy the join link.");
                  }
                }}
              >
                {isJoinLinkCopied ? <Check size={16} /> : <Copy size={16} />}
                {isJoinLinkCopied ? "Copied" : "Copy link"}
              </button>
            </div>
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

      {isPollDialogOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal-card poll-dialog"
            aria-label="Create a poll"
            onSubmit={createPoll}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Conversation poll</p>
                <h2>Create a poll</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close poll creator"
                disabled={isCreatingPoll}
                onClick={() => setIsPollDialogOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <label htmlFor="poll-question">Question</label>
            <input
              id="poll-question"
              maxLength={300}
              autoFocus
              value={pollQuestion}
              onChange={(event) => setPollQuestion(event.target.value)}
              placeholder="What would you like to ask?"
            />
            <fieldset className="poll-mode-picker">
              <legend>Response type</legend>
              <label className={pollMode === "single" ? "selected" : ""}>
                <input
                  type="radio"
                  name="poll-mode"
                  value="single"
                  checked={pollMode === "single"}
                  onChange={() => setPollMode("single")}
                />
                <CircleDot size={17} />
                <span><strong>Single choice</strong><small>Choose one option</small></span>
              </label>
              <label className={pollMode === "multiple" ? "selected" : ""}>
                <input
                  type="radio"
                  name="poll-mode"
                  value="multiple"
                  checked={pollMode === "multiple"}
                  onChange={() => setPollMode("multiple")}
                />
                <ListChecks size={17} />
                <span><strong>Multiple choice</strong><small>Choose several options</small></span>
              </label>
            </fieldset>
            <label className="poll-expiration-field" htmlFor="poll-expires-at">
              <span>Expiration <small>Optional</small></span>
              <input
                id="poll-expires-at"
                type="datetime-local"
                value={pollExpiresAt}
                onChange={(event) => setPollExpiresAt(event.target.value)}
              />
            </label>
            <div className="poll-dialog-options-heading">
              <strong>Options</strong>
              <span>Drag to reorder · {pollOptions.length}/10</span>
            </div>
            <div className="poll-dialog-options">
              {pollOptions.map((option, index) => (
                <div
                  className={`poll-dialog-option ${
                    draggedPollOptionId === option.id ? "dragging" : ""
                  } ${
                    pollOptionDropTargetId === option.id ? "drop-target" : ""
                  }`}
                  key={option.id}
                  onDragOver={(event) => {
                    if (!draggedPollOptionId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (pollOptionDropTargetId !== option.id) {
                      setPollOptionDropTargetId(option.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedPollOptionId) {
                      movePollOption(draggedPollOptionId, index);
                    }
                    setDraggedPollOptionId(null);
                    setPollOptionDropTargetId(null);
                  }}
                >
                  <button
                    className="poll-option-drag-handle"
                    type="button"
                    draggable={!isCreatingPoll}
                    disabled={isCreatingPoll}
                    aria-label={`Reorder option ${index + 1}`}
                    title="Drag to reorder. Use arrow keys for keyboard reordering."
                    onDragStart={(event) => {
                      setDraggedPollOptionId(option.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", option.id);
                    }}
                    onDragEnd={() => {
                      setDraggedPollOptionId(null);
                      setPollOptionDropTargetId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                        return;
                      }
                      event.preventDefault();
                      movePollOption(
                        option.id,
                        index + (event.key === "ArrowUp" ? -1 : 1),
                      );
                    }}
                  >
                    <GripVertical size={16} />
                  </button>
                  <input
                    aria-label={`Option ${index + 1}`}
                    maxLength={200}
                    value={option.text}
                    onChange={(event) =>
                      setPollOptions((current) =>
                        current.map((item) =>
                          item.id === option.id
                            ? { ...item, text: event.target.value }
                            : item,
                        ),
                      )
                    }
                    placeholder={`Option ${index + 1}`}
                  />
                  <button
                    className="poll-option-remove"
                    type="button"
                    disabled={pollOptions.length <= 2}
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() =>
                      setPollOptions((current) =>
                        current.filter((item) => item.id !== option.id),
                      )
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
            {pollOptions.length < 10 && (
              <button
                className="poll-add-option"
                type="button"
                onClick={() =>
                  setPollOptions((current) => [
                    ...current,
                    { id: crypto.randomUUID(), text: "" },
                  ])
                }
              >
                <Plus size={15} /> Add option
              </button>
            )}
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isCreatingPoll}
                onClick={() => setIsPollDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={
                  isCreatingPoll ||
                  !pollQuestion.trim() ||
                  pollOptions.filter((option) => option.text.trim()).length < 2
                }
              >
                {isCreatingPoll ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <><BarChart3 size={16} /> Create poll</>
                )}
              </button>
            </div>
          </form>
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

      {recordingToDelete && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-recording-title"
            aria-describedby="delete-recording-description"
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Delete recording</p>
                <h2 id="delete-recording-title">
                  Delete this incomplete recording?
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                disabled={deletingRecordingId !== null}
                onClick={() => setRecordingToDelete(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p id="delete-recording-description">
              This removes the{" "}
              {recordingToDelete.sessionType.replaceAll("_", " ")} recording
              session. An active Azure recording will be stopped first. This
              action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                autoFocus
                disabled={deletingRecordingId !== null}
                onClick={() => setRecordingToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={deletingRecordingId !== null}
                onClick={() => void deleteIncompleteRecording()}
              >
                {deletingRecordingId ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  "Delete recording"
                )}
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
      {meetingInvite ? (
        <aside
          className="group-meeting-invite"
          role="dialog"
          aria-label={`Meeting invitation from ${meetingInvite.startedByDisplayName}`}
          aria-live="polite"
        >
          <div className="group-meeting-invite-heading">
            <div className="group-meeting-invite-icon">
              <Video size={18} />
            </div>
            <div>
              <strong>{meetingInvite.startedByDisplayName}</strong>
              <span>
                started a meeting in{" "}
                {meetingInviteConversation?.title ?? "this conversation"}
              </span>
            </div>
          </div>
          <p>
            {meetingInvite.participants.length} member
            {meetingInvite.participants.length === 1 ? "" : "s"} joined
          </p>
          <div className="group-meeting-invite-media">
            <button
              type="button"
              className={meetingInviteMicEnabled ? "" : "inactive"}
              aria-label={
                meetingInviteMicEnabled
                  ? "Join with microphone off"
                  : "Join with microphone on"
              }
              aria-pressed={!meetingInviteMicEnabled}
              onClick={() =>
                setMeetingInviteMicEnabled((current) => !current)
              }
            >
              {meetingInviteMicEnabled ? (
                <Mic size={18} />
              ) : (
                <MicOff size={18} />
              )}
              <span>
                Microphone {meetingInviteMicEnabled ? "on" : "off"}
              </span>
            </button>
            <button
              type="button"
              className={meetingInviteCameraEnabled ? "" : "inactive"}
              aria-label={
                meetingInviteCameraEnabled
                  ? "Join with camera off"
                  : "Join with camera on"
              }
              aria-pressed={!meetingInviteCameraEnabled}
              onClick={() =>
                setMeetingInviteCameraEnabled((current) => !current)
              }
            >
              {meetingInviteCameraEnabled ? (
                <Video size={18} />
              ) : (
                <VideoOff size={18} />
              )}
              <span>Camera {meetingInviteCameraEnabled ? "on" : "off"}</span>
            </button>
          </div>
          <div className="group-meeting-invite-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={dismissMeetingInvite}
            >
              Cancel
            </button>
            <button
              type="button"
              className="meeting-invite-join"
              disabled={
                status !== "connected" ||
                meetingAction !== null ||
                directCall.call !== null ||
                meetingInviteIsBlocked ||
                joinedGroupMeeting !== null
              }
              onClick={() => void joinMeetingInvite()}
            >
              {meetingAction === "join" ? "Joining..." : "Join meeting"}
            </button>
          </div>
        </aside>
      ) : null}
      {joinedGroupMeeting ? (
        <GroupMeetingOverlay
          connection={hubConnection}
          apiUrl={API_URL}
          username={user.username}
          currentUser={user}
          groupTitle={joinedGroupConversation?.title ?? "Meeting"}
          meeting={joinedGroupMeeting}
          onLeave={() =>
            void changeGroupMeeting(
              "leave",
              joinedGroupMeeting.conversationId,
            )
          }
          onStop={() =>
            void changeGroupMeeting(
              "stop",
              joinedGroupMeeting.conversationId,
            )
          }
          onError={setError}
          resolveAvatarUrl={avatarSource}
          initialMicrophoneEnabled={
            meetingMediaPreferences[joinedGroupMeeting.meetingId]
              ?.microphoneEnabled ?? true
          }
          initialCameraEnabled={
            meetingMediaPreferences[joinedGroupMeeting.meetingId]
              ?.cameraEnabled ?? false
          }
        />
      ) : null}
      <LiveStreams
        apiUrl={API_URL}
        username={user.username}
        displayName={user.displayName}
        connection={hubConnection}
        isOpen={isLiveStreamsOpen}
        onClose={() => setIsLiveStreamsOpen(false)}
        onError={setError}
        requestedStream={requestedLiveStream}
        onRequestedStreamOpened={() => setRequestedLiveStream(null)}
        onActiveStreamsChanged={handleActiveLiveStreamsChanged}
        onConversationSelected={async (conversationId) => {
          await loadConversations();
          setActiveId(conversationId);
          setIsNotificationsOpen(false);
          setConversationTab("chat");
          setIsCalendarOpen(false);
          setIsMeetingsOpen(false);
          setIsStorageManagementOpen(false);
          setIsTasksOpen(false);
          setIsNotesOpen(false);
          setIsRemindersOpen(false);
          setIsSidebarOpen(false);
        }}
      />
      <DirectCallOverlay {...directCall} />
    </main>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [themePreference, setThemePreference] = useState(getThemePreference);

  useEffect(() => {
    applyTheme(themePreference);
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      if (themePreference === "system") applyTheme("system");
    };
    colorScheme.addEventListener("change", syncSystemTheme);
    return () => colorScheme.removeEventListener("change", syncSystemTheme);
  }, [themePreference]);

  const themeControl = (
    <ThemeSwitcher
      preference={themePreference}
      onChange={(preference) => {
        setThemePreference(preference);
        saveThemePreference(preference);
      }}
    />
  );

  const publicToken = new URLSearchParams(window.location.search).get("publicDocument");
  if (publicToken) return <PublicDocumentsView apiUrl={API_URL} token={publicToken} />;

  return user ? (
    <ChatApp
      user={user}
      onLogout={() => setUser(null)}
      onUserUpdated={setUser}
      themeControl={themeControl}
    />
  ) : (
    <LoginScreen onLogin={setUser} themeControl={themeControl} />
  );
}

export default App;
