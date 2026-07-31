/* oxlint-disable react/only-export-components -- recording UI and its reusable lifecycle hook share private event types */
import { Circle, CircleStop, LoaderCircle } from "lucide-react";
import {
  HubConnectionState,
  type HubConnection,
} from "@microsoft/signalr";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./CallRecording.css";

export type RecordingState = {
  recordingId: string;
  startedByUserId: string;
  startedAt: string;
  status: "requesting-consent" | "recording" | "processing";
};

export type RecordingParticipant = {
  userId: string;
  displayName: string;
  stream: MediaStream | null;
  isMuted: boolean;
};

type RecordingEvent = RecordingState & {
  conversationId: string;
  sessionId: string;
  startedByDisplayName: string;
};

type ConsentEvent = {
  recording: RecordingEvent;
  isNewParticipant: boolean;
};

type UseCallRecordingOptions = {
  connection: HubConnection | null;
  apiUrl: string;
  username: string;
  conversationId: string;
  sessionId: string;
  sessionType: "direct" | "meeting";
  currentUserId: string;
  participants: RecordingParticipant[];
  sharedScreenStream: MediaStream | null;
  canStopRecording: boolean;
  onConsentDeclined: () => void;
  onError: (message: string) => void;
};

type RecorderResources = {
  mediaRecorder: MediaRecorder;
  audioContext: AudioContext;
  audioDestination: MediaStreamAudioDestinationNode;
  audioSources: Map<string, MediaStreamAudioSourceNode>;
  animationFrame: number;
  combinedStream: MediaStream;
  startedAt: number;
  recordingId: string;
};

type CachedRecordingChunk = {
  key: string;
  recordingId: string;
  sequence: number;
  blob: Blob;
};

const RECORDING_WIDTH = 1280;
const RECORDING_HEIGHT = 720;
const RECORDING_FRAMES_PER_SECOND = 24;
const MAXIMUM_CONCURRENT_UPLOADS = 2;
const RECORDING_CHUNK_DATABASE = "chatapp-recording-chunks";
const RECORDING_CHUNK_STORE = "chunks";
let recordingChunkDatabasePromise: Promise<IDBDatabase> | null = null;

function openRecordingChunkDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(
      new Error("Offline recording storage is not supported by this browser."),
    );
  }
  if (recordingChunkDatabasePromise) {
    return recordingChunkDatabasePromise;
  }
  recordingChunkDatabasePromise = new Promise<IDBDatabase>(
    (resolve, reject) => {
      const request = window.indexedDB.open(RECORDING_CHUNK_DATABASE, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (database.objectStoreNames.contains(RECORDING_CHUNK_STORE)) {
          return;
        }
        const store = database.createObjectStore(RECORDING_CHUNK_STORE, {
          keyPath: "key",
        });
        store.createIndex("recordingId", "recordingId");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new Error("Offline recording storage could not be opened."),
        );
      request.onblocked = () =>
        reject(new Error("Offline recording storage is blocked."));
    },
  );
  return recordingChunkDatabasePromise;
}

async function cacheRecordingChunk(
  recordingId: string,
  sequence: number,
  blob: Blob,
) {
  const database = await openRecordingChunkDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      RECORDING_CHUNK_STORE,
      "readwrite",
    );
    transaction.objectStore(RECORDING_CHUNK_STORE).put({
      key: `${recordingId}:${sequence}`,
      recordingId,
      sequence,
      blob,
    } satisfies CachedRecordingChunk);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ??
          new Error("A recording chunk could not be cached."),
      );
    transaction.onabort = transaction.onerror;
  });
}

async function readCachedRecordingChunk(
  recordingId: string,
  sequence: number,
) {
  const database = await openRecordingChunkDatabase();
  return new Promise<Blob>((resolve, reject) => {
    const transaction = database.transaction(
      RECORDING_CHUNK_STORE,
      "readonly",
    );
    const request = transaction
      .objectStore(RECORDING_CHUNK_STORE)
      .get(`${recordingId}:${sequence}`);
    request.onsuccess = () => {
      const cached = request.result as CachedRecordingChunk | undefined;
      if (cached) {
        resolve(cached.blob);
      } else {
        reject(new Error(`Recording chunk ${sequence} was not cached.`));
      }
    };
    request.onerror = () =>
      reject(
        request.error ??
          new Error("A cached recording chunk could not be read."),
      );
  });
}

async function deleteCachedRecordingChunk(
  recordingId: string,
  sequence: number,
) {
  const database = await openRecordingChunkDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      RECORDING_CHUNK_STORE,
      "readwrite",
    );
    transaction
      .objectStore(RECORDING_CHUNK_STORE)
      .delete(`${recordingId}:${sequence}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ??
          new Error("A cached recording chunk could not be removed."),
      );
    transaction.onabort = transaction.onerror;
  });
}

async function deleteCachedRecordingChunks(recordingId: string) {
  const database = await openRecordingChunkDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      RECORDING_CHUNK_STORE,
      "readwrite",
    );
    const request = transaction
      .objectStore(RECORDING_CHUNK_STORE)
      .index("recordingId")
      .openCursor(IDBKeyRange.only(recordingId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ??
          new Error("Cached recording chunks could not be removed."),
      );
    transaction.onabort = transaction.onerror;
  });
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds),
  );
}

class RecordingChunkUploader {
  private readonly pending: number[] = [];
  private readonly waiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private active = 0;
  private error: Error | null = null;
  private readonly recordingId: string;
  private readonly upload: (
    sequence: number,
    blob: Blob,
  ) => Promise<void>;

  constructor(
    recordingId: string,
    upload: (sequence: number, blob: Blob) => Promise<void>,
  ) {
    this.recordingId = recordingId;
    this.upload = upload;
  }

  enqueue(sequence: number) {
    if (this.error) return;
    this.pending.push(sequence);
    this.pump();
  }

  waitForDrain() {
    if (this.error) return Promise.reject(this.error);
    if (this.active === 0 && this.pending.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private pump() {
    while (
      !this.error &&
      this.active < MAXIMUM_CONCURRENT_UPLOADS &&
      this.pending.length > 0
    ) {
      const sequence = this.pending.shift()!;
      this.active += 1;
      void this.uploadWithRetry(sequence)
        .catch((error) => {
          this.error =
            error instanceof Error
              ? error
              : new Error("A recording chunk could not be uploaded.");
          this.pending.length = 0;
        })
        .finally(() => {
          this.active -= 1;
          this.pump();
          this.settleWaiters();
        });
    }
    this.settleWaiters();
  }

  private async uploadWithRetry(sequence: number) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const blob = await readCachedRecordingChunk(
          this.recordingId,
          sequence,
        );
        await this.upload(sequence, blob);
        await deleteCachedRecordingChunk(this.recordingId, sequence);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await delay(500 * 2 ** attempt);
        }
      }
    }
    throw lastError;
  }

  private settleWaiters() {
    if (this.active > 0 || this.pending.length > 0) return;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      if (this.error) {
        waiter.reject(this.error);
      } else {
        waiter.resolve();
      }
    }
  }
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds]
        .map((part) => part.toString().padStart(2, "0"))
        .join(":")
    : [minutes, seconds]
        .map((part) => part.toString().padStart(2, "0"))
        .join(":");
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const result = (await response.json()) as { message?: string };
    return result.message ?? fallback;
  } catch {
    return fallback;
  }
}

function drawStream(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: "cover" | "contain",
) {
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return false;
  }
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return false;
  const scale =
    fit === "cover"
      ? Math.max(width / sourceWidth, height / sourceHeight)
      : Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    video,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return true;
}

export function useCallRecording({
  connection,
  apiUrl,
  username,
  conversationId,
  sessionId,
  sessionType,
  currentUserId,
  participants,
  sharedScreenStream,
  canStopRecording,
  onConsentDeclined,
  onError,
}: UseCallRecordingOptions) {
  const [recording, setRecording] = useState<RecordingEvent | null>(null);
  const [consentRequest, setConsentRequest] =
    useState<ConsentEvent | null>(null);
  const [elapsedMilliseconds, setElapsedMilliseconds] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [hasLocalConsent, setHasLocalConsent] = useState(true);
  const participantsRef = useRef(participants);
  const sharedScreenRef = useRef(sharedScreenStream);
  const recorderResourcesRef = useRef<RecorderResources | null>(null);
  const chunkPersistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const chunkUploaderRef = useRef<RecordingChunkUploader | null>(null);
  const sequenceRef = useRef(0);
  const finishingRef = useRef<Promise<void> | null>(null);
  const answeredConsentRecordingIdsRef = useRef(new Set<string>());
  const stopRequestedRecordingIdsRef = useRef(new Set<string>());
  const onErrorRef = useRef(onError);
  const mountedRef = useRef(true);

  useEffect(() => {
    participantsRef.current = participants;
    sharedScreenRef.current = sharedScreenStream;
  }, [participants, sharedScreenStream]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const uploadChunk = useCallback(
    async (recordingId: string, sequence: number, chunk: Blob) => {
      const response = await fetch(
        `${apiUrl}/api/recordings/${recordingId}/chunks/${sequence}?username=${encodeURIComponent(username)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": chunk.type || "video/webm",
          },
          body: chunk,
        },
      );
      if (!response.ok) {
        throw new Error(
          await responseMessage(
            response,
            "A recording chunk could not be uploaded.",
          ),
        );
      }
    },
    [apiUrl, username],
  );

  const finishClientRecording = useCallback(
    (cancel = false) => {
      if (finishingRef.current) return finishingRef.current;
      const resources = recorderResourcesRef.current;
      if (!resources) return Promise.resolve();

      const finish = new Promise<void>((resolve) => {
        const complete = async () => {
          window.cancelAnimationFrame(resources.animationFrame);
          for (const track of resources.combinedStream.getTracks()) {
            track.stop();
          }
          await resources.audioContext.close().catch(() => undefined);

          try {
            await chunkPersistenceQueueRef.current;
            await chunkUploaderRef.current?.waitForDrain();
            const endpoint = cancel ? "cancel" : "complete";
            const response = await fetch(
              `${apiUrl}/api/recordings/${resources.recordingId}/${endpoint}?username=${encodeURIComponent(username)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: cancel
                  ? undefined
                  : JSON.stringify({
                      durationMilliseconds: Math.round(
                        performance.now() - resources.startedAt,
                      ),
                    }),
              },
            );
            if (!response.ok) {
              throw new Error(
                await responseMessage(
                  response,
                  "The recording could not be finalized.",
                ),
              );
            }
          } catch (error) {
            if (!cancel) {
              await fetch(
                `${apiUrl}/api/recordings/${resources.recordingId}/cancel?username=${encodeURIComponent(username)}`,
                { method: "POST" },
              ).catch(() => undefined);
            }
            await deleteCachedRecordingChunks(
              resources.recordingId,
            ).catch(() => undefined);
            if (mountedRef.current) {
              onError(
                error instanceof Error
                  ? error.message
                  : "The recording could not be finalized.",
              );
            }
          } finally {
            recorderResourcesRef.current = null;
            chunkUploaderRef.current = null;
            finishingRef.current = null;
            resolve();
          }
        };

        if (resources.mediaRecorder.state === "inactive") {
          void complete();
        } else {
          resources.mediaRecorder.addEventListener(
            "stop",
            () => void complete(),
            { once: true },
          );
          try {
            resources.mediaRecorder.requestData();
          } catch {
            // Some browsers do not allow requestData immediately before stop.
          }
          resources.mediaRecorder.stop();
        }
      });
      finishingRef.current = finish;
      return finish;
    },
    [apiUrl, onError, username],
  );

  const startClientRecorder = useCallback(
    async (state: RecordingEvent) => {
      if (
        recorderResourcesRef.current ||
        typeof MediaRecorder === "undefined"
      ) {
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = RECORDING_WIDTH;
      canvas.height = RECORDING_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The recording canvas is unavailable.");

      const videos = new Map<string, HTMLVideoElement>();
      const videoForStream = (stream: MediaStream | null) => {
        if (!stream || !stream.getVideoTracks().length) return null;
        const existing = videos.get(stream.id);
        if (existing) return existing;
        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        void video.play().catch(() => undefined);
        videos.set(stream.id, video);
        return video;
      };

      let startedAt = 0;
      let animationFrame = 0;
      let previousFrameAt = Number.NEGATIVE_INFINITY;
      const frameInterval = 1000 / RECORDING_FRAMES_PER_SECOND;
      const drawParticipant = (
        participant: RecordingParticipant,
        x: number,
        y: number,
        width: number,
        height: number,
      ) => {
        context.fillStyle = "#102326";
        context.fillRect(x, y, width, height);
        const drewVideo = drawStream(
          context,
          videoForStream(participant.stream),
          x,
          y,
          width,
          height,
          "cover",
        );
        if (!drewVideo) {
          context.fillStyle = "#dff5ef";
          context.font = `600 ${Math.max(30, height / 5)}px system-ui`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(
            participant.displayName.slice(0, 2).toUpperCase(),
            x + width / 2,
            y + height / 2,
          );
        }
        context.fillStyle = "rgba(2, 12, 14, .78)";
        const labelHeight = Math.min(42, Math.max(28, height * 0.25));
        context.fillRect(
          x,
          y + height - labelHeight,
          width,
          labelHeight,
        );
        context.fillStyle = "#fff";
        context.font = `600 ${Math.min(20, Math.max(14, height / 7))}px system-ui`;
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.fillText(
          `${participant.isMuted ? "🔇 " : ""}${participant.displayName}`,
          x + 18,
          y + height - labelHeight / 2,
          width - 36,
        );
      };

      const draw = (frameTime: number) => {
        animationFrame = window.requestAnimationFrame(draw);
        if (frameTime - previousFrameAt < frameInterval) return;
        previousFrameAt = Number.isFinite(previousFrameAt)
          ? frameTime - ((frameTime - previousFrameAt) % frameInterval)
          : frameTime;
        const currentParticipants = participantsRef.current;
        const screen = sharedScreenRef.current;
        context.fillStyle = "#061416";
        context.fillRect(0, 0, canvas.width, canvas.height);

        if (screen?.getVideoTracks().length) {
          drawStream(
            context,
            videoForStream(screen),
            0,
            0,
            canvas.width,
            canvas.height,
            "contain",
          );
          const tileWidth = 170;
          const tileHeight = 96;
          currentParticipants.slice(0, 7).forEach((participant, index) => {
            drawParticipant(
              participant,
              16 + index * (tileWidth + 10),
              16,
              tileWidth,
              tileHeight,
            );
          });
        } else {
          const count = Math.max(1, currentParticipants.length);
          const columns = Math.ceil(Math.sqrt(count));
          const rows = Math.ceil(count / columns);
          const gap = 18;
          const width = (canvas.width - gap * (columns + 1)) / columns;
          const height = (canvas.height - gap * (rows + 1)) / rows;
          currentParticipants.forEach((participant, index) => {
            drawParticipant(
              participant,
              gap + (index % columns) * (width + gap),
              gap + Math.floor(index / columns) * (height + gap),
              width,
              height,
            );
          });
        }

        const elapsed = formatDuration(
          startedAt > 0 ? performance.now() - startedAt : 0,
        );
        context.fillStyle = "rgba(5, 13, 15, .82)";
        context.fillRect(canvas.width - 265, canvas.height - 72, 241, 48);
        context.fillStyle = "#ff5f5f";
        context.beginPath();
        context.arc(canvas.width - 240, canvas.height - 48, 8, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#fff";
        context.font = "600 24px system-ui";
        context.textAlign = "left";
        context.fillText(`Recording ${elapsed}`, canvas.width - 220, canvas.height - 47);
        if (recorderResourcesRef.current) {
          recorderResourcesRef.current.animationFrame = animationFrame;
        }
      };
      animationFrame = window.requestAnimationFrame(draw);

      const AudioContextConstructor =
        window.AudioContext ??
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error("Audio mixing is not supported by this browser.");
      }
      const audioContext = new AudioContextConstructor();
      await audioContext.resume();
      const destination = audioContext.createMediaStreamDestination();
      const mixedStreamIds = new Set<string>();
      const audioSources = new Map<string, MediaStreamAudioSourceNode>();
      for (const participant of participantsRef.current) {
        const stream = participant.stream;
        if (
          !stream?.getAudioTracks().length ||
          mixedStreamIds.has(stream.id)
        ) {
          continue;
        }
        mixedStreamIds.add(stream.id);
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(destination);
        audioSources.set(stream.id, source);
      }

      const videoStream = canvas.captureStream(
        RECORDING_FRAMES_PER_SECOND,
      );
      const combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);
      const mimeType = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) {
        throw new Error("WebM call recording is not supported by this browser.");
      }

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
      });
      sequenceRef.current = 0;
      chunkPersistenceQueueRef.current = Promise.resolve();
      chunkUploaderRef.current = new RecordingChunkUploader(
        state.recordingId,
        (sequence, blob) =>
          uploadChunk(state.recordingId, sequence, blob),
      );
      mediaRecorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        const sequence = sequenceRef.current++;
        chunkPersistenceQueueRef.current =
          chunkPersistenceQueueRef.current.then(async () => {
            await cacheRecordingChunk(
              state.recordingId,
              sequence,
              event.data,
            );
            chunkUploaderRef.current?.enqueue(sequence);
          });
      };
      mediaRecorder.onerror = () => {
        void finishClientRecording(true);
        onError("The browser recorder failed.");
      };
      startedAt = performance.now();
      recorderResourcesRef.current = {
        mediaRecorder,
        audioContext,
        audioDestination: destination,
        audioSources,
        animationFrame,
        combinedStream,
        startedAt,
        recordingId: state.recordingId,
      };
      mediaRecorder.start(5_000);
    },
    [finishClientRecording, onError, uploadChunk],
  );

  useEffect(() => {
    const resources = recorderResourcesRef.current;
    if (!resources) return;
    const currentStreamIds = new Set(
      participants
        .map((participant) => participant.stream?.id)
        .filter((id): id is string => Boolean(id)),
    );
    for (const [streamId, source] of resources.audioSources) {
      if (currentStreamIds.has(streamId)) continue;
      source.disconnect();
      resources.audioSources.delete(streamId);
    }
    for (const participant of participants) {
      const stream = participant.stream;
      if (
        !stream?.getAudioTracks().length ||
        resources.audioSources.has(stream.id)
      ) {
        continue;
      }
      const source = resources.audioContext.createMediaStreamSource(stream);
      source.connect(resources.audioDestination);
      resources.audioSources.set(stream.id, source);
    }
  }, [participants]);

  useEffect(() => {
    if (!connection) return;
    const matchesSession = (event: RecordingEvent) =>
      event.conversationId === conversationId &&
      event.sessionId === sessionId;
    const onConsentRequested = (event: ConsentEvent) => {
      if (!matchesSession(event.recording)) return;
      if (event.recording.startedByUserId === currentUserId) {
        answeredConsentRecordingIdsRef.current.add(
          event.recording.recordingId,
        );
        setRecording(event.recording);
        setConsentRequest(null);
        setHasLocalConsent(true);
        return;
      }
      if (
        answeredConsentRecordingIdsRef.current.has(
          event.recording.recordingId,
        )
      ) {
        return;
      }
      setRecording(event.recording);
      setConsentRequest((current) =>
        current?.recording.recordingId === event.recording.recordingId
          ? current
          : event,
      );
      setHasLocalConsent(false);
    };
    const onStarted = (event: RecordingEvent) => {
      if (!matchesSession(event)) return;
      answeredConsentRecordingIdsRef.current.add(event.recordingId);
      stopRequestedRecordingIdsRef.current.delete(event.recordingId);
      setRecording(event);
      setConsentRequest(null);
      setHasLocalConsent(true);
      setIsStopping(false);
      if (event.startedByUserId === currentUserId) {
        void startClientRecorder(event).catch((error) => {
          onError(
            error instanceof Error
              ? error.message
              : "Recording could not be started.",
          );
          void fetch(
            `${apiUrl}/api/recordings/${event.recordingId}/cancel?username=${encodeURIComponent(username)}`,
            { method: "POST" },
          );
        });
      }
    };
    const onStopped = (event: RecordingEvent) => {
      if (!matchesSession(event)) return;
      setRecording(event);
      setIsStopping(false);
      stopRequestedRecordingIdsRef.current.delete(event.recordingId);
    };
    const onConsentDeclinedEvent = (event: RecordingEvent) => {
      if (!matchesSession(event)) return;
      setConsentRequest(null);
      setHasLocalConsent(false);
      onConsentDeclined();
    };
    const onStopRequested = (event: RecordingEvent) => {
      if (!matchesSession(event) || event.startedByUserId !== currentUserId) {
        return;
      }
      if (stopRequestedRecordingIdsRef.current.has(event.recordingId)) {
        return;
      }
      stopRequestedRecordingIdsRef.current.add(event.recordingId);
      setIsStopping(true);
      setRecording((current) =>
        current?.recordingId === event.recordingId
          ? { ...current, status: "processing" }
          : current,
      );
      void finishClientRecording();
    };
    const onFailed = (event: {
      recording: RecordingEvent;
      message: string;
    }) => {
      if (!matchesSession(event.recording)) return;
      setRecording(null);
      setConsentRequest(null);
      setHasLocalConsent(true);
      setIsStopping(false);
      stopRequestedRecordingIdsRef.current.delete(
        event.recording.recordingId,
      );
      if (recorderResourcesRef.current) {
        void finishClientRecording(true);
      }
      onError(event.message);
    };
    const onCompleted = (event: { recording: RecordingEvent }) => {
      if (!matchesSession(event.recording)) return;
      setRecording(null);
      setElapsedMilliseconds(0);
      setIsStopping(false);
      stopRequestedRecordingIdsRef.current.delete(
        event.recording.recordingId,
      );
    };

    connection.on("RequestRecordingConsent", onConsentRequested);
    connection.on("RecordingStarted", onStarted);
    connection.on("RecordingStopped", onStopped);
    connection.on("RecordingConsentDeclined", onConsentDeclinedEvent);
    connection.on("RecordingStopRequested", onStopRequested);
    connection.on("RecordingFailed", onFailed);
    connection.on("RecordingCompleted", onCompleted);
    if (
      connection.state === HubConnectionState.Connected &&
      sessionId
    ) {
      void connection
        .invoke<{
          recording: RecordingEvent;
          requiresConsent: boolean;
        } | null>("GetActiveRecording", sessionId)
        .then((active) => {
          if (!active || !matchesSession(active.recording)) return;
          const alreadyAnswered =
            answeredConsentRecordingIdsRef.current.has(
              active.recording.recordingId,
            );
          if (active.requiresConsent && alreadyAnswered) return;
          setRecording(active.recording);
          setHasLocalConsent(!active.requiresConsent || alreadyAnswered);
          if (active.requiresConsent && !alreadyAnswered) {
            setConsentRequest({
              recording: active.recording,
              isNewParticipant: true,
            });
          }
        })
        .catch(() => undefined);
    }
    return () => {
      connection.off("RequestRecordingConsent", onConsentRequested);
      connection.off("RecordingStarted", onStarted);
      connection.off("RecordingStopped", onStopped);
      connection.off("RecordingConsentDeclined", onConsentDeclinedEvent);
      connection.off("RecordingStopRequested", onStopRequested);
      connection.off("RecordingFailed", onFailed);
      connection.off("RecordingCompleted", onCompleted);
    };
  }, [
    apiUrl,
    connection,
    conversationId,
    currentUserId,
    finishClientRecording,
    onError,
    onConsentDeclined,
    sessionId,
    startClientRecorder,
    username,
  ]);

  useEffect(() => {
    if (!recording || recording.status === "requesting-consent") {
      setElapsedMilliseconds(0);
      return;
    }
    const started = new Date(recording.startedAt).getTime();
    const update = () => setElapsedMilliseconds(Date.now() - started);
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!recording || recording.status !== "processing") return;

    let disposed = false;
    const recordingId = recording.recordingId;
    const reconcileStatus = async () => {
      try {
        const response = await fetch(
          `${apiUrl}/api/recordings/${recordingId}?username=${encodeURIComponent(username)}`,
        );
        if (!response.ok || disposed) return;
        const current = (await response.json()) as {
          recordingId: string;
          status: string;
        };
        if (
          current.recordingId !== recordingId ||
          !["completed", "failed", "cancelled"].includes(current.status)
        ) {
          return;
        }

        setRecording((value) =>
          value?.recordingId === recordingId ? null : value,
        );
        setElapsedMilliseconds(0);
        setIsStopping(false);
        stopRequestedRecordingIdsRef.current.delete(recordingId);
        if (current.status !== "completed") {
          onErrorRef.current(
            current.status === "failed"
              ? "The recording could not be processed."
              : "The recording was cancelled.",
          );
        }
      } catch {
        // SignalR remains the primary path; retry reconciliation shortly.
      }
    };

    void reconcileStatus();
    const timer = window.setInterval(() => {
      void reconcileStatus();
    }, 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [apiUrl, recording, username]);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        if (recorderResourcesRef.current) {
          void finishClientRecording();
        }
      };
    },
    [finishClientRecording],
  );

  const startRecording = useCallback(async () => {
    if (
      isStarting ||
      recording ||
      connection?.state !== HubConnectionState.Connected
    ) {
      return;
    }
    if (
      typeof MediaRecorder === "undefined" ||
      !HTMLCanvasElement.prototype.captureStream
    ) {
      onError("Call recording is not supported by this browser.");
      return;
    }

    setIsStarting(true);
    let createdRecordingId: string | null = null;
    try {
      const response = await fetch(
        `${apiUrl}/api/recordings?username=${encodeURIComponent(username)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            sessionId,
            sessionType,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await responseMessage(response, "Recording could not be requested."),
        );
      }
      const created = (await response.json()) as RecordingEvent;
      createdRecordingId = created.recordingId;
      setRecording(created);
      await connection.invoke("RequestRecordingConsent", created.recordingId);
    } catch (error) {
      setRecording(null);
      if (createdRecordingId) {
        await fetch(
          `${apiUrl}/api/recordings/${createdRecordingId}/cancel?username=${encodeURIComponent(username)}`,
          { method: "POST" },
        ).catch(() => undefined);
      }
      onError(
        error instanceof Error
          ? error.message
          : "Recording could not be requested.",
      );
    } finally {
      setIsStarting(false);
    }
  }, [
    apiUrl,
    connection,
    conversationId,
    isStarting,
    onError,
    recording,
    sessionId,
    sessionType,
    username,
  ]);

  const respondToConsent = useCallback(
    async (accepted: boolean) => {
      if (
        !consentRequest ||
        connection?.state !== HubConnectionState.Connected
      ) {
        return;
      }
      const request = consentRequest;
      const recordingId = request.recording.recordingId;
      answeredConsentRecordingIdsRef.current.add(recordingId);
      setConsentRequest((current) =>
        current?.recording.recordingId === recordingId ? null : current,
      );
      setHasLocalConsent(accepted);
      try {
        await connection.invoke("RespondToRecordingConsent", {
          recordingId,
          accepted,
        });
      } catch {
        answeredConsentRecordingIdsRef.current.delete(recordingId);
        setConsentRequest(request);
        setHasLocalConsent(false);
        onError("Recording consent could not be submitted.");
      }
    },
    [connection, consentRequest, onError],
  );

  const stopRecording = useCallback(async () => {
    if (
      !recording ||
      isStopping ||
      connection?.state !== HubConnectionState.Connected
    ) {
      return;
    }
    setIsStopping(true);
    try {
      await connection.invoke("StopRecording", recording.recordingId);
    } catch {
      setIsStopping(false);
      onError("Recording could not be stopped.");
    }
  }, [connection, isStopping, onError, recording]);

  return {
    recording,
    consentRequest,
    elapsedMilliseconds,
    isStarting,
    isStopping,
    hasLocalConsent,
    canStop:
      Boolean(recording) &&
      (recording?.startedByUserId === currentUserId || canStopRecording),
    startRecording,
    stopRecording,
    respondToConsent,
  };
}

export type CallRecordingController = ReturnType<typeof useCallRecording>;

export function CallRecordingControls({
  controller,
  showWhenIdle = true,
}: {
  controller: CallRecordingController;
  showWhenIdle?: boolean;
}) {
  const {
    recording,
    elapsedMilliseconds,
    isStarting,
    isStopping,
    canStop,
    startRecording,
    stopRecording,
  } = controller;

  if (!recording) {
    if (!showWhenIdle) return null;
    return (
      <button
        type="button"
        className="start-recording"
        disabled={isStarting}
        aria-label="Start recording"
        title="Start recording"
        onClick={() => void startRecording()}
      >
        {isStarting ? (
          <LoaderCircle className="recording-spinner" size={20} />
        ) : (
          <Circle size={20} />
        )}
      </button>
    );
  }

  if (showWhenIdle) return null;

  return (
    <div className="recording-status">
      <span className="recording-dot" aria-hidden="true" />
      <span>
        {isStopping
          ? "Stopping recording"
          : recording.status === "requesting-consent"
          ? "Waiting for consent"
          : recording.status === "processing"
            ? "Processing recording"
            : `Recording ${formatDuration(elapsedMilliseconds)}`}
      </span>
      <small>Started by {recording.startedByDisplayName}</small>
      {canStop && recording.status === "recording" ? (
        <button
          type="button"
          aria-label="Stop recording"
          title="Stop recording"
          disabled={isStopping}
          onClick={() => void stopRecording()}
        >
          <CircleStop size={19} />
        </button>
      ) : null}
    </div>
  );
}

export function RecordingConsentDialog({
  controller,
}: {
  controller: CallRecordingController;
}) {
  const { consentRequest, respondToConsent } = controller;
  if (!consentRequest) return null;
  return createPortal(
    <div className="recording-consent-backdrop">
      <section
        className="recording-consent-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="Recording consent"
      >
        <span className="recording-consent-icon">
          <Circle size={24} />
        </span>
        <h2>Allow call recording?</h2>
        <p>
          {consentRequest.recording.startedByDisplayName} wants to record
          this call. Your camera, shared screen, and audio may be included.
        </p>
        {consentRequest.isNewParticipant ? (
          <p>You must accept before call media can be connected.</p>
        ) : null}
        <div>
          <button
            type="button"
            className="decline-recording"
            onClick={() => void respondToConsent(false)}
          >
            Decline
          </button>
          <button
            type="button"
            className="accept-recording"
            onClick={() => void respondToConsent(true)}
          >
            Accept
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
