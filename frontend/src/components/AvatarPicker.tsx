import { Camera, ImagePlus, LoaderCircle, X } from 'lucide-react'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'

type AvatarPickerProps = {
  imageUrl: string | null
  fallback: string
  label: string
  capture?: 'user' | 'environment'
  onSelect: (file: File) => Promise<void>
}

const MAX_FILE_SIZE = 5 * 1024 * 1024

export function AvatarPicker({
  imageUrl,
  fallback,
  label,
  capture = 'user',
  onSelect,
}: AvatarPickerProps) {
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [error, setError] = useState('')

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    [],
  )

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
        video: { facingMode: { ideal: capture } },
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
  }, [capture, isCameraOpen])

  async function uploadFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Choose an image smaller than 5 MB.')
      return
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    const nextPreviewUrl = URL.createObjectURL(file)
    previewUrlRef.current = nextPreviewUrl
    setPreviewUrl(nextPreviewUrl)
    setError('')
    setIsUploading(true)

    try {
      await onSelect(file)
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : 'Could not update avatar.',
      )
    } finally {
      setIsUploading(false)
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
      setPreviewUrl(null)
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await uploadFile(file)
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

    if (capture === 'user') {
      context.translate(canvas.width, 0)
      context.scale(-1, 1)
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    )
    if (!blob) {
      setCameraError('Could not capture the photo.')
      return
    }

    setIsCameraOpen(false)
    await uploadFile(
      new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' }),
    )
  }

  if (isCameraOpen) {
    return (
      <div className="avatar-camera" aria-label={`${label} camera`}>
        <div className={`camera-viewfinder ${capture === 'user' ? 'mirrored' : ''}`}>
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
    )
  }

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-preview" aria-label={`${label} preview`}>
        {previewUrl ?? imageUrl ? (
          <img src={previewUrl ?? imageUrl ?? undefined} alt="" />
        ) : (
          <span>{fallback}</span>
        )}
        {isUploading && (
          <span className="avatar-picker-loading">
            <LoaderCircle className="spin" size={22} />
          </span>
        )}
      </div>

      <div className="avatar-picker-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={isUploading}
          onClick={() => galleryInputRef.current?.click()}
        >
          <ImagePlus size={17} />
          Choose image
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={isUploading}
          onClick={() => {
            setError('')
            setIsCameraOpen(true)
          }}
        >
          <Camera size={17} />
          Take photo
        </button>
      </div>

      <input
        ref={galleryInputRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(event) => void handleFile(event)}
      />

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="avatar-picker-note">JPEG, PNG, WebP, or GIF up to 5 MB.</p>
    </div>
  )
}
