import { AzureCommunicationTokenCredential } from "@azure/communication-common";
import {
  CallClient,
  LocalVideoStream,
  type Call,
  type CallAgent,
  type RemoteParticipant,
  type RemoteVideoStream,
} from "@azure/communication-calling";
import { useCallback, useEffect, useRef, useState } from "react";
import { acquireScreenShareStream } from "./screenShare";

type CallingCredential = {
  managedMedia: boolean;
  token: string | null;
};

type Options = {
  active: boolean;
  apiUrl: string;
  username: string;
  groupId: string | null;
  userId: string;
  displayName: string;
  initialMicrophoneEnabled: boolean;
  initialCameraEnabled: boolean;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError: (message: string) => void;
};

const participantTag = (displayName: string, userId: string) =>
  `${displayName}\u2063${userId}`;

const taggedUserId = (participant: RemoteParticipant) => {
  const value = participant.displayName ?? "";
  const separator = value.lastIndexOf("\u2063");
  return separator < 0 ? null : value.slice(separator + 1);
};

export function useAzureCommunicationCall({
  active,
  apiUrl,
  username,
  groupId,
  userId,
  displayName,
  initialMicrophoneEnabled,
  initialCameraEnabled,
  onConnected,
  onDisconnected,
  onError,
}: Options) {
  const [call, setCall] = useState<Call | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(!initialMicrophoneEnabled);
  const [isCameraEnabled, setIsCameraEnabled] = useState(initialCameraEnabled);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const callRef = useRef<Call | null>(null);
  const agentRef = useRef<CallAgent | null>(null);
  const cameraRef = useRef<LocalVideoStream | null>(null);
  const cameraMediaRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<LocalVideoStream | null>(null);
  const screenMediaRef = useRef<MediaStream | null>(null);
  const stopScreenShareRef = useRef<() => Promise<void>>(async () => {});
  const initialMediaRef = useRef({
    microphoneEnabled: initialMicrophoneEnabled,
    cameraEnabled: initialCameraEnabled,
  });
  if (!active) {
    initialMediaRef.current = {
      microphoneEnabled: initialMicrophoneEnabled,
      cameraEnabled: initialCameraEnabled,
    };
  }
  const onConnectedRef = useRef(onConnected);
  const onDisconnectedRef = useRef(onDisconnected);
  const onErrorRef = useRef(onError);
  onConnectedRef.current = onConnected;
  onDisconnectedRef.current = onDisconnected;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!active || !groupId) return;
    const initialMedia = initialMediaRef.current;
    setIsMuted(!initialMedia.microphoneEnabled);
    setIsCameraEnabled(initialMedia.cameraEnabled);
    let cancelled = false;
    let connectedOnce = false;
    let initializationTimer = 0;
    const participantListeners = new Map<RemoteParticipant, () => void>();
    const streamListeners = new Map<RemoteVideoStream, () => void>();

    const refreshRemoteStreams = async () => {
      const activeCall = callRef.current;
      if (!activeCall || cancelled) return;
      const entries = await Promise.all(
        activeCall.remoteParticipants.map(async (participant) => {
          const appUserId = taggedUserId(participant);
          if (!appUserId) return null;
          if (!participantListeners.has(participant)) {
            const changed = () => void refreshRemoteStreams();
            participantListeners.set(participant, changed);
            participant.on("videoStreamsUpdated", changed);
          }
          const available = participant.videoStreams
            .filter((stream) => stream.isAvailable)
            .sort((left, right) =>
              Number(left.mediaStreamType === "ScreenSharing") -
              Number(right.mediaStreamType === "ScreenSharing"),
            );
          for (const stream of participant.videoStreams) {
            if (streamListeners.has(stream)) continue;
            const changed = () => void refreshRemoteStreams();
            streamListeners.set(stream, changed);
            stream.on("isAvailableChanged", changed);
          }
          const media = await Promise.all(
            available.map((stream) => stream.getMediaStream().catch(() => null)),
          );
          const tracks = media.flatMap((item) => item?.getTracks() ?? []);
          return [appUserId, new MediaStream(tracks)] as const;
        }),
      );
      if (!cancelled) {
        setRemoteStreams(Object.fromEntries(entries.filter((entry) => entry !== null)));
      }
    };

    const initialize = async () => {
      try {
        const response = await fetch(
          `${apiUrl}/api/calling/access?username=${encodeURIComponent(username)}`,
        );
        if (!response.ok) throw new Error("Calling access could not be created.");
        const credential = (await response.json()) as CallingCredential;
        if (!credential.managedMedia || !credential.token) {
          throw new Error("Azure Communication Services calling is not configured.");
        }
        let cameraMedia: MediaStream | null = null;
        let camera: LocalVideoStream | null = null;
        if (initialMedia.cameraEnabled) {
          cameraMedia = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          camera = new LocalVideoStream(cameraMedia, { autoDisposeOnCallEnd: false });
        }
        if (cancelled) {
          for (const track of cameraMedia?.getTracks() ?? []) track.stop();
          camera?.dispose();
          return;
        }
        cameraMediaRef.current = cameraMedia;
        cameraRef.current = camera;
        setLocalStream(cameraMedia);
        const client = new CallClient();
        const agent = await client.createCallAgent(
          new AzureCommunicationTokenCredential(credential.token),
          { displayName: participantTag(displayName, userId) },
        );
        if (cancelled) {
          await agent.dispose();
          return;
        }
        agentRef.current = agent;
        const joined = agent.join(
          { groupId },
          {
            audioOptions: { muted: !initialMedia.microphoneEnabled },
            videoOptions: camera ? { localVideoStreams: [camera] } : undefined,
          },
        );
        callRef.current = joined;
        setCall(joined);
        const stateChanged = () => {
          if (joined.state === "Connected") {
            connectedOnce = true;
            setIsConnected(true);
            onConnectedRef.current?.();
          } else if (joined.state === "Disconnected" && connectedOnce && !cancelled) {
            setIsConnected(false);
            onDisconnectedRef.current?.();
          }
        };
        joined.on("stateChanged", stateChanged);
        joined.on("remoteParticipantsUpdated", () => void refreshRemoteStreams());
        stateChanged();
        void refreshRemoteStreams();
      } catch (error) {
        if (!cancelled) {
          onErrorRef.current(error instanceof Error ? error.message : "The ACS call could not be connected.");
          onDisconnectedRef.current?.();
        }
      }
    };
    initializationTimer = window.setTimeout(() => void initialize(), 0);

    return () => {
      cancelled = true;
      window.clearTimeout(initializationTimer);
      for (const [participant, listener] of participantListeners) {
        participant.off("videoStreamsUpdated", listener);
      }
      for (const [stream, listener] of streamListeners) {
        stream.off("isAvailableChanged", listener);
      }
      const activeCall = callRef.current;
      const agent = agentRef.current;
      const localVideoStreams = [cameraRef.current, screenRef.current];
      callRef.current = null;
      agentRef.current = null;
      const media = [cameraMediaRef.current, screenMediaRef.current];
      cameraMediaRef.current = null;
      screenMediaRef.current = null;
      cameraRef.current = null;
      screenRef.current = null;
      setCall(null);
      setLocalStream(null);
      setRemoteStreams({});
      setIsConnected(false);
      setIsScreenSharing(false);
      void (async () => {
        try { await activeCall?.hangUp(); } catch { /* The call may already be closed. */ }
        for (const stream of media) {
          for (const track of stream?.getTracks() ?? []) track.stop();
        }
        for (const stream of localVideoStreams) stream?.dispose();
        await agent?.dispose();
      })();
    };
  }, [active, apiUrl, displayName, groupId, userId, username]);

  const toggleMute = useCallback(async () => {
    const activeCall = callRef.current;
    if (!activeCall) return;
    const next = !activeCall.isMuted;
    if (next) await activeCall.mute(); else await activeCall.unmute();
    setIsMuted(next);
  }, []);

  const toggleCamera = useCallback(async () => {
    const activeCall = callRef.current;
    if (!activeCall) return;
    if (cameraRef.current) {
      await activeCall.stopVideo(cameraRef.current);
      for (const track of cameraMediaRef.current?.getTracks() ?? []) track.stop();
      cameraRef.current.dispose();
      cameraRef.current = null;
      cameraMediaRef.current = null;
      setLocalStream(null);
      setIsCameraEnabled(false);
      return;
    }
    const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    const camera = new LocalVideoStream(media, { autoDisposeOnCallEnd: false });
    try {
      await activeCall.startVideo(camera);
      cameraMediaRef.current = media;
      cameraRef.current = camera;
      setLocalStream(media);
      setIsCameraEnabled(true);
    } catch (error) {
      for (const track of media.getTracks()) track.stop();
      camera.dispose();
      throw error;
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    const activeCall = callRef.current;
    if (!activeCall || screenRef.current) return;
    const media = await acquireScreenShareStream();
    const screen = new LocalVideoStream(media, { autoDisposeOnCallEnd: false });
    try {
      await activeCall.startScreenSharing(screen);
      screenMediaRef.current = media;
      screenRef.current = screen;
      setIsScreenSharing(true);
      media.getVideoTracks()[0]!.onended = () => void stopScreenShareRef.current();
    } catch (error) {
      for (const track of media.getTracks()) track.stop();
      screen.dispose();
      throw error;
    }
  }, []);

  const stopScreenShare = useCallback(async () => {
    const activeCall = callRef.current;
    const screen = screenRef.current;
    const media = screenMediaRef.current;
    if (!screen) return;
    screenRef.current = null;
    screenMediaRef.current = null;
    try { await activeCall?.stopScreenSharing(); } finally {
      for (const track of media?.getTracks() ?? []) {
        track.onended = null;
        track.stop();
      }
      screen.dispose();
      setIsScreenSharing(false);
    }
  }, []);
  stopScreenShareRef.current = stopScreenShare;

  return {
    call,
    localStream,
    remoteStreams,
    screenStream: screenMediaRef.current,
    isConnected,
    isMuted,
    isCameraEnabled,
    isScreenSharing,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
  };
}
