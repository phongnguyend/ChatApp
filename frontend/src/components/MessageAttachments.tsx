import { Camera, Download, FileText, LoaderCircle, Paperclip, X } from 'lucide-react'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'

export type ChatAttachment = {
  id: string
  fileName: string
  contentType: string
  fileSize: number
  width: number | null
  height: number | null
}

type MessageAttachmentPickerProps = {
  files: File[]
  disabled?: boolean
  onChange: (files: File[]) => void
  onError: (message: string) => void
}

const MAX_FILES = 5
const MAX_FILE_SIZE = 15 * 1024 * 1024

export function MessageAttachmentPicker({
  files,
  disabled = false,
  onChange,
  onError,
}: MessageAttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')

  useEffect(() => {
    if (!isCameraOpen) return

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
        audio: false,
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
      stream?.getTracks().forEach((track) => track.stop())
      if (videoElement) videoElement.srcObject = null
    }
  }, [isCameraOpen])

  useEffect(() => {
    if (disabled) setIsCameraOpen(false)
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
    setIsCameraOpen(false)
  }

  return (
    <>
      {files.length > 0 && (
        <div className="pending-attachments" aria-label="Selected attachments">
          {files.map((file, index) => (
            <span className="pending-attachment" key={`${file.name}-${file.size}-${index}`}>
              <FileText size={14} />
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
          setIsCameraOpen(true)
        }}
      >
        <Camera size={18} />
      </button>

      {isCameraOpen && (
        <div className="attachment-camera-backdrop" role="presentation">
          <div
            className="attachment-camera-card"
            role="dialog"
            aria-modal="true"
            aria-label="Take a photo"
          >
            <div className="attachment-camera-heading">
              <div>
                <p className="eyebrow">Camera</p>
                <h2>Take a photo</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close camera"
                onClick={() => setIsCameraOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="camera-viewfinder">
              {!cameraError && (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  onCanPlay={() => setIsCameraReady(true)}
                />
              )}
              {!isCameraReady && !cameraError && (
                <span className="camera-loading">
                  <LoaderCircle className="spin" size={24} />
                  Opening camera…
                </span>
              )}
              {cameraError && <p role="alert">{cameraError}</p>}
            </div>

            <div className="camera-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setIsCameraOpen(false)}
              >
                <X size={17} />
                Cancel
              </button>
              <button
                className="camera-capture-button"
                type="button"
                disabled={!isCameraReady}
                onClick={() => void takePhoto()}
              >
                <Camera size={18} />
                Capture photo
              </button>
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
