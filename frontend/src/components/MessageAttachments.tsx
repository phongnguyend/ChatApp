import {
  Camera,
  Download,
  FileText,
  LoaderCircle,
  Mic,
  MonitorUp,
  Paperclip,
  Square,
  Video,
  X,
} from 'lucide-react'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import {
  formatMediaDuration,
  resolveUnknownVideoDuration,
} from './mediaDuration'

export type ChatAttachment = {
  id: string
  fileName: string
  contentType: string
  fileSize: number
  width: number | null
  height: number | null
  durationMs: number | null
}

type MessageAttachmentPickerProps = {
  files: File[]
  disabled?: boolean
  onChange: (files: File[]) => void
  onError: (message: string) => void
}

const MAX_FILES = 5
const MAX_FILE_SIZE = 15 * 1024 * 1024
const MAX_RECORDING_SECONDS = 30
type CaptureMode = 'photo' | 'video' | 'screen' | 'audio'

export function MessageAttachmentPicker({
  files,
  disabled = false,
  onChange,
  onError,
}: MessageAttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingIntervalRef = useRef<number | null>(null)
  const recordingTimeoutRef = useRef<number | null>(null)
  const discardRecordingRef = useRef(false)
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)

  useEffect(() => {
    if (!captureMode) return

    if (captureMode === 'audio') {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Microphone access is not supported in this browser.')
        return
      }

      let cancelled = false
      setIsCameraReady(false)
      setCameraError('')
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((track) => track.stop())
            return
          }

          audioStreamRef.current = stream
          setIsCameraReady(true)
        })
        .catch((microphoneError: unknown) => {
          setCameraError(
            microphoneError instanceof DOMException &&
              microphoneError.name === 'NotAllowedError'
              ? 'Microphone permission was denied. Allow access and try again.'
              : 'Could not open the microphone. Check that another app is not using it.',
          )
        })

      return () => {
        cancelled = true
        discardRecordingRef.current = true
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop()
        }
        clearRecordingTimers()
        audioStreamRef.current?.getTracks().forEach((track) => track.stop())
        audioStreamRef.current = null
      }
    }

    if (captureMode === 'screen') {
      const stream = screenStreamRef.current
      const videoElement = videoRef.current
      if (!stream || !videoElement) {
        setCameraError('Could not preview the selected screen.')
        return
      }

      const screenTrack = stream.getVideoTracks()[0]
      const handleScreenEnded = () => {
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop()
        } else {
          setCaptureMode(null)
        }
      }

      videoElement.srcObject = stream
      screenTrack?.addEventListener('ended', handleScreenEnded)

      return () => {
        screenTrack?.removeEventListener('ended', handleScreenEnded)
        discardRecordingRef.current = true
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop()
        }
        clearRecordingTimers()
        stream.getTracks().forEach((track) => track.stop())
        screenStreamRef.current = null
        videoElement.srcObject = null
      }
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not supported in this browser.')
      return
    }

    let stream: MediaStream | null = null
    let cancelled = false
    const videoElement = videoRef.current
    setIsCameraReady(false)
    setCameraError('')

    navigator.mediaDevices
      .getUserMedia({
        audio: captureMode === 'video',
        video: { facingMode: { ideal: 'environment' } },
      })
      .then((nextStream) => {
        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop())
          return
        }

        stream = nextStream
        if (videoElement) videoElement.srcObject = nextStream
      })
      .catch((cameraAccessError: unknown) => {
        setCameraError(
          cameraAccessError instanceof DOMException &&
            cameraAccessError.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access and try again.'
            : 'Could not open the camera. Check that another app is not using it.',
        )
      })

    return () => {
      cancelled = true
      discardRecordingRef.current = true
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop()
      }
      clearRecordingTimers()
      stream?.getTracks().forEach((track) => track.stop())
      if (videoElement) videoElement.srcObject = null
    }
  }, [captureMode])

  useEffect(() => {
    if (disabled) closeCapture()
  }, [disabled])

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    addFiles(selected)
  }

  function addFiles(selected: File[]) {
    if (files.length + selected.length > MAX_FILES) {
      onError('Add up to 5 attachments per message.')
      return
    }

    const oversized = selected.find((file) => file.size > MAX_FILE_SIZE)
    if (oversized) {
      onError(`"${oversized.name}" is larger than 15 MB.`)
      return
    }

    onChange([...files, ...selected])
  }

  async function takePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      setCameraError('Could not capture the photo.')
      return
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    )
    if (!blob) {
      setCameraError('Could not capture the photo.')
      return
    }

    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-')
    addFiles([
      new File([blob], `photo-${timestamp}.jpg`, { type: 'image/jpeg' }),
    ])
    setCaptureMode(null)
  }

  function clearRecordingTimers() {
    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current)
      recordingIntervalRef.current = null
    }
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current = null
    }
  }

  function closeCapture() {
    discardRecordingRef.current = true
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
    clearRecordingTimers()
    setIsRecording(false)
    setCaptureMode(null)
  }

  async function openScreenCapture() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      onError('Screen recording is not supported in this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      screenStreamRef.current = stream
      setIsCameraReady(false)
      setCameraError('')
      setCaptureMode('screen')
    } catch (screenCaptureError: unknown) {
      if (
        !(screenCaptureError instanceof DOMException) ||
        !['AbortError', 'NotAllowedError'].includes(screenCaptureError.name)
      ) {
        onError('Could not start screen sharing. Please try again.')
      }
    }
  }

  function startRecording() {
    const stream =
      captureMode === 'audio'
        ? audioStreamRef.current
        : videoRef.current?.srcObject
    if (!(stream instanceof MediaStream) || !window.MediaRecorder) {
      setCameraError(
        `${captureMode === 'audio' ? 'Voice' : 'Video'} recording is not supported in this browser.`,
      )
      return
    }

    const supportedType = (
      captureMode === 'audio'
        ? [
            'audio/webm;codecs=opus',
            'audio/ogg;codecs=opus',
            'audio/mp4',
            'audio/webm',
          ]
        : [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4',
          ]
    ).find((type) => MediaRecorder.isTypeSupported(type))
    if (!supportedType) {
      setCameraError(
        `This browser cannot create a supported ${captureMode === 'audio' ? 'voice' : 'video'} recording.`,
      )
      return
    }

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: supportedType,
        audioBitsPerSecond: 128_000,
        ...(captureMode === 'audio' ? {} : { videoBitsPerSecond: 2_000_000 }),
      })
    } catch {
      setCameraError(
        `Could not start ${captureMode === 'audio' ? 'voice' : 'video'} recording.`,
      )
      return
    }

    const recordingMode = captureMode
    recorderRef.current = recorder
    recordingChunksRef.current = []
    discardRecordingRef.current = false
    setRecordingSeconds(0)
    setIsRecording(true)
    setCameraError('')

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      clearRecordingTimers()
      setIsRecording(false)
      recorderRef.current = null
      if (discardRecordingRef.current) return

      const contentType = supportedType.split(';', 1)[0]
      const blob = new Blob(recordingChunksRef.current, { type: contentType })
      if (blob.size <= 0) {
        setCameraError('The recording was empty. Please try again.')
        return
      }
      if (blob.size > MAX_FILE_SIZE) {
        onError(
          `The recorded ${recordingMode === 'audio' ? 'voice message' : 'video'} is larger than 15 MB.`,
        )
        setCaptureMode(null)
        return
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const extension =
        contentType === 'audio/ogg'
          ? 'ogg'
          : contentType === 'audio/mp4'
            ? 'm4a'
            : contentType === 'video/mp4'
              ? 'mp4'
              : 'webm'
      const filePrefix =
        recordingMode === 'audio'
          ? 'voice-message'
          : recordingMode === 'screen'
            ? 'screen-recording'
            : 'video'
      addFiles([
        new File([blob], `${filePrefix}-${timestamp}.${extension}`, {
          type: contentType,
        }),
      ])
      setCaptureMode(null)
    }

    recorder.start(250)
    recordingIntervalRef.current = window.setInterval(
      () => setRecordingSeconds((seconds) => seconds + 1),
      1000,
    )
    recordingTimeoutRef.current = window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop()
    }, MAX_RECORDING_SECONDS * 1000)
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }

  return (
    <>
      {files.length > 0 && (
        <div className="pending-attachments" aria-label="Selected attachments">
          {files.map((file, index) => (
            <span className="pending-attachment" key={`${file.name}-${file.size}-${index}`}>
              {file.type.startsWith('audio/') ? (
                <Mic size={14} />
              ) : (
                <FileText size={14} />
              )}
              <span>{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        multiple
        disabled={disabled}
        onChange={selectFiles}
      />
      <button
        className="attachment-button"
        type="button"
        disabled={disabled}
        aria-label="Add attachments"
        title="Add attachments"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip size={18} />
      </button>
      <button
        className="attachment-camera-button"
        type="button"
        disabled={disabled || files.length >= MAX_FILES}
        aria-label="Take a photo"
        title="Take a photo"
        onClick={() => {
          setCameraError('')
          setCaptureMode('photo')
        }}
      >
        <Camera size={18} />
      </button>
      <button
        className="attachment-video-button"
        type="button"
        disabled={disabled || files.length >= MAX_FILES}
        aria-label="Record a video"
        title="Record a video"
        onClick={() => {
          setCameraError('')
          setCaptureMode('video')
        }}
      >
        <Video size={18} />
      </button>
      <button
        className="attachment-screen-button"
        type="button"
        disabled={disabled || files.length >= MAX_FILES}
        aria-label="Record your screen"
        title="Record your screen"
        onClick={() => void openScreenCapture()}
      >
        <MonitorUp size={18} />
      </button>
      <button
        className="attachment-audio-button"
        type="button"
        disabled={disabled || files.length >= MAX_FILES}
        aria-label="Record a voice message"
        title="Record a voice message"
        onClick={() => {
          setCameraError('')
          setCaptureMode('audio')
        }}
      >
        <Mic size={18} />
      </button>

      {captureMode && (
        <div className="attachment-camera-backdrop" role="presentation">
          <div
            className="attachment-camera-card"
            role="dialog"
            aria-modal="true"
            aria-label={
              captureMode === 'photo'
                ? 'Take a photo'
                : captureMode === 'screen'
                  ? 'Record your screen'
                  : captureMode === 'audio'
                    ? 'Record a voice message'
                    : 'Record a video'
            }
          >
            <div className="attachment-camera-heading">
              <div>
                <p className="eyebrow">
                  {captureMode === 'photo'
                    ? 'Camera'
                    : captureMode === 'screen'
                      ? 'Screen sharing'
                      : captureMode === 'audio'
                        ? 'Microphone'
                        : 'Video camera'}
                </p>
                <h2>
                  {captureMode === 'photo'
                    ? 'Take a photo'
                    : captureMode === 'screen'
                      ? 'Record your screen'
                      : captureMode === 'audio'
                        ? 'Record a voice message'
                        : 'Record a video'}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close recorder"
                onClick={closeCapture}
              >
                <X size={20} />
              </button>
            </div>

            <div
              className={`camera-viewfinder ${
                captureMode === 'audio' ? 'voice-recorder-view' : ''
              }`}
            >
              {!cameraError && captureMode !== 'audio' && (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  onCanPlay={() => setIsCameraReady(true)}
                />
              )}
              {!cameraError && captureMode === 'audio' && isCameraReady && (
                <div className="voice-recorder-ready">
                  <span>
                    <Mic size={32} />
                  </span>
                  <strong>
                    {isRecording ? 'Recording your voice' : 'Microphone ready'}
                  </strong>
                  <small>Maximum recording length is 30 seconds.</small>
                </div>
              )}
              {!isCameraReady && !cameraError && (
                <span className="camera-loading">
                  <LoaderCircle className="spin" size={24} />
                  {captureMode === 'screen'
                    ? 'Preparing screen preview…'
                    : captureMode === 'audio'
                      ? 'Opening microphone…'
                      : 'Opening camera…'}
                </span>
              )}
              {cameraError && <p role="alert">{cameraError}</p>}
              {isRecording && (
                <span className="video-recording-status">
                  <i />
                  Recording {formatRecordingTime(recordingSeconds)}
                </span>
              )}
            </div>

            <div className="camera-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closeCapture}
              >
                <X size={17} />
                Cancel
              </button>
              {captureMode === 'photo' ? (
                <button
                  className="camera-capture-button"
                  type="button"
                  disabled={!isCameraReady}
                  onClick={() => void takePhoto()}
                >
                  <Camera size={18} />
                  Capture photo
                </button>
              ) : (
                <button
                  className={`camera-capture-button ${
                    isRecording ? 'recording' : ''
                  }`}
                  type="button"
                  disabled={!isCameraReady}
                  onClick={isRecording ? stopRecording : startRecording}
                >
                  {isRecording ? (
                    <Square size={16} />
                  ) : captureMode === 'audio' ? (
                    <Mic size={18} />
                  ) : (
                    <Video size={18} />
                  )}
                  {isRecording
                    ? 'Stop recording'
                    : captureMode === 'screen'
                      ? 'Start screen recording'
                      : captureMode === 'audio'
                        ? 'Start voice recording'
                        : 'Start recording'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

type MessageAttachmentListProps = {
  attachments: ChatAttachment[]
  getUrl: (attachmentId: string, download?: boolean) => string
}

export function MessageAttachmentList({
  attachments,
  getUrl,
}: MessageAttachmentListProps) {
  if (attachments.length === 0) return null

  return (
    <div className="message-attachments">
      {attachments.map((attachment) =>
        attachment.contentType.startsWith('image/') ? (
          <img
            key={attachment.id}
            src={getUrl(attachment.id)}
            alt={attachment.fileName}
            loading="lazy"
          />
        ) : attachment.contentType.startsWith('video/') ? (
          <div className="message-video-attachment" key={attachment.id}>
            <video
              className="message-video"
              src={getUrl(attachment.id)}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) =>
                resolveUnknownVideoDuration(
                  event.currentTarget,
                  attachment.durationMs,
                )
              }
            >
              <a href={getUrl(attachment.id, true)}>
                Download {attachment.fileName}
              </a>
            </video>
            {attachment.durationMs !== null ? (
              <small className="message-video-duration">
                Duration {formatMediaDuration(attachment.durationMs)}
              </small>
            ) : null}
          </div>
        ) : attachment.contentType.startsWith('audio/') ? (
          <div className="message-audio" key={attachment.id}>
            <span>
              <Mic size={17} />
              Voice message
            </span>
            <audio src={getUrl(attachment.id)} controls preload="metadata">
              <a href={getUrl(attachment.id, true)}>
                Download {attachment.fileName}
              </a>
            </audio>
          </div>
        ) : (
          <a
            className="message-file"
            key={attachment.id}
            href={getUrl(attachment.id, true)}
            download={attachment.fileName}
          >
            <span className="message-file-icon">
              <FileText size={18} />
            </span>
            <span>
              <strong>{attachment.fileName}</strong>
              <small>{formatFileSize(attachment.fileSize)}</small>
            </span>
            <Download size={16} />
          </a>
        ),
      )}
    </div>
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRecordingTime(seconds: number) {
  const safeSeconds = Math.min(seconds, MAX_RECORDING_SECONDS)
  return `0:${safeSeconds.toString().padStart(2, '0')} / 0:${MAX_RECORDING_SECONDS}`
}
