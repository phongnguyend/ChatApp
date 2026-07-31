import {
  AzureCommunicationTokenCredential,
} from "@azure/communication-common";
import {
  CallClient,
  LocalVideoStream,
  VideoStreamRenderer,
  type Call,
  type CallAgent,
  type RemoteParticipant,
  type RemoteVideoStream,
} from "@azure/communication-calling";
import type { HubConnection } from "@microsoft/signalr";
import {
  LoaderCircle,
  Mic,
  MicOff,
  MonitorUp,
  Radio,
  Square,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { acquireScreenShareStream } from "./screenShare";
import "./LiveStreams.css";

export type LiveStream = {
  conversationId: string;
  title: string;
  hostUserId: string;
  hostDisplayName: string;
  hostAvatarUrl: string | null;
  isHost: boolean;
  isJoined: boolean;
  sessionId: string | null;
  providerCallId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  memberCount: number;
  isActive: boolean;
  hostCommunicationUserId: string | null;
};

type CallingCredential = {
  provider: string;
  managedMedia: boolean;
  token: string | null;
};

type Props = {
  apiUrl: string;
  username: string;
  displayName: string;
  connection: HubConnection | null;
  isOpen: boolean;
  onClose: () => void;
  onError: (message: string) => void;
  onConversationSelected: (conversationId: string) => Promise<void>;
  requestedStream: LiveStream | null;
  onRequestedStreamOpened: () => void;
  onActiveStreamsChanged: (conversationIds: string[]) => void;
};

export function LiveStreams({
  apiUrl,
  username,
  displayName,
  connection,
  isOpen,
  onClose,
  onError,
  onConversationSelected,
  requestedStream,
  onRequestedStreamOpened,
  onActiveStreamsChanged,
}: Props) {
  const [active, setActive] = useState<LiveStream[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [watching, setWatching] = useState<LiveStream | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = `username=${encodeURIComponent(username)}`;
      const activeResponse = await fetch(
        `${apiUrl}/api/live-streams/active?${suffix}`,
      );
      if (!activeResponse.ok) throw new Error(await readError(activeResponse));
      const nextActive = (await activeResponse.json()) as LiveStream[];
      setActive(nextActive);
      onActiveStreamsChanged(
        nextActive.map((stream) => stream.conversationId),
      );
      setWatching((current) =>
        current
          ? nextActive.find((stream) =>
              stream.conversationId === current.conversationId &&
              stream.sessionId === current.sessionId) ?? null
          : null,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load live streams.");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, onActiveStreamsChanged, onError, username]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  useEffect(() => {
    if (!connection) return;
    const changed = () => void load();
    connection.on("LiveStreamsChanged", changed);
    return () => connection.off("LiveStreamsChanged", changed);
  }, [connection, load]);

  useEffect(() => {
    if (!requestedStream) return;
    setWatching(requestedStream);
    onClose();
    onRequestedStreamOpened();
  }, [onClose, onRequestedStreamOpened, requestedStream]);

  async function viewStream(stream: LiveStream) {
    setBusyId(stream.conversationId);
    try {
      let updated = stream;
      if (!stream.isHost) {
        const response = await fetch(
          `${apiUrl}/api/live-streams/${stream.conversationId}/join?username=${encodeURIComponent(username)}`,
          { method: "POST" },
        );
        if (!response.ok) throw new Error(await readError(response));
        updated = {
          ...((await response.json()) as LiveStream),
          hostCommunicationUserId: stream.hostCommunicationUserId,
        };
      }
      await connection?.invoke("JoinConversation", stream.conversationId);
      await onConversationSelected(stream.conversationId);
      await load();
      setWatching(updated);
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "The live stream action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function stopStream(stream: LiveStream) {
    try {
      const response = await fetch(
        `${apiUrl}/api/live-streams/${stream.conversationId}/stop?username=${encodeURIComponent(username)}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await readError(response));
      setWatching(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not stop the live stream.");
    }
  }

  return (
    <>
      {isOpen && (
        <div className="live-streams-backdrop" role="presentation">
          <section className="live-streams-browser" aria-label="Live streams">
            <header>
              <div><p>Broadcasts</p><h2>Live streams</h2></div>
              <button className="icon-button" onClick={onClose} aria-label="Close live streams"><X size={20} /></button>
            </header>
            <div className="live-stream-tabs">
              <span><Radio size={15} /> Active ({active.length})</span>
            </div>
            <div className="live-stream-list">
              {loading ? <div className="live-stream-empty"><LoaderCircle className="spin" /> Loading streams…</div> :
                active.length === 0 ?
                  <div className="live-stream-empty">No one is live right now.</div> :
                  active.map((stream) => (
                    <article key={`${stream.conversationId}:${stream.sessionId ?? "new"}`} className="live-stream-card">
                      <div className={`live-stream-status ${stream.isActive ? "on" : ""}`}>{stream.isActive ? "LIVE" : "ENDED"}</div>
                      <div className="live-stream-copy">
                        <strong>{stream.title}</strong>
                        <span>{stream.hostDisplayName} · {stream.isActive ? `${stream.memberCount} members` : stream.endedAt ? new Date(stream.endedAt).toLocaleString() : "Not started yet"}</span>
                      </div>
                      <button disabled={busyId !== null} onClick={() => void viewStream(stream)}>
                        {busyId === stream.conversationId ? "Opening…" : "View"}
                      </button>
                    </article>
                  ))}
            </div>
          </section>
        </div>
      )}
      {watching?.isActive && watching.providerCallId && (
        <LiveStreamStage
          stream={watching}
          apiUrl={apiUrl}
          username={username}
          displayName={displayName}
          onLeave={async () => {
            setWatching(null);
          }}
          onStop={() => void stopStream(watching)}
          onError={onError}
        />
      )}
    </>
  );
}

export function LiveStreamConversationControls({
  apiUrl,
  username,
  conversationId,
  connection,
  onOpenStage,
  onError,
}: {
  apiUrl: string;
  username: string;
  conversationId: string;
  connection: HubConnection | null;
  onOpenStage: (stream: LiveStream) => void;
  onError: (message: string) => void;
}) {
  const [stream, setStream] = useState<LiveStream | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const suffix = `username=${encodeURIComponent(username)}`;
      const [activeResponse, joinedResponse] = await Promise.all([
        fetch(`${apiUrl}/api/live-streams/active?${suffix}`),
        fetch(`${apiUrl}/api/live-streams/joined?${suffix}`),
      ]);
      if (!activeResponse.ok || !joinedResponse.ok) return;
      const activeStreams = (await activeResponse.json()) as LiveStream[];
      const joinedStreams = (await joinedResponse.json()) as LiveStream[];
      setStream(
        activeStreams.find((item) => item.conversationId === conversationId) ??
          joinedStreams.find((item) => item.conversationId === conversationId) ??
          null,
      );
    } catch {
      // The main error surface reports failures when the user takes an action.
    }
  }, [apiUrl, conversationId, username]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!connection) return;
    const changed = () => void load();
    connection.on("LiveStreamsChanged", changed);
    return () => connection.off("LiveStreamsChanged", changed);
  }, [connection, load]);

  async function change(action: "start" | "stop") {
    setBusy(true);
    try {
      const response = await fetch(
        `${apiUrl}/api/live-streams/${conversationId}/${action}?username=${encodeURIComponent(username)}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await readError(response));
      const updated = (await response.json()) as LiveStream;
      await load();
      if (action === "start") onOpenStage(updated);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The live stream action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!stream) return null;
  return (
    <div className="header-group-actions">
      {stream.isActive && (
        <button className="icon-button header-group-action" type="button" onClick={() => onOpenStage(stream)} title="View live stream" aria-label="View live stream">
          <Video size={17} />
        </button>
      )}
      {stream.isHost && (
        <button
          className={`icon-button header-group-action ${stream.isActive ? "stop-meeting-action" : ""}`}
          type="button"
          disabled={busy}
          onClick={() => void change(stream.isActive ? "stop" : "start")}
          title={stream.isActive ? "Stop live stream" : "Start live stream"}
          aria-label={stream.isActive ? "Stop live stream" : "Start live stream"}
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : stream.isActive ? <Square size={16} /> : <Radio size={16} />}
        </button>
      )}
    </div>
  );
}

function LiveStreamStage({ stream, apiUrl, username, displayName, onLeave, onStop, onError }: {
  stream: LiveStream; apiUrl: string; username: string; displayName: string;
  onLeave: () => Promise<void>; onStop: () => void; onError: (message: string) => void;
}) {
  const [call, setCall] = useState<Call | null>(null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [localVideoStreams, setLocalVideoStreams] = useState<LocalVideoStream[]>([]);
  const [muted, setMuted] = useState(!stream.isHost);
  const [cameraStream, setCameraStream] = useState<LocalVideoStream | null>(null);
  const [screenStream, setScreenStream] = useState<LocalVideoStream | null>(null);
  const [sharing, setSharing] = useState(false);
  const onLeaveRef = useRef(onLeave);
  const teardownRef = useRef<() => Promise<void>>(async () => {});
  const cameraStreamRef = useRef<LocalVideoStream | null>(null);
  const cameraMediaStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<LocalVideoStream | null>(null);
  const screenMediaStreamRef = useRef<MediaStream | null>(null);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    let activeCall: Call | null = null;
    let callAgent: CallAgent | null = null;
    let cancelled = false;
    let presenceAnnounced = false;
    let teardownPromise: Promise<void> | null = null;
    const teardown = () => {
      teardownPromise ??= (async () => {
        const streams = [...new Set([
          ...(activeCall?.localVideoStreams ?? []),
          ...(cameraStreamRef.current ? [cameraStreamRef.current] : []),
          ...(screenStreamRef.current ? [screenStreamRef.current] : []),
        ])];
        const mediaStreams = await Promise.all(
          streams.map(async (localStream) => {
            try {
              return await localStream.getMediaStream();
            } catch {
              return null;
            }
          }),
        );
        if (activeCall?.isScreenSharingOn) {
          try { await activeCall.stopScreenSharing(); } catch { /* Call may already be ending. */ }
        }
        for (const localStream of streams) {
          if (localStream.mediaStreamType !== "ScreenSharing") {
            try { await activeCall?.stopVideo(localStream); } catch { /* Call may already be ending. */ }
          }
        }
        for (const mediaStream of mediaStreams) {
          for (const track of mediaStream?.getTracks() ?? []) track.stop();
        }
        for (const track of cameraMediaStreamRef.current?.getTracks() ?? []) {
          track.stop();
        }
        for (const track of screenMediaStreamRef.current?.getTracks() ?? []) {
          track.onended = null;
          track.stop();
        }
        for (const localStream of streams) localStream.dispose();
        cameraMediaStreamRef.current = null;
        cameraStreamRef.current = null;
        screenMediaStreamRef.current = null;
        screenStreamRef.current = null;
        setCameraStream(null);
        setScreenStream(null);
        setLocalVideoStreams([]);
        setSharing(false);
        if (presenceAnnounced) {
          presenceAnnounced = false;
          await fetch(
            `${apiUrl}/api/live-streams/${stream.conversationId}/sessions/leave?username=${encodeURIComponent(username)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: stream.sessionId }),
            },
          ).catch(() => undefined);
        }
        try {
          await activeCall?.hangUp();
        } finally {
          await callAgent?.dispose();
        }
      })();
      return teardownPromise;
    };
    teardownRef.current = teardown;
    const initialize = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/calling/access?username=${encodeURIComponent(username)}`);
        if (!response.ok) throw new Error(await readError(response));
        const credential = (await response.json()) as CallingCredential;
        if (!credential.managedMedia || !credential.token) throw new Error("Azure Communication Services calling is not configured.");
        const client = new CallClient();
        const agent = await client.createCallAgent(new AzureCommunicationTokenCredential(credential.token), { displayName });
        if (cancelled) {
          await agent.dispose();
          return;
        }
        callAgent = agent;
        activeCall = agent.join({ groupId: stream.providerCallId! }, { audioOptions: { muted: !stream.isHost } });
        setCall(activeCall);
        const observed = new Set<RemoteParticipant>();
        const observedVideoStreams = new Set<RemoteVideoStream>();
        const refresh = () => {
          for (const participant of activeCall!.remoteParticipants) {
            if (!observed.has(participant)) {
              observed.add(participant);
              participant.on("videoStreamsUpdated", refresh);
            }
            for (const videoStream of participant.videoStreams) {
              if (!observedVideoStreams.has(videoStream)) {
                observedVideoStreams.add(videoStream);
                videoStream.on("isAvailableChanged", refresh);
              }
            }
          }
          setParticipants([...activeCall!.remoteParticipants]);
        };
        activeCall.on("remoteParticipantsUpdated", refresh);
        const refreshLocalVideo = () =>
          setLocalVideoStreams([...activeCall!.localVideoStreams]);
        activeCall.on("localVideoStreamsUpdated", refreshLocalVideo);
        refresh();
        refreshLocalVideo();
        if (stream.sessionId) {
          const presenceResponse = await fetch(
            `${apiUrl}/api/live-streams/${stream.conversationId}/sessions/join?username=${encodeURIComponent(username)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: stream.sessionId }),
            },
          );
          if (!presenceResponse.ok) {
            throw new Error(await readError(presenceResponse));
          }
          presenceAnnounced = true;
          if (cancelled) {
            await fetch(
              `${apiUrl}/api/live-streams/${stream.conversationId}/sessions/leave?username=${encodeURIComponent(username)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: stream.sessionId }),
              },
            ).catch(() => undefined);
            presenceAnnounced = false;
            return;
          }
        }
      } catch (error) {
        onError(error instanceof Error ? error.message : "Could not connect to the live stream.");
        await onLeaveRef.current();
      }
    };
    // React Strict Mode immediately cleans up the first development mount.
    // Deferring one task prevents two ACS calling stacks from racing each other.
    const initializationTimer = window.setTimeout(() => void initialize(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(initializationTimer);
      void teardown();
    };
  }, [
    apiUrl,
    displayName,
    onError,
    stream.conversationId,
    stream.isHost,
    stream.providerCallId,
    stream.sessionId,
    username,
  ]);

  async function toggleMute() {
    if (!call || !stream.isHost) return;
    if (muted) await call.unmute(); else await call.mute();
    setMuted(!muted);
  }

  async function toggleCamera() {
    if (!call || !stream.isHost) return;
    if (cameraStream) {
      await call.stopVideo(cameraStream);
      for (const track of cameraMediaStreamRef.current?.getTracks() ?? []) {
        track.stop();
      }
      cameraStream.dispose();
      cameraMediaStreamRef.current = null;
      cameraStreamRef.current = null;
      setCameraStream(null);
      return;
    }
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true,
    });
    const local = new LocalVideoStream(mediaStream, {
      autoDisposeOnCallEnd: false,
    });
    cameraMediaStreamRef.current = mediaStream;
    cameraStreamRef.current = local;
    try {
      await call.startVideo(local);
      setCameraStream(local);
    } catch (error) {
      for (const track of mediaStream.getTracks()) track.stop();
      local.dispose();
      cameraMediaStreamRef.current = null;
      cameraStreamRef.current = null;
      throw error;
    }
  }

  async function toggleScreen() {
    if (!call || !stream.isHost) return;
    if (screenStreamRef.current) {
      await stopHostScreenShare();
      return;
    }

    const mediaStream = await acquireScreenShareStream();
    const local = new LocalVideoStream(mediaStream, {
      autoDisposeOnCallEnd: false,
    });
    screenMediaStreamRef.current = mediaStream;
    screenStreamRef.current = local;
    const track = mediaStream.getVideoTracks()[0];
    track.onended = () => void stopHostScreenShare();
    try {
      await call.startScreenSharing(local);
      setScreenStream(local);
      setSharing(true);
    } catch (error) {
      track.onended = null;
      for (const candidate of mediaStream.getTracks()) candidate.stop();
      local.dispose();
      screenMediaStreamRef.current = null;
      screenStreamRef.current = null;
      throw error;
    }
  }

  async function stopHostScreenShare() {
    const local = screenStreamRef.current;
    const mediaStream = screenMediaStreamRef.current;
    screenStreamRef.current = null;
    screenMediaStreamRef.current = null;
    for (const track of mediaStream?.getTracks() ?? []) track.onended = null;
    try {
      if (call?.isScreenSharingOn) await call.stopScreenSharing();
    } finally {
      for (const track of mediaStream?.getTracks() ?? []) track.stop();
      local?.dispose();
      setScreenStream(null);
      setSharing(false);
    }
  }

  async function leaveStage() {
    await teardownRef.current();
    await onLeave();
  }

  async function endStream() {
    await teardownRef.current();
    onStop();
  }

  const hostRemoteParticipants = stream.isHost
    ? []
    : participants.filter((participant) =>
        participant.identifier.kind === "communicationUser" &&
        participant.identifier.communicationUserId ===
          stream.hostCommunicationUserId,
      );
  const hostRemoteStreams = hostRemoteParticipants.flatMap(
    (participant) => participant.videoStreams.map((videoStream) => ({
      participant,
      videoStream,
    })),
  );
  const hostLocalStreams = stream.isHost
    ? [...new Set([
        ...localVideoStreams,
        ...(cameraStream ? [cameraStream] : []),
        ...(screenStream ? [screenStream] : []),
      ])]
    : [];
  const hasHostVideo =
    hostLocalStreams.length > 0 ||
    hostRemoteStreams.some(({ videoStream }) => videoStream.isAvailable);
  const hasScreenShare =
    screenStream !== null ||
    hostRemoteStreams.some(({ videoStream }) =>
      videoStream.mediaStreamType === "ScreenSharing" &&
      videoStream.isAvailable);

  return (
    <div className="live-stream-stage">
      <header><div><span>LIVE</span><strong>{stream.title}</strong><small>{stream.isHost ? "You are hosting" : `Hosted by ${stream.hostDisplayName}`}</small></div></header>
      <div className={`live-stream-video-grid ${hasScreenShare ? "is-screen-sharing" : ""}`}>
        {hostLocalStreams.map((videoStream, index) => (
          <VideoSurface
            key={`${videoStream.mediaStreamType}-${index}`}
            stream={videoStream}
            label={videoStream === screenStream ? "Your screen" : "Your camera"}
            isMirrored={videoStream !== screenStream}
            variant={videoStream === screenStream ? "screen" : "camera"}
          />
        ))}
        {hostRemoteStreams.map(({ participant, videoStream }) => (
          <VideoSurface
            key={`${stream.hostCommunicationUserId}-${videoStream.id}`}
            stream={videoStream}
            label={videoStream.mediaStreamType === "ScreenSharing" ? `${participant.displayName ?? "Host"}'s screen` : participant.displayName ?? "Host"}
            isMirrored={false}
            variant={videoStream.mediaStreamType === "ScreenSharing" ? "screen" : "camera"}
          />
        ))}
        {!hasHostVideo && <div className="live-stream-waiting"><Radio size={34} /><strong>{call ? "Waiting for host video…" : "Connecting to Azure Communication Services…"}</strong></div>}
      </div>
      <footer>
        {stream.isHost && <>
          <button onClick={() => void toggleMute()}>{muted ? <MicOff /> : <Mic />}<span>{muted ? "Unmute" : "Mute"}</span></button>
          <button onClick={() => void toggleCamera()}>{cameraStream ? <VideoOff /> : <Video />}<span>{cameraStream ? "Camera off" : "Camera on"}</span></button>
          <button onClick={() => void toggleScreen()}>{sharing ? <Square /> : <MonitorUp />}<span>{sharing ? "Stop sharing" : "Share screen"}</span></button>
        </>}
        <button className="leave" onClick={() => void leaveStage()}><X /><span>Leave</span></button>
        {stream.isHost && <button className="stop" onClick={() => void endStream()}><Square /><span>End stream</span></button>}
      </footer>
    </div>
  );
}

function VideoSurface({ stream, label, isMirrored, variant }: {
  stream: LocalVideoStream | RemoteVideoStream;
  label: string;
  isMirrored: boolean;
  variant: "camera" | "screen";
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [isAvailable, setIsAvailable] = useState(
    !("isAvailable" in stream) || stream.isAvailable,
  );
  useEffect(() => {
    let renderer: VideoStreamRenderer | null = null;
    let disposed = false;
    const render = async () => {
      if ("isAvailable" in stream && !stream.isAvailable) return;
      renderer = new VideoStreamRenderer(stream);
      const view = await renderer.createView({ isMirrored });
      if (disposed) { view.dispose(); return; }
      hostRef.current?.replaceChildren(view.target);
    };
    const changed = () => {
      setIsAvailable(remote?.isAvailable ?? true);
      renderer?.dispose();
      renderer = null;
      if (hostRef.current) hostRef.current.replaceChildren();
      void render();
    };
    const remote = "isAvailable" in stream ? stream as RemoteVideoStream : null;
    setIsAvailable(remote?.isAvailable ?? true);
    remote?.on("isAvailableChanged", changed);
    void render();
    return () => {
      disposed = true;
      remote?.off("isAvailableChanged", changed);
      renderer?.dispose();
    };
  }, [isMirrored, stream]);
  if (!isAvailable) return null;
  return <div className={`live-stream-video ${variant}-video`}><div ref={hostRef} /><span>{label}</span></div>;
}

async function readError(response: Response) {
  try {
    const body = await response.json() as { message?: string; detail?: string };
    return body.message ?? body.detail ?? `Request failed (${response.status}).`;
  } catch { return `Request failed (${response.status}).`; }
}
