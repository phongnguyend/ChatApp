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
import {
  acquireScreenShareStream,
  optimizeScreenShareSender,
} from "./screenShare";
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

type CallSignalEvent = {
  callId: string;
  conversationId: string;
  senderUserId: string;
  signalType: "offer" | "answer" | "ice";
  payload: string;
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
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenSenderRef = useRef<RTCRtpSender | null>(null);
  const stopScreenShareRef = useRef<() => Promise<void>>(async () => {});
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const updateCall = useCallback((next: ActiveCall | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const cleanupCall = useCallback(() => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    queuedCandidatesRef.current = [];
    for (const track of localStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    for (const track of screenStreamRef.current?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    localStreamRef.current = null;
    screenStreamRef.current = null;
    screenSenderRef.current = null;
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

  const sendSignal = useCallback(
    async (
      activeCall: ActiveCall,
      signalType: "offer" | "answer" | "ice",
      payload: string,
    ) => {
      if (connection?.state !== HubConnectionState.Connected) return;
      await connection.invoke("SendCallSignal", {
        callId: activeCall.callId,
        conversationId: activeCall.conversationId,
        targetUserId: activeCall.peer.id,
        signalType,
        payload,
      });
    },
    [connection],
  );

  const createPeerConnection = useCallback(
    (activeCall: ActiveCall) => {
      peerConnectionRef.current?.close();
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      peerConnectionRef.current = peerConnection;
      queuedCandidatesRef.current = [];

      for (const track of localStreamRef.current?.getTracks() ?? []) {
        peerConnection.addTrack(track, localStreamRef.current!);
      }

      const incomingStream = new MediaStream();
      setRemoteStream(incomingStream);
      peerConnection.ontrack = ({ track }) => {
        incomingStream.addTrack(track);
        const refreshRemoteStream = () => {
          setHasRemoteVideo(
            incomingStream
              .getVideoTracks()
              .some(
                (videoTrack) =>
                  videoTrack.readyState === "live" && !videoTrack.muted,
              ),
          );
          setRemoteStream(new MediaStream(incomingStream.getTracks()));
        };
        if (track.kind === "video") {
          track.onended = () => {
            incomingStream.removeTrack(track);
            refreshRemoteStream();
          };
          track.onmute = refreshRemoteStream;
          track.onunmute = refreshRemoteStream;
        }
        refreshRemoteStream();
      };
      peerConnection.onicecandidate = ({ candidate }) => {
        if (!candidate) return;
        void sendSignal(
          activeCall,
          "ice",
          JSON.stringify(candidate.toJSON()),
        ).catch(() => onError("Call connectivity could not be established."));
      };
      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === "connected") {
          const current = callRef.current;
          if (current?.callId === activeCall.callId) {
            updateCall({ ...current, status: "connected" });
          }
        } else if (
          peerConnection.connectionState === "failed" ||
          peerConnection.connectionState === "closed"
        ) {
          if (callRef.current?.callId === activeCall.callId) {
            onError("The call connection ended.");
            cleanupCall();
          }
        }
      };

      return peerConnection;
    },
    [cleanupCall, onError, sendSignal, updateCall],
  );

  const acquireMedia = useCallback(
    async (hasVideo: boolean, audioEnabled = true) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Audio and video calls are not supported by this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: hasVideo,
      });
      for (const track of stream.getAudioTracks()) {
        track.enabled = audioEnabled;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsMuted(!audioEnabled);
      setIsCameraEnabled(hasVideo);
      return stream;
    },
    [],
  );

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
        await acquireMedia(hasVideo);
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
      acquireMedia,
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
      await acquireMedia(isCameraEnabled, !isMuted);
      createPeerConnection(activeCall);
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
    acquireMedia,
    cleanupCall,
    connection,
    createPeerConnection,
    isCameraEnabled,
    isMuted,
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
    const nextMuted = !isMuted;
    if (activeCall.status !== "incoming") {
      const audioTracks = localStreamRef.current?.getAudioTracks() ?? [];
      if (audioTracks.length === 0) return;
      for (const track of audioTracks) track.enabled = !nextMuted;
    }
    setIsMuted(nextMuted);
    if (connection?.state === HubConnectionState.Connected) {
      void connection.invoke("SetCallMicrophoneState", {
        callId: activeCall.callId,
        conversationId: activeCall.conversationId,
        targetUserId: activeCall.peer.id,
        isMuted: nextMuted,
      });
    }
  }, [connection, isMuted]);

  const renegotiate = useCallback(async () => {
    const activeCall = callRef.current;
    const peerConnection = peerConnectionRef.current;
    if (
      !activeCall ||
      !peerConnection ||
      peerConnection.signalingState !== "stable"
    ) {
      return;
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await sendSignal(activeCall, "offer", JSON.stringify(offer));
  }, [sendSignal]);

  const toggleCamera = useCallback(async () => {
    const activeCall = callRef.current;
    if (activeCall?.status === "incoming") {
      setIsCameraEnabled((current) => !current);
      return;
    }
    if (activeCall?.status === "outgoing") {
      const currentStream = localStreamRef.current;
      if (isCameraEnabled) {
        for (const track of currentStream?.getVideoTracks() ?? []) {
          track.stop();
        }
        const audioOnlyStream = new MediaStream(
          currentStream?.getAudioTracks() ?? [],
        );
        localStreamRef.current = audioOnlyStream;
        setLocalStream(audioOnlyStream);
        setIsCameraEnabled(false);
        return;
      }

      let cameraStream: MediaStream | null = null;
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
        const cameraTrack = cameraStream.getVideoTracks()[0];
        if (!cameraTrack) throw new Error("No camera is available.");
        const nextStream = new MediaStream([
          ...(currentStream?.getAudioTracks() ?? []),
          cameraTrack,
        ]);
        localStreamRef.current = nextStream;
        setLocalStream(nextStream);
        setIsCameraEnabled(true);
      } catch (requestError) {
        for (const track of cameraStream?.getTracks() ?? []) track.stop();
        onError(
          requestError instanceof Error
            ? requestError.message
            : "The camera could not be turned on.",
        );
      }
      return;
    }
    const peerConnection = peerConnectionRef.current;
    if (
      !activeCall ||
      activeCall.status !== "connected" ||
      !peerConnection ||
      isScreenSharing
    ) {
      return;
    }

    if (isCameraEnabled) {
      const currentStream = localStreamRef.current;
      const videoTracks = currentStream?.getVideoTracks() ?? [];
      for (const track of videoTracks) {
        const sender = peerConnection
          .getSenders()
          .find((candidate) => candidate.track === track);
        if (sender) peerConnection.removeTrack(sender);
        track.stop();
      }
      const audioOnlyStream = new MediaStream(
        currentStream?.getAudioTracks() ?? [],
      );
      localStreamRef.current = audioOnlyStream;
      setLocalStream(audioOnlyStream);
      setIsCameraEnabled(false);
      try {
        await renegotiate();
      } catch {
        onError("The camera could not be turned off cleanly.");
      }
      return;
    }

    let cameraStream: MediaStream | null = null;
    let cameraSender: RTCRtpSender | null = null;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });
      const cameraTrack = cameraStream.getVideoTracks()[0];
      if (!cameraTrack) throw new Error("No camera is available.");

      const currentStream = localStreamRef.current;
      const nextStream = new MediaStream([
        ...(currentStream?.getAudioTracks() ?? []),
        cameraTrack,
      ]);
      cameraSender = peerConnection.addTrack(cameraTrack, nextStream);
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      setIsCameraEnabled(true);
      await renegotiate();
    } catch (requestError) {
      if (cameraSender) peerConnection.removeTrack(cameraSender);
      for (const track of cameraStream?.getTracks() ?? []) track.stop();
      const audioOnlyStream = new MediaStream(
        localStreamRef.current?.getAudioTracks() ?? [],
      );
      localStreamRef.current = audioOnlyStream;
      setLocalStream(audioOnlyStream);
      setIsCameraEnabled(false);
      onError(
        requestError instanceof Error
          ? requestError.message
          : "The camera could not be turned on.",
      );
    }
  }, [isCameraEnabled, isScreenSharing, onError, renegotiate]);

  const stopScreenShare = useCallback(async (notifyServer = true) => {
    const displayStream = screenStreamRef.current;
    const screenSender = screenSenderRef.current;
    const peerConnection = peerConnectionRef.current;
    if (!displayStream && !screenSender) return;

    screenStreamRef.current = null;
    screenSenderRef.current = null;
    for (const track of displayStream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    setScreenStream(null);
    setIsScreenSharing(false);

    try {
      if (peerConnection && screenSender) {
        peerConnection.removeTrack(screenSender);
        await renegotiate();
      }
    } catch {
      onError("Screen sharing could not be stopped cleanly.");
    } finally {
      const activeCall = callRef.current;
      if (
        notifyServer &&
        activeCall &&
        connection?.state === HubConnectionState.Connected
      ) {
        void connection.invoke("StopScreenShare", {
          callId: activeCall.callId,
          conversationId: activeCall.conversationId,
          targetUserId: activeCall.peer.id,
        });
      }
    }
  }, [connection, onError, renegotiate]);

  useEffect(() => {
    stopScreenShareRef.current = stopScreenShare;
  }, [stopScreenShare]);

  const startScreenShare = useCallback(async () => {
    const activeCall = callRef.current;
    const peerConnection = peerConnectionRef.current;
    if (
      !activeCall ||
      activeCall.status !== "connected" ||
      !peerConnection ||
      isScreenSharing
    ) {
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      onError("Screen sharing is not supported by this browser.");
      return;
    }

    let displayStream: MediaStream | null = null;
    let shareRegistered = false;
    try {
      displayStream = await acquireScreenShareStream();
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error("No screen was selected.");

      if (connection?.state !== HubConnectionState.Connected) {
        throw new Error("Live chat disconnected before screen sharing started.");
      }
      await connection.invoke("StartScreenShare", {
        callId: activeCall.callId,
        conversationId: activeCall.conversationId,
        targetUserId: activeCall.peer.id,
      });
      shareRegistered = true;

      screenSenderRef.current = peerConnection.addTrack(
        screenTrack,
        displayStream,
      );
      await optimizeScreenShareSender(screenSenderRef.current);
      await renegotiate();

      screenStreamRef.current = displayStream;
      setScreenStream(displayStream);
      setIsScreenSharing(true);
      screenTrack.onended = () => {
        void stopScreenShareRef.current();
      };
    } catch (requestError) {
      for (const track of displayStream?.getTracks() ?? []) track.stop();
      const failedSender = screenSenderRef.current;
      if (failedSender) {
        try {
          peerConnection.removeTrack(failedSender);
          if (peerConnection.signalingState === "have-local-offer") {
            await peerConnection.setLocalDescription({ type: "rollback" });
          }
        } catch {
          // The active call can continue even if browser rollback is unavailable.
        }
      }
      screenSenderRef.current = null;
      if (
        shareRegistered &&
        connection?.state === HubConnectionState.Connected
      ) {
        void connection.invoke("StopScreenShare", {
          callId: activeCall.callId,
          conversationId: activeCall.conversationId,
          targetUserId: activeCall.peer.id,
        });
      }
      if (
        requestError instanceof DOMException &&
        ["AbortError", "NotAllowedError"].includes(requestError.name)
      ) {
        return;
      }
      onError(
        requestError instanceof Error
          ? requestError.message
          : "Screen sharing could not be started.",
      );
    }
  }, [connection, isScreenSharing, onError, renegotiate]);

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
        const connectingCall = { ...activeCall, status: "connecting" as const };
        updateCall(connectingCall);
        const peerConnection = createPeerConnection(connectingCall);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await sendSignal(connectingCall, "offer", JSON.stringify(offer));
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

    const onSignal = async (event: CallSignalEvent) => {
      const activeCall = callRef.current;
      if (
        !activeCall ||
        activeCall.callId !== event.callId ||
        activeCall.peer.id !== event.senderUserId
      ) {
        return;
      }

      try {
        const peerConnection =
          peerConnectionRef.current ?? createPeerConnection(activeCall);
        if (event.signalType === "ice") {
          const candidate = JSON.parse(event.payload) as RTCIceCandidateInit;
          if (peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(candidate);
          } else {
            queuedCandidatesRef.current.push(candidate);
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
          localUserId.localeCompare(activeCall.peer.id) < 0
        ) {
          return;
        }
        if (hasOfferCollision) {
          await peerConnection.setLocalDescription({ type: "rollback" });
        }
        await peerConnection.setRemoteDescription(description);
        for (const candidate of queuedCandidatesRef.current) {
          await peerConnection.addIceCandidate(candidate);
        }
        queuedCandidatesRef.current = [];

        if (event.signalType === "offer") {
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await sendSignal(activeCall, "answer", JSON.stringify(answer));
        }
      } catch {
        onError("The call connection could not be negotiated.");
        cleanupCall();
      }
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
    connection.on("CallSignal", onSignal);
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
      connection.off("CallSignal", onSignal);
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
    createPeerConnection,
    localUserId,
    onError,
    resolveAvatarUrl,
    sendSignal,
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
