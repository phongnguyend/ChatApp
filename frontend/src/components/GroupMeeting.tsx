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
import {
  acquireScreenShareStream,
  optimizeScreenShareSender,
} from "./screenShare";
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

type MeetingSignalEvent = {
  meetingId: string;
  conversationId: string;
  senderUserId: string;
  signalType: "offer" | "answer" | "ice";
  payload: string;
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
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const meetingStageRef = useRef<HTMLElement | null>(null);
  const sharedScreenPanelRef = useRef<HTMLDivElement | null>(null);
  const sharedScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const stopScreenShareRef = useRef<(notifyServer?: boolean) => Promise<void>>(
    async () => {},
  );
  const peerConnectionsRef = useRef(
    new Map<string, RTCPeerConnection>(),
  );
  const remoteSourceStreamsRef = useRef(new Map<string, MediaStream>());
  const queuedCandidatesRef = useRef(
    new Map<string, RTCIceCandidateInit[]>(),
  );
  const meetingRef = useRef(meeting);
  const onLeaveRef = useRef(onLeave);
  const recordingConsentBlockedRef = useRef(false);

  useEffect(() => {
    meetingRef.current = meeting;
    onLeaveRef.current = onLeave;
  }, [meeting, onLeave]);

  const sendSignal = useCallback(
    async (
      targetUserId: string,
      signalType: "offer" | "answer" | "ice",
      payload: string,
    ) => {
      const activeMeeting = meetingRef.current;
      if (connection?.state !== HubConnectionState.Connected) return;
      await connection.invoke("SendGroupMeetingSignal", {
        meetingId: activeMeeting.meetingId,
        conversationId: activeMeeting.conversationId,
        targetUserId,
        signalType,
        payload,
      });
    },
    [connection],
  );

  const createPeerConnection = useCallback(
    (participantId: string) => {
      const existing = peerConnectionsRef.current.get(participantId);
      if (existing) return existing;

      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      peerConnectionsRef.current.set(participantId, peerConnection);
      queuedCandidatesRef.current.set(participantId, []);
      for (const track of localStreamRef.current?.getTracks() ?? []) {
        peerConnection.addTrack(track, localStreamRef.current!);
      }
      for (const track of screenStreamRef.current?.getTracks() ?? []) {
        peerConnection.addTrack(track, screenStreamRef.current!);
      }

      const incomingStream = new MediaStream();
      remoteSourceStreamsRef.current.set(participantId, incomingStream);
      const refreshRemoteStream = () => {
        setRemoteStreams((current) => ({
          ...current,
          [participantId]: new MediaStream(incomingStream.getTracks()),
        }));
      };
      peerConnection.ontrack = ({ track }) => {
        incomingStream.addTrack(track);
        track.onmute = refreshRemoteStream;
        track.onunmute = refreshRemoteStream;
        track.onended = () => {
          incomingStream.removeTrack(track);
          refreshRemoteStream();
        };
        refreshRemoteStream();
      };
      peerConnection.onicecandidate = ({ candidate }) => {
        if (!candidate) return;
        void sendSignal(
          participantId,
          "ice",
          JSON.stringify(candidate.toJSON()),
        ).catch(() => onError("Meeting connectivity could not be established."));
      };
      peerConnection.onnegotiationneeded = () => {
        if (peerConnection.signalingState !== "stable") return;
        void (async () => {
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          await sendSignal(participantId, "offer", JSON.stringify(offer));
        })().catch(() => onError("Meeting media could not be negotiated."));
      };
      return peerConnection;
    },
    [onError, sendSignal],
  );

  useEffect(() => {
    let cancelled = false;
    const peerConnections = peerConnectionsRef.current;
    const remoteSourceStreams = remoteSourceStreamsRef.current;
    const queuedCandidates = queuedCandidatesRef.current;
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Group meetings are not supported by this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: initialCameraEnabled,
      });
      for (const track of stream.getAudioTracks()) {
        track.enabled = initialMicrophoneEnabled;
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      if (
        !initialMicrophoneEnabled &&
        connection?.state === HubConnectionState.Connected
      ) {
        void connection
          .invoke("SetGroupMeetingMicrophoneState", {
            meetingId: meeting.meetingId,
            conversationId: meeting.conversationId,
            isMuted: true,
          })
          .catch(() =>
            onError("Microphone status could not be updated."),
          );
      }
    })().catch((mediaError) => {
      onError(
        mediaError instanceof Error
          ? mediaError.message
          : "Microphone access is required to join the meeting.",
      );
      onLeaveRef.current();
    });

    return () => {
      cancelled = true;
      for (const track of localStreamRef.current?.getTracks() ?? []) {
        track.stop();
      }
      for (const track of screenStreamRef.current?.getTracks() ?? []) {
        track.onended = null;
        track.stop();
      }
      localStreamRef.current = null;
      screenStreamRef.current = null;
      for (const peerConnection of peerConnections.values()) {
        peerConnection.close();
      }
      peerConnections.clear();
      remoteSourceStreams.clear();
      queuedCandidates.clear();
    };
  }, [
    connection,
    initialCameraEnabled,
    initialMicrophoneEnabled,
    meeting.conversationId,
    meeting.meetingId,
    onError,
  ]);

  useEffect(() => {
    if (!connection) return;
    const onSignal = async (event: MeetingSignalEvent) => {
      if (
        event.meetingId !== meetingRef.current.meetingId ||
        event.conversationId !== meetingRef.current.conversationId ||
        !meetingRef.current.participants.some(
          (participant) => participant.userId === event.senderUserId,
        )
      ) {
        return;
      }

      try {
        const peerConnection = createPeerConnection(event.senderUserId);
        if (event.signalType === "ice") {
          const candidate = JSON.parse(event.payload) as RTCIceCandidateInit;
          if (peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(candidate);
          } else {
            queuedCandidatesRef.current
              .get(event.senderUserId)
              ?.push(candidate);
          }
          return;
        }

        const description = JSON.parse(
          event.payload,
        ) as RTCSessionDescriptionInit;
        const hasOfferCollision =
          event.signalType === "offer" &&
          peerConnection.signalingState !== "stable";
        if (
          hasOfferCollision &&
          currentUser.id.localeCompare(event.senderUserId) < 0
        ) {
          return;
        }
        if (hasOfferCollision) {
          await peerConnection.setLocalDescription({ type: "rollback" });
        }
        await peerConnection.setRemoteDescription(description);
        for (
          const candidate of
          queuedCandidatesRef.current.get(event.senderUserId) ?? []
        ) {
          await peerConnection.addIceCandidate(candidate);
        }
        queuedCandidatesRef.current.set(event.senderUserId, []);

        if (event.signalType === "offer") {
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await sendSignal(
            event.senderUserId,
            "answer",
            JSON.stringify(answer),
          );
        }
      } catch {
        onError("A meeting participant could not be connected.");
      }
    };
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

    connection.on("GroupMeetingSignal", onSignal);
    connection.on(
      "GroupMeetingScreenShareTakenOver",
      onScreenShareTakenOver,
    );
    return () => {
      connection.off("GroupMeetingSignal", onSignal);
      connection.off(
        "GroupMeetingScreenShareTakenOver",
        onScreenShareTakenOver,
      );
    };
  }, [
    connection,
    createPeerConnection,
    currentUser.id,
    onError,
    sendSignal,
  ]);

  useEffect(() => {
    if (!localStream) return;
    const participantIds = new Set(
      meeting.participants
        .map((participant) => participant.userId)
        .filter((participantId) => participantId !== currentUser.id),
    );

    for (const [participantId, peerConnection] of
      peerConnectionsRef.current) {
      if (participantIds.has(participantId)) continue;
      peerConnection.close();
      peerConnectionsRef.current.delete(participantId);
      remoteSourceStreamsRef.current.delete(participantId);
      queuedCandidatesRef.current.delete(participantId);
      setRemoteStreams((current) => {
        const next = { ...current };
        delete next[participantId];
        return next;
      });
    }

    for (const participantId of participantIds) {
      const peerConnection = createPeerConnection(participantId);
      for (const track of localStream.getTracks()) {
        const alreadySending = peerConnection
          .getSenders()
          .some((sender) => sender.track === track);
        if (!alreadySending) peerConnection.addTrack(track, localStream);
      }
      for (const track of screenStreamRef.current?.getTracks() ?? []) {
        const alreadySending = peerConnection
          .getSenders()
          .some((sender) => sender.track === track);
        if (!alreadySending) {
          peerConnection.addTrack(track, screenStreamRef.current!);
        }
      }
    }
  }, [
    createPeerConnection,
    currentUser.id,
    localStream,
    meeting.participants,
  ]);

  const toggleMute = () => {
    const nextMuted = !isMuted;
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !nextMuted;
    }
    setIsMuted(nextMuted);
    if (connection?.state === HubConnectionState.Connected) {
      void connection
        .invoke("SetGroupMeetingMicrophoneState", {
          meetingId: meeting.meetingId,
          conversationId: meeting.conversationId,
          isMuted: nextMuted,
        })
        .catch(() => onError("Microphone status could not be updated."));
    }
  };

  const toggleCamera = async () => {
    const currentStream = localStreamRef.current;
    if (!currentStream) return;
    if (isCameraEnabled) {
      for (const track of currentStream.getVideoTracks()) {
        for (const peerConnection of peerConnectionsRef.current.values()) {
          const sender = peerConnection
            .getSenders()
            .find((candidate) => candidate.track === track);
          if (sender) peerConnection.removeTrack(sender);
        }
        track.stop();
      }
      const audioStream = new MediaStream(currentStream.getAudioTracks());
      localStreamRef.current = audioStream;
      setLocalStream(audioStream);
      setIsCameraEnabled(false);
      return;
    }

    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });
      const cameraTrack = cameraStream.getVideoTracks()[0];
      if (!cameraTrack) throw new Error("No camera is available.");
      const nextStream = new MediaStream([
        ...currentStream.getAudioTracks(),
        cameraTrack,
      ]);
      for (const peerConnection of peerConnectionsRef.current.values()) {
        peerConnection.addTrack(cameraTrack, nextStream);
      }
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      setIsCameraEnabled(true);
    } catch (cameraError) {
      onError(
        cameraError instanceof Error
          ? cameraError.message
          : "The camera could not be turned on.",
      );
    }
  };

  const stopScreenShare = useCallback(
    async (notifyServer = true) => {
      const displayStream = screenStreamRef.current;
      if (!displayStream) return;
      const displayTracks = new Set(displayStream.getTracks());
      screenStreamRef.current = null;
      setScreenStream(null);
      setIsScreenSharing(false);

      for (const peerConnection of peerConnectionsRef.current.values()) {
        for (const sender of peerConnection.getSenders()) {
          if (sender.track && displayTracks.has(sender.track)) {
            peerConnection.removeTrack(sender);
          }
        }
      }
      for (const track of displayStream.getTracks()) {
        track.onended = null;
        track.stop();
      }

      if (
        notifyServer &&
        connection?.state === HubConnectionState.Connected
      ) {
        try {
          await connection.invoke("StopGroupMeetingScreenShare", {
            meetingId: meeting.meetingId,
            conversationId: meeting.conversationId,
          });
        } catch {
          onError("Screen sharing could not be stopped cleanly.");
        }
      }
    },
    [connection, meeting.conversationId, meeting.meetingId, onError],
  );

  useEffect(() => {
    stopScreenShareRef.current = stopScreenShare;
  }, [stopScreenShare]);

  const startScreenShare = async () => {
    if (
      isScreenSharing ||
      connection?.state !== HubConnectionState.Connected ||
      !navigator.mediaDevices?.getDisplayMedia
    ) {
      return;
    }

    let displayStream: MediaStream | null = null;
    try {
      displayStream = await acquireScreenShareStream();
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error("No screen was selected.");

      await connection.invoke("StartGroupMeetingScreenShare", {
        meetingId: meeting.meetingId,
        conversationId: meeting.conversationId,
      });
      for (const peerConnection of peerConnectionsRef.current.values()) {
        const sender = peerConnection.addTrack(screenTrack, displayStream);
        await optimizeScreenShareSender(sender);
      }
      screenStreamRef.current = displayStream;
      setScreenStream(displayStream);
      setIsScreenSharing(true);
      screenTrack.onended = () => {
        void stopScreenShareRef.current();
      };
    } catch (screenError) {
      for (const track of displayStream?.getTracks() ?? []) track.stop();
      if (
        screenError instanceof DOMException &&
        ["AbortError", "NotAllowedError"].includes(screenError.name)
      ) {
        return;
      }
      onError(
        screenError instanceof Error
          ? screenError.message
          : "Screen sharing could not be started.",
      );
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
    currentUserId: currentUser.id,
    participants: recordingParticipants,
    sharedScreenStream: activeScreenStream,
    canStopRecording: meeting.startedByUserId === currentUser.id,
    onConsentDeclined: onLeave,
    onError,
  });

  useEffect(() => {
    if (!recordingController.hasLocalConsent) {
      recordingConsentBlockedRef.current = true;
      return;
    }
    if (!recordingConsentBlockedRef.current) return;
    recordingConsentBlockedRef.current = false;
    for (const [participantId, peerConnection] of
      peerConnectionsRef.current) {
      void (async () => {
        try {
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          await sendSignal(participantId, "offer", JSON.stringify(offer));
        } catch {
          onError(
            "Meeting media could not be connected after recording consent.",
          );
        }
      })();
    }
  }, [
    onError,
    recordingController.hasLocalConsent,
    sendSignal,
  ]);

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
