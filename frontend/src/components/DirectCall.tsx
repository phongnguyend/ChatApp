/* oxlint-disable react/only-export-components -- call UI and its lifecycle hook share private event types */
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Video,
  VideoOff,
} from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
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
import "./DirectCall.css";

export type CallPeer = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

type CallStatus =
  | "incoming"
  | "outgoing"
  | "connecting"
  | "connected";

type ActiveCall = {
  callId: string;
  conversationId: string;
  peer: CallPeer;
  hasVideo: boolean;
  status: CallStatus;
};

type IncomingCallEvent = {
  callId: string;
  conversationId: string;
  initiatorUserId: string;
  initiatorDisplayName: string;
  initiatorAvatarUrl: string | null;
  hasVideo: boolean;
};

type CallResponseEvent = {
  callId: string;
  conversationId: string;
  userId: string;
  displayName: string;
  accepted: boolean;
};

type CallEndedEvent = {
  callId: string;
  conversationId: string;
  userId: string;
  reason: string;
};

type CallScreenShareChangedEvent = {
  callId: string;
  conversationId: string;
  userId: string;
  isSharing: boolean;
};

type CallScreenShareTakenOverEvent = {
  callId: string;
  conversationId: string;
  newOwnerUserId: string;
};

type CallMicrophoneStateEvent = {
  callId: string;
  conversationId: string;
  userId: string;
  isMuted: boolean;
};

type UseDirectCallOptions = {
  connection: HubConnection | null;
  apiUrl: string;
  username: string;
  localUserId: string;
  localDisplayName: string;
  onError: Dispatch<SetStateAction<string>>;
  resolveAvatarUrl: (avatarUrl: string | null) => string | null;
};

export function useDirectCall({
  connection,
  apiUrl,
  username,
  localUserId,
  localDisplayName,
  onError,
  resolveAvatarUrl,
}: UseDirectCallOptions) {
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isPeerMuted, setIsPeerMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isPeerScreenSharing, setIsPeerScreenSharing] = useState(false);
  const callRef = useRef<ActiveCall | null>(null);
  const stopScreenShareRef = useRef<() => Promise<void>>(async () => {});

  const updateCall = useCallback((next: ActiveCall | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const cleanupCall = useCallback(() => {
    setLocalStream(null);
    setScreenStream(null);
    setRemoteStream(null);
    setHasRemoteVideo(false);
    setIsMuted(false);
    setIsPeerMuted(false);
    setIsCameraEnabled(false);
    setIsScreenSharing(false);
    setIsPeerScreenSharing(false);
    updateCall(null);
  }, [updateCall]);

  const azureMedia = useAzureCommunicationCall({
    active: call?.status === "connecting" || call?.status === "connected",
    apiUrl,
    username,
    groupId: call?.callId ?? null,
    userId: localUserId,
    displayName: localDisplayName,
    initialMicrophoneEnabled: !isMuted,
    initialCameraEnabled: isCameraEnabled,
    onConnected: () => {
      const activeCall = callRef.current;
      if (activeCall?.status === "connecting") {
        updateCall({ ...activeCall, status: "connected" });
      }
    },
    onDisconnected: () => {
      if (callRef.current) cleanupCall();
    },
    onError,
  });

  useEffect(() => {
    setLocalStream(azureMedia.localStream);
    setRemoteStream(call ? azureMedia.remoteStreams[call.peer.id] ?? null : null);
    setHasRemoteVideo(Boolean(call && azureMedia.remoteStreams[call.peer.id]?.getVideoTracks().length));
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
    call,
  ]);

  const startCall = useCallback(
    async (
      conversationId: string,
      peer: CallPeer,
      hasVideo: boolean,
    ) => {
      if (
        callRef.current ||
        connection?.state !== HubConnectionState.Connected
      ) {
        onError(
          callRef.current
            ? "Finish the current call before starting another."
            : "Live chat must be connected before starting a call.",
        );
        return;
      }

      const activeCall: ActiveCall = {
        callId: crypto.randomUUID(),
        conversationId,
        peer: {
          ...peer,
          avatarUrl: resolveAvatarUrl(peer.avatarUrl),
        },
        hasVideo,
        status: "outgoing",
      };

      try {
        setIsMuted(false);
        setIsCameraEnabled(hasVideo);
        updateCall(activeCall);
        await connection.invoke("StartCall", {
          callId: activeCall.callId,
          conversationId,
          targetUserId: peer.id,
          hasVideo,
        });
      } catch (requestError) {
        cleanupCall();
        onError(
          requestError instanceof Error
            ? requestError.message
            : "The call could not be started.",
        );
      }
    },
    [
      cleanupCall,
      connection,
      onError,
      resolveAvatarUrl,
      updateCall,
    ],
  );

  const acceptCall = useCallback(async () => {
    const activeCall = callRef.current;
    if (
      !activeCall ||
      activeCall.status !== "incoming" ||
      connection?.state !== HubConnectionState.Connected
    ) {
      return;
    }

    try {
      updateCall({ ...activeCall, status: "connecting" });
      await connection.invoke("RespondToCall", {
        callId: activeCall.callId,
        conversationId: activeCall.conversationId,
        initiatorUserId: activeCall.peer.id,
        accepted: true,
      });
    } catch (requestError) {
      cleanupCall();
      onError(
        requestError instanceof Error
          ? requestError.message
          : "The call could not be accepted.",
      );
    }
  }, [
    cleanupCall,
    connection,
    onError,
    updateCall,
  ]);

  const declineCall = useCallback(async () => {
    const activeCall = callRef.current;
    if (!activeCall) return;
    try {
      if (
        activeCall.status === "incoming" &&
        connection?.state === HubConnectionState.Connected
      ) {
        await connection.invoke("RespondToCall", {
          callId: activeCall.callId,
          conversationId: activeCall.conversationId,
          initiatorUserId: activeCall.peer.id,
          accepted: false,
        });
      }
    } finally {
      cleanupCall();
    }
  }, [cleanupCall, connection]);

  const endCall = useCallback(async () => {
    const activeCall = callRef.current;
    if (!activeCall) return;
    try {
      if (connection?.state === HubConnectionState.Connected) {
        await connection.invoke("EndCall", {
          callId: activeCall.callId,
          conversationId: activeCall.conversationId,
          targetUserId: activeCall.peer.id,
          reason: activeCall.status === "outgoing" ? "cancelled" : "ended",
        });
      }
    } finally {
      cleanupCall();
    }
  }, [cleanupCall, connection]);

  const toggleMute = useCallback(() => {
    const activeCall = callRef.current;
    if (!activeCall) return;
    if (activeCall.status !== "incoming") {
      void azureMedia.toggleMute().then(() => {
        const nextMuted = !isMuted;
        if (connection?.state === HubConnectionState.Connected) {
          void connection.invoke("SetCallMicrophoneState", {
            callId: activeCall.callId,
            conversationId: activeCall.conversationId,
            targetUserId: activeCall.peer.id,
            isMuted: nextMuted,
          });
        }
      }).catch(() => onError("The microphone could not be updated."));
      return;
    }
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (connection?.state === HubConnectionState.Connected) {
      void connection.invoke("SetCallMicrophoneState", {
        callId: activeCall.callId,
        conversationId: activeCall.conversationId,
        targetUserId: activeCall.peer.id,
        isMuted: nextMuted,
      });
    }
  }, [azureMedia, connection, isMuted, onError]);

  const toggleCamera = useCallback(async () => {
    const activeCall = callRef.current;
    if (!activeCall) return;
    if (!azureMedia.call) {
      setIsCameraEnabled((current) => !current);
      return;
    }
    try {
      await azureMedia.toggleCamera();
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : "The camera could not be updated.");
    }
  }, [azureMedia, onError]);

  const stopScreenShare = useCallback(async (notifyServer = true) => {
    if (azureMedia.isScreenSharing) {
      try {
        await azureMedia.stopScreenShare();
      } catch {
        onError("Screen sharing could not be stopped cleanly.");
      } finally {
        const activeCall = callRef.current;
        if (notifyServer && activeCall && connection?.state === HubConnectionState.Connected) {
          void connection.invoke("StopScreenShare", {
            callId: activeCall.callId,
            conversationId: activeCall.conversationId,
            targetUserId: activeCall.peer.id,
          });
        }
      }
    }
  }, [azureMedia, connection, onError]);

  useEffect(() => {
    stopScreenShareRef.current = stopScreenShare;
  }, [stopScreenShare]);

  const startScreenShare = useCallback(async () => {
    const activeCall = callRef.current;
    if (activeCall?.status === "connected" && azureMedia.call && !azureMedia.isScreenSharing) {
      let registered = false;
      try {
        if (connection?.state !== HubConnectionState.Connected) throw new Error("Live chat disconnected before screen sharing started.");
        await connection.invoke("StartScreenShare", {
          callId: activeCall.callId,
          conversationId: activeCall.conversationId,
          targetUserId: activeCall.peer.id,
        });
        registered = true;
        await azureMedia.startScreenShare();
      } catch (requestError) {
        if (registered && connection?.state === HubConnectionState.Connected) {
          void connection.invoke("StopScreenShare", {
            callId: activeCall.callId,
            conversationId: activeCall.conversationId,
            targetUserId: activeCall.peer.id,
          });
        }
        if (!(requestError instanceof DOMException && ["AbortError", "NotAllowedError"].includes(requestError.name))) {
          onError(requestError instanceof Error ? requestError.message : "Screen sharing could not be started.");
        }
      }
    }
  }, [azureMedia, connection, onError]);

  useEffect(() => {
    if (!connection) return;

    const onIncoming = (event: IncomingCallEvent) => {
      if (callRef.current) {
        void connection.invoke("RespondToCall", {
          callId: event.callId,
          conversationId: event.conversationId,
          initiatorUserId: event.initiatorUserId,
          accepted: false,
        });
        return;
      }
      updateCall({
        callId: event.callId,
        conversationId: event.conversationId,
        peer: {
          id: event.initiatorUserId,
          displayName: event.initiatorDisplayName,
          avatarUrl: resolveAvatarUrl(event.initiatorAvatarUrl),
        },
        hasVideo: event.hasVideo,
        status: "incoming",
      });
      setIsMuted(false);
      setIsCameraEnabled(event.hasVideo);
    };

    const onAccepted = async (event: CallResponseEvent) => {
      const activeCall = callRef.current;
      if (
        !activeCall ||
        activeCall.callId !== event.callId ||
        activeCall.status !== "outgoing"
      ) {
        return;
      }
      try {
        updateCall({ ...activeCall, status: "connecting" as const });
      } catch {
        onError("The call connection could not be created.");
        cleanupCall();
      }
    };

    const onDeclined = (event: CallResponseEvent) => {
      if (callRef.current?.callId !== event.callId) return;
      onError(`${event.displayName} declined the call.`);
      cleanupCall();
    };

    const onEnded = (event: CallEndedEvent) => {
      if (callRef.current?.callId !== event.callId) return;
      cleanupCall();
    };

    const onScreenShareChanged = (event: CallScreenShareChangedEvent) => {
      const activeCall = callRef.current;
      if (
        !activeCall ||
        activeCall.callId !== event.callId ||
        activeCall.peer.id !== event.userId
      ) {
        return;
      }
      setIsPeerScreenSharing(event.isSharing);
    };

    const onScreenShareTakenOver = (
      event: CallScreenShareTakenOverEvent,
    ) => {
      const activeCall = callRef.current;
      if (
        !activeCall ||
        activeCall.callId !== event.callId ||
        activeCall.peer.id !== event.newOwnerUserId
      ) {
        return;
      }
      setIsPeerScreenSharing(true);
      void stopScreenShare(false);
    };

    const onMicrophoneStateChanged = (
      event: CallMicrophoneStateEvent,
    ) => {
      const activeCall = callRef.current;
      if (
        !activeCall ||
        activeCall.callId !== event.callId ||
        activeCall.peer.id !== event.userId
      ) {
        return;
      }
      setIsPeerMuted(event.isMuted);
    };

    connection.on("CallIncoming", onIncoming);
    connection.on("CallAccepted", onAccepted);
    connection.on("CallDeclined", onDeclined);
    connection.on("CallEnded", onEnded);
    connection.on("CallScreenShareChanged", onScreenShareChanged);
    connection.on("CallScreenShareTakenOver", onScreenShareTakenOver);
    connection.on(
      "CallMicrophoneStateChanged",
      onMicrophoneStateChanged,
    );
    return () => {
      connection.off("CallIncoming", onIncoming);
      connection.off("CallAccepted", onAccepted);
      connection.off("CallDeclined", onDeclined);
      connection.off("CallEnded", onEnded);
      connection.off("CallScreenShareChanged", onScreenShareChanged);
      connection.off("CallScreenShareTakenOver", onScreenShareTakenOver);
      connection.off(
        "CallMicrophoneStateChanged",
        onMicrophoneStateChanged,
      );
    };
  }, [
    cleanupCall,
    connection,
    onError,
    resolveAvatarUrl,
    stopScreenShare,
    updateCall,
  ]);

  useEffect(() => {
    if (call?.status !== "incoming" && call?.status !== "outgoing") return;
    const timeout = window.setTimeout(() => {
      if (call.status === "incoming") {
        void declineCall();
      } else {
        void endCall();
      }
    }, 45_000);
    return () => window.clearTimeout(timeout);
  }, [call, declineCall, endCall]);

  useEffect(() => cleanupCall, [cleanupCall]);

  return {
    call,
    connection,
    apiUrl,
    username,
    localUserId,
    onError,
    localDisplayName,
    localStream,
    screenStream,
    remoteStream,
    hasRemoteVideo,
    isMuted,
    isPeerMuted,
    isCameraEnabled,
    isScreenSharing,
    isPeerScreenSharing,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
  };
}

type DirectCallOverlayProps = ReturnType<typeof useDirectCall>;

export function DirectCallOverlay({
  call,
  connection,
  apiUrl,
  username,
  localUserId,
  onError,
  localDisplayName,
  localStream,
  screenStream,
  remoteStream,
  isMuted,
  isPeerMuted,
  isCameraEnabled,
  isScreenSharing,
  isPeerScreenSharing,
  acceptCall,
  declineCall,
  endCall,
  toggleMute,
  toggleCamera,
  startScreenShare,
  stopScreenShare,
}: DirectCallOverlayProps) {
  const callStageRef = useRef<HTMLElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const sharedScreenPanelRef = useRef<HTMLDivElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isCallStageMaximized, setIsCallStageMaximized] = useState(false);
  const [isScreenMaximized, setIsScreenMaximized] = useState(false);
  const localHasVideo =
    isCameraEnabled && Boolean(localStream?.getVideoTracks().length);
  const remoteVideoTracks = useMemo(
    () =>
      remoteStream
        ?.getVideoTracks()
        .filter((track) => track.readyState === "live" && !track.muted) ?? [],
    [remoteStream],
  );
  const remoteScreenTrack = isPeerScreenSharing
    ? remoteVideoTracks.at(-1) ?? null
    : null;
  const remoteCameraTrack = isPeerScreenSharing
    ? remoteVideoTracks.length > 1
      ? remoteVideoTracks[0]
      : null
    : remoteVideoTracks[0] ?? null;
  const remoteCameraStream = useMemo(
    () =>
      remoteCameraTrack ? new MediaStream([remoteCameraTrack]) : null,
    [remoteCameraTrack],
  );
  const remoteScreenStream = useMemo(
    () =>
      remoteScreenTrack ? new MediaStream([remoteScreenTrack]) : null,
    [remoteScreenTrack],
  );
  const activeScreenStream = isScreenSharing
    ? screenStream
    : remoteScreenStream;
  const screenShareOwner = isScreenSharing
    ? localDisplayName
    : call?.peer.displayName;
  const remoteRecordingStream = useMemo(
    () =>
      remoteStream
        ? new MediaStream([
            ...remoteStream.getAudioTracks(),
            ...(remoteCameraTrack ? [remoteCameraTrack] : []),
          ])
        : null,
    [remoteCameraTrack, remoteStream],
  );
  const recordingController = useCallRecording({
    connection,
    apiUrl,
    username,
    conversationId: call?.conversationId ?? "",
    sessionId: call?.callId ?? "",
    sessionType: "direct",
    providerCallId: call?.callId ?? null,
    providerManagedRecording: true,
    currentUserId: localUserId,
    participants: call
      ? [
          {
            userId: localUserId,
            displayName: localDisplayName,
            stream: localStream,
            isMuted,
          },
          {
            userId: call.peer.id,
            displayName: call.peer.displayName,
            stream: remoteRecordingStream,
            isMuted: isPeerMuted,
          },
        ]
      : [],
    sharedScreenStream: activeScreenStream,
    canStopRecording: false,
    onConsentDeclined: () => undefined,
    onError,
  });

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteCameraStream;
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = activeScreenStream;
    }
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
  }, [activeScreenStream, remoteCameraStream, remoteStream]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsCallStageMaximized(
        document.fullscreenElement === callStageRef.current,
      );
      setIsScreenMaximized(
        document.fullscreenElement === sharedScreenPanelRef.current,
      );
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleCallStageMaximize = useCallback(async () => {
    const stage = callStageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await stage.requestFullscreen();
      }
    } catch {
      setIsCallStageMaximized(false);
    }
  }, []);

  const toggleScreenMaximize = useCallback(async () => {
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
  }, []);

  if (!call) return null;
  const isIncoming = call.status === "incoming";
  const isConnected =
    call.status === "connected" || call.status === "connecting";
  const canControlMedia = call.status === "connected";
  const canConfigureMedia =
    call.status === "outgoing" || canControlMedia;
  const isSharing = isScreenSharing || isPeerScreenSharing;

  return (
    <div className="direct-call-backdrop">
      <section
        ref={callStageRef}
        className={`direct-call-stage ${isConnected ? "video-call" : "audio-call"}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${call.hasVideo ? "Video" : "Audio"} call with ${call.peer.displayName}`}
      >
        <CallRecordingControls
          controller={recordingController}
          showWhenIdle={false}
        />
        <button
          className="maximize-call-stage"
          type="button"
          aria-label={
            isCallStageMaximized
              ? "Restore call stage"
              : "Maximize call stage"
          }
          title={
            isCallStageMaximized
              ? "Restore call stage"
              : "Maximize call stage"
          }
          aria-pressed={isCallStageMaximized}
          onClick={() => void toggleCallStageMaximize()}
        >
          {isCallStageMaximized ? (
            <Minimize2 size={18} />
          ) : (
            <Maximize2 size={18} />
          )}
        </button>

        <div className="direct-call-copy">
          <strong>{call.peer.displayName}</strong>
          <span>
            {call.status === "incoming"
              ? `Incoming ${call.hasVideo ? "video" : "audio"} call`
              : call.status === "outgoing"
                ? "Calling..."
                : call.status === "connecting"
                  ? "Connecting..."
                  : isPeerScreenSharing
                    ? `${call.peer.displayName} is sharing their screen`
                  : "Connected"}
          </span>
        </div>

        {isConnected ? (
          <div
            className={`direct-call-media ${isSharing ? "is-sharing" : ""}`}
          >
            <div className="direct-call-participants">
              <div className="call-participant-tile">
                <div
                  className={`participant-microphone-status ${isMuted ? "is-muted" : ""}`}
                  title={isMuted ? "Microphone off" : "Microphone on"}
                >
                  {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                  <small>{isMuted ? "Mic off" : "Mic on"}</small>
                </div>
                {localHasVideo ? (
                  <video
                    className="local-participant-video"
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                  />
                ) : (
                  <div className="call-participant-placeholder">
                    {localDisplayName.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <span>{localDisplayName}</span>
              </div>

              <div className="call-participant-tile">
                <div
                  className={`participant-microphone-status ${isPeerMuted ? "is-muted" : ""}`}
                  title={
                    isPeerMuted ? "Microphone off" : "Microphone on"
                  }
                >
                  {isPeerMuted ? <MicOff size={14} /> : <Mic size={14} />}
                  <small>{isPeerMuted ? "Mic off" : "Mic on"}</small>
                </div>
                {remoteCameraStream ? (
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    muted
                    playsInline
                  />
                ) : (
                  <div className="call-participant-placeholder">
                    {call.peer.avatarUrl ? (
                      <img src={call.peer.avatarUrl} alt="" />
                    ) : (
                      call.peer.displayName.slice(0, 2).toUpperCase()
                    )}
                  </div>
                )}
                <span>{call.peer.displayName}</span>
              </div>
            </div>

            {activeScreenStream ? (
              <div
                className="shared-screen-panel"
                ref={sharedScreenPanelRef}
              >
                <video
                  ref={screenVideoRef}
                  autoPlay
                  muted
                  playsInline
                />
                <span>{screenShareOwner} is sharing</span>
                <button
                  className="maximize-shared-screen"
                  type="button"
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
                  aria-pressed={isScreenMaximized}
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

            <audio ref={remoteAudioRef} autoPlay />
          </div>
        ) : (
          <>
            <div className="direct-call-avatar">
              {call.peer.avatarUrl ? (
                <img src={call.peer.avatarUrl} alt="" />
              ) : (
                call.peer.displayName.slice(0, 2).toUpperCase()
              )}
            </div>
            <audio ref={remoteAudioRef} autoPlay />
          </>
        )}

        <div className="direct-call-controls">
          {isIncoming ? (
            <>
              <button
                type="button"
                className={isMuted ? "inactive" : ""}
                aria-label={
                  isMuted
                    ? "Answer with microphone on"
                    : "Answer with microphone off"
                }
                aria-pressed={isMuted}
                onClick={toggleMute}
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button
                type="button"
                className={!isCameraEnabled ? "inactive" : ""}
                aria-label={
                  isCameraEnabled
                    ? "Answer with camera off"
                    : "Answer with camera on"
                }
                aria-pressed={!isCameraEnabled}
                onClick={() => void toggleCamera()}
              >
                {isCameraEnabled ? (
                  <Video size={20} />
                ) : (
                  <VideoOff size={20} />
                )}
              </button>
              <button
                className="accept-call"
                type="button"
                aria-label="Accept call"
                onClick={() => void acceptCall()}
              >
                <Phone size={21} />
              </button>
              <button
                className="end-call"
                type="button"
                aria-label="Decline call"
                onClick={() => void declineCall()}
              >
                <PhoneOff size={21} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={isMuted ? "inactive" : ""}
                disabled={!isConnected && call.status !== "outgoing"}
                aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
                aria-pressed={isMuted}
                onClick={toggleMute}
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button
                type="button"
                className={!isCameraEnabled ? "inactive" : ""}
                disabled={!canConfigureMedia || isScreenSharing}
                aria-label={
                  isCameraEnabled ? "Turn camera off" : "Turn camera on"
                }
                aria-pressed={!isCameraEnabled}
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
                disabled={!canControlMedia}
                aria-label={
                  isScreenSharing
                    ? "Stop sharing screen"
                    : isPeerScreenSharing
                      ? `Take over screen sharing from ${call.peer.displayName}`
                      : "Share screen"
                }
                title={
                  isScreenSharing
                    ? "Stop sharing"
                    : isPeerScreenSharing
                      ? "Share your screen instead"
                      : "Share screen"
                }
                aria-pressed={isScreenSharing}
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
              {canControlMedia ? (
                <CallRecordingControls controller={recordingController} />
              ) : null}
              <button
                className="end-call"
                type="button"
                aria-label="End call"
                onClick={() => void endCall()}
              >
                <PhoneOff size={21} />
              </button>
            </>
          )}
        </div>
      </section>
      <RecordingConsentDialog controller={recordingController} />
    </div>
  );
}
