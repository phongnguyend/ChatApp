import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Square,
  Video,
  VideoOff,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HubConnectionState,
  type HubConnection,
} from "@microsoft/signalr";
import {
  CallRecordingControls,
  RecordingConsentDialog,
  useCallRecording,
} from "./useCallRecording";
import { useAzureCommunicationCall } from "./useAzureCommunicationCall";
import "./GroupMeeting.css";

export type GroupMeetingParticipant = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  isMuted: boolean;
};

export type GroupMeeting = {
  meetingId: string;
  conversationId: string;
  startedByUserId: string;
  startedByDisplayName: string;
  startedAt: string;
  screenSharingUserId: string | null;
  participants: GroupMeetingParticipant[];
};

type MeetingScreenShareTakenOverEvent = {
  meetingId: string;
  conversationId: string;
  newOwnerUserId: string;
};

type GroupMeetingOverlayProps = {
  connection: HubConnection | null;
  apiUrl: string;
  username: string;
  currentUser: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
  groupTitle: string;
  meeting: GroupMeeting;
  onLeave: () => void;
  onStop: () => void;
  onError: (message: string) => void;
  resolveAvatarUrl: (avatarUrl: string | null) => string | null;
  initialMicrophoneEnabled: boolean;
  initialCameraEnabled: boolean;
};

export function GroupMeetingOverlay({
  connection,
  apiUrl,
  username,
  currentUser,
  groupTitle,
  meeting,
  onLeave,
  onStop,
  onError,
  resolveAvatarUrl,
  initialMicrophoneEnabled,
  initialCameraEnabled,
}: GroupMeetingOverlayProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [isMuted, setIsMuted] = useState(!initialMicrophoneEnabled);
  const [isCameraEnabled, setIsCameraEnabled] = useState(
    initialCameraEnabled,
  );
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isStageMaximized, setIsStageMaximized] = useState(false);
  const [isScreenMaximized, setIsScreenMaximized] = useState(false);
  const meetingStageRef = useRef<HTMLElement | null>(null);
  const sharedScreenPanelRef = useRef<HTMLDivElement | null>(null);
  const sharedScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const stopScreenShareRef = useRef<(notifyServer?: boolean) => Promise<void>>(
    async () => {},
  );
  const meetingRef = useRef(meeting);
  const onLeaveRef = useRef(onLeave);

  useEffect(() => {
    meetingRef.current = meeting;
    onLeaveRef.current = onLeave;
  }, [meeting, onLeave]);

  const azureMedia = useAzureCommunicationCall({
    active: true,
    apiUrl,
    username,
    groupId: meeting.meetingId,
    userId: currentUser.id,
    displayName: currentUser.displayName,
    initialMicrophoneEnabled,
    initialCameraEnabled,
    onDisconnected: () => onLeaveRef.current(),
    onError,
  });

  useEffect(() => {
    setLocalStream(azureMedia.localStream);
    setRemoteStreams(azureMedia.remoteStreams);
    setIsMuted(azureMedia.isMuted);
    setIsCameraEnabled(azureMedia.isCameraEnabled);
    setScreenStream(azureMedia.screenStream);
    setIsScreenSharing(azureMedia.isScreenSharing);
  }, [
    azureMedia.isCameraEnabled,
    azureMedia.isMuted,
    azureMedia.isScreenSharing,
    azureMedia.localStream,
    azureMedia.remoteStreams,
    azureMedia.screenStream,
  ]);

  useEffect(() => {
    if (
      !azureMedia.call ||
      connection?.state !== HubConnectionState.Connected
    ) {
      return;
    }
    void connection
      .invoke("SetGroupMeetingMicrophoneState", {
        meetingId: meeting.meetingId,
        conversationId: meeting.conversationId,
        isMuted,
      })
      .catch(() => onError("Microphone status could not be updated."));
  }, [
    azureMedia.call,
    connection,
    isMuted,
    meeting.conversationId,
    meeting.meetingId,
    onError,
  ]);

  useEffect(() => {
    if (!connection) return;
    const onScreenShareTakenOver = (
      event: MeetingScreenShareTakenOverEvent,
    ) => {
      if (
        event.meetingId !== meetingRef.current.meetingId ||
        event.conversationId !== meetingRef.current.conversationId ||
        event.newOwnerUserId === currentUser.id
      ) {
        return;
      }
      void stopScreenShareRef.current(false);
    };
    connection.on(
      "GroupMeetingScreenShareTakenOver",
      onScreenShareTakenOver,
    );
    return () => connection.off(
      "GroupMeetingScreenShareTakenOver",
      onScreenShareTakenOver,
    );
  }, [connection, currentUser.id]);

  const toggleMute = () => {
    const nextMuted = !isMuted;
    if (azureMedia.call) {
      void azureMedia.toggleMute()
        .then(() => {
          if (connection?.state === HubConnectionState.Connected) {
            return connection.invoke("SetGroupMeetingMicrophoneState", {
              meetingId: meeting.meetingId,
              conversationId: meeting.conversationId,
              isMuted: nextMuted,
            });
          }
        })
        .catch(() => onError("Microphone status could not be updated."));
      return;
    }
  };

  const toggleCamera = async () => {
    if (azureMedia.call) {
      try {
        await azureMedia.toggleCamera();
      } catch (cameraError) {
        onError(cameraError instanceof Error ? cameraError.message : "The camera could not be updated.");
      }
      return;
    }
  };

  const stopScreenShare = useCallback(
    async (notifyServer = true) => {
      if (azureMedia.isScreenSharing) {
        try {
          await azureMedia.stopScreenShare();
          if (notifyServer && connection?.state === HubConnectionState.Connected) {
            await connection.invoke("StopGroupMeetingScreenShare", {
              meetingId: meeting.meetingId,
              conversationId: meeting.conversationId,
            });
          }
        } catch {
          onError("Screen sharing could not be stopped cleanly.");
        }
        return;
      }
    },
    [azureMedia, connection, meeting.conversationId, meeting.meetingId, onError],
  );

  useEffect(() => {
    stopScreenShareRef.current = stopScreenShare;
  }, [stopScreenShare]);

  const startScreenShare = async () => {
    if (azureMedia.call && !azureMedia.isScreenSharing) {
      let registered = false;
      try {
        if (connection?.state !== HubConnectionState.Connected) return;
        await connection.invoke("StartGroupMeetingScreenShare", {
          meetingId: meeting.meetingId,
          conversationId: meeting.conversationId,
        });
        registered = true;
        await azureMedia.startScreenShare();
      } catch (screenError) {
        if (registered && connection?.state === HubConnectionState.Connected) {
          void connection.invoke("StopGroupMeetingScreenShare", {
            meetingId: meeting.meetingId,
            conversationId: meeting.conversationId,
          });
        }
        if (!(screenError instanceof DOMException && ["AbortError", "NotAllowedError"].includes(screenError.name))) {
          onError(screenError instanceof Error ? screenError.message : "Screen sharing could not be started.");
        }
      }
      return;
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsStageMaximized(
        document.fullscreenElement === meetingStageRef.current,
      );
      setIsScreenMaximized(
        document.fullscreenElement === sharedScreenPanelRef.current,
      );
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleStageMaximize = async () => {
    const stage = meetingStageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await stage.requestFullscreen();
      }
    } catch {
      setIsStageMaximized(false);
    }
  };

  const toggleScreenMaximize = async () => {
    const panel = sharedScreenPanelRef.current;
    if (!panel) return;
    try {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await panel.requestFullscreen();
      }
    } catch {
      setIsScreenMaximized(false);
    }
  };

  const screenSharingParticipant = meeting.screenSharingUserId
    ? meeting.participants.find(
        (participant) =>
          participant.userId === meeting.screenSharingUserId,
      ) ?? null
    : null;
  const remoteSharingSource = screenSharingParticipant
    ? remoteStreams[screenSharingParticipant.userId] ?? null
    : null;
  const remoteScreenTrack =
    meeting.screenSharingUserId &&
    meeting.screenSharingUserId !== currentUser.id
      ? remoteSharingSource
          ?.getVideoTracks()
          .filter(
            (track) => track.readyState === "live" && !track.muted,
          )
          .at(-1) ?? null
      : null;
  const remoteScreenStream = useMemo(
    () =>
      remoteScreenTrack ? new MediaStream([remoteScreenTrack]) : null,
    [remoteScreenTrack],
  );
  const activeScreenStream =
    meeting.screenSharingUserId === currentUser.id
      ? screenStream
      : remoteScreenStream;
  const recordingParticipants = useMemo(
    () =>
      meeting.participants.map((participant) => {
        const isLocal = participant.userId === currentUser.id;
        const source = isLocal
          ? localStream
          : remoteStreams[participant.userId] ?? null;
        if (
          !source ||
          isLocal ||
          participant.userId !== meeting.screenSharingUserId
        ) {
          return {
            userId: participant.userId,
            displayName: participant.displayName,
            stream: source,
            isMuted: isLocal ? isMuted : participant.isMuted,
          };
        }
        const cameraTracks = source
          .getVideoTracks()
          .filter(
            (track) => track.readyState === "live" && !track.muted,
          )
          .slice(0, -1);
        return {
          userId: participant.userId,
          displayName: participant.displayName,
          stream: new MediaStream([
            ...source.getAudioTracks(),
            ...cameraTracks,
          ]),
          isMuted: participant.isMuted,
        };
      }),
    [
      currentUser.id,
      isMuted,
      localStream,
      meeting.participants,
      meeting.screenSharingUserId,
      remoteStreams,
    ],
  );
  const recordingController = useCallRecording({
    connection,
    apiUrl,
    username,
    conversationId: meeting.conversationId,
    sessionId: meeting.meetingId,
    sessionType: "meeting",
    providerCallId: meeting.meetingId,
    providerManagedRecording: true,
    currentUserId: currentUser.id,
    participants: recordingParticipants,
    sharedScreenStream: activeScreenStream,
    canStopRecording: meeting.startedByUserId === currentUser.id,
    onConsentDeclined: onLeave,
    onError,
  });

  useEffect(() => {
    if (sharedScreenVideoRef.current) {
      sharedScreenVideoRef.current.srcObject = activeScreenStream;
    }
  }, [activeScreenStream]);

  return (
    <div className="group-meeting-backdrop">
      <section
        ref={meetingStageRef}
        className="group-meeting-stage"
        role="dialog"
        aria-modal="true"
        aria-label={`Meeting in ${groupTitle}`}
      >
        <CallRecordingControls
          controller={recordingController}
          showWhenIdle={false}
        />
        <button
          type="button"
          className="maximize-meeting-stage"
          aria-label={
            isStageMaximized
              ? "Restore group meeting"
              : "Maximize group meeting"
          }
          title={
            isStageMaximized
              ? "Restore group meeting"
              : "Maximize group meeting"
          }
          aria-pressed={isStageMaximized}
          onClick={() => void toggleStageMaximize()}
        >
          {isStageMaximized ? (
            <Minimize2 size={18} />
          ) : (
            <Maximize2 size={18} />
          )}
        </button>

        <header>
          <div>
            <strong>{groupTitle}</strong>
            <span>
              {meeting.participants.length} participant
              {meeting.participants.length === 1 ? "" : "s"} · Started by{" "}
              {meeting.startedByDisplayName}
            </span>
          </div>
        </header>

        <div
          className={`group-meeting-media ${meeting.screenSharingUserId ? "is-sharing" : ""}`}
        >
          <div className="group-meeting-grid">
            {meeting.participants.map((participant) => {
              const isLocal = participant.userId === currentUser.id;
              const sourceStream = isLocal
                ? localStream
                : remoteStreams[participant.userId] ?? null;
              const isRemoteScreenOwner =
                !isLocal &&
                participant.userId === meeting.screenSharingUserId;
              const activeVideoTracks =
                sourceStream
                  ?.getVideoTracks()
                  .filter(
                    (track) =>
                      track.readyState === "live" && !track.muted,
                  ) ?? [];
              const cameraStream =
                isRemoteScreenOwner && sourceStream
                  ? new MediaStream([
                      ...sourceStream.getAudioTracks(),
                      ...activeVideoTracks.slice(0, -1),
                    ])
                  : sourceStream;
              return (
                <MeetingParticipantTile
                  key={participant.userId}
                  participant={participant}
                  stream={cameraStream}
                  isLocal={isLocal}
                  isMuted={isLocal ? isMuted : participant.isMuted}
                  resolveAvatarUrl={resolveAvatarUrl}
                />
              );
            })}
          </div>

          {meeting.screenSharingUserId ? (
            <div
              className="group-meeting-shared-screen"
              ref={sharedScreenPanelRef}
            >
              {activeScreenStream ? (
                <video
                  ref={sharedScreenVideoRef}
                  autoPlay
                  muted
                  playsInline
                />
              ) : (
                <div className="group-meeting-screen-placeholder">
                  Connecting shared screen...
                </div>
              )}
              <span>
                {screenSharingParticipant?.displayName ?? "Participant"} is
                sharing
              </span>
              <button
                type="button"
                className="maximize-meeting-screen"
                aria-label={
                  isScreenMaximized
                    ? "Restore shared screen"
                    : "Maximize shared screen"
                }
                title={
                  isScreenMaximized
                    ? "Restore shared screen"
                    : "Maximize shared screen"
                }
                onClick={() => void toggleScreenMaximize()}
              >
                {isScreenMaximized ? (
                  <Minimize2 size={18} />
                ) : (
                  <Maximize2 size={18} />
                )}
              </button>
            </div>
          ) : null}
        </div>

        <div className="group-meeting-controls">
          <button
            type="button"
            className={isMuted ? "inactive" : ""}
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            onClick={toggleMute}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <CallRecordingControls controller={recordingController} />
          <button
            type="button"
            className={!isCameraEnabled ? "inactive" : ""}
            aria-label={
              isCameraEnabled ? "Turn camera off" : "Turn camera on"
            }
            onClick={() => void toggleCamera()}
          >
            {isCameraEnabled ? (
              <Video size={20} />
            ) : (
              <VideoOff size={20} />
            )}
          </button>
          <button
            type="button"
            className={isScreenSharing ? "sharing-screen" : ""}
            aria-label={
              isScreenSharing
                ? "Stop sharing screen"
                : meeting.screenSharingUserId
                  ? `Take over screen sharing from ${screenSharingParticipant?.displayName ?? "participant"}`
                  : "Share screen"
            }
            title={
              isScreenSharing
                ? "Stop sharing"
                : meeting.screenSharingUserId
                  ? "Share your screen instead"
                  : "Share screen"
            }
            onClick={() =>
              void (isScreenSharing
                ? stopScreenShare()
                : startScreenShare())
            }
          >
            {isScreenSharing ? (
              <ScreenShareOff size={20} />
            ) : (
              <ScreenShare size={20} />
            )}
          </button>
          <button
            type="button"
            className="leave-meeting"
            aria-label="Leave meeting"
            title="Leave meeting"
            onClick={onLeave}
          >
            <PhoneOff size={20} />
          </button>
          {meeting.startedByUserId === currentUser.id ? (
            <button
              type="button"
              className="stop-meeting"
              aria-label="Stop meeting for everyone"
              title="Stop meeting for everyone"
              onClick={onStop}
            >
              <Square size={18} />
            </button>
          ) : null}
        </div>
      </section>
      <RecordingConsentDialog controller={recordingController} />
    </div>
  );
}

function MeetingParticipantTile({
  participant,
  stream,
  isLocal,
  isMuted,
  resolveAvatarUrl,
}: {
  participant: GroupMeetingParticipant;
  stream: MediaStream | null;
  isLocal: boolean;
  isMuted: boolean;
  resolveAvatarUrl: (avatarUrl: string | null) => string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasVideo = Boolean(
    stream
      ?.getVideoTracks()
      .some((track) => track.readyState === "live" && !track.muted),
  );
  const avatarUrl = resolveAvatarUrl(participant.avatarUrl);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);

  return (
    <article className="group-meeting-participant">
      <div
        className={`meeting-microphone-status ${isMuted ? "is-muted" : ""}`}
        title={isMuted ? "Microphone off" : "Microphone on"}
      >
        {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
        <small>{isMuted ? "Mic off" : "Mic on"}</small>
      </div>
      {hasVideo ? (
        <video
          ref={videoRef}
          className={isLocal ? "local-meeting-video" : ""}
          autoPlay
          muted
          playsInline
        />
      ) : (
        <div className="group-meeting-placeholder">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" />
          ) : (
            participant.displayName.slice(0, 2).toUpperCase()
          )}
        </div>
      )}
      {!isLocal ? <audio ref={audioRef} autoPlay /> : null}
      <span>{isLocal ? `${participant.displayName} (You)` : participant.displayName}</span>
    </article>
  );
}
