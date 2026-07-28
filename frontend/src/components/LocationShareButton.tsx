import { LoaderCircle, MapPin, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export type SharedLocation = {
  latitude: number
  longitude: number
  url: string
}

type LocationShareButtonProps = {
  disabled?: boolean
  onShare: (location: SharedLocation) => Promise<void>
  onError: (message: string) => void
}

export function LocationShareButton({
  disabled = false,
  onShare,
  onError,
}: LocationShareButtonProps) {
  const requestIdRef = useRef(0)
  const [isLocating, setIsLocating] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [location, setLocation] = useState<SharedLocation | null>(null)

  useEffect(() => {
    if (!location) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSharing) closePreview()
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [isSharing, location])

  useEffect(() => {
    if (disabled) closePreview()
  }, [disabled])

  function closePreview() {
    requestIdRef.current += 1
    setIsLocating(false)
    setLocation(null)
  }

  async function findCurrentLocation() {
    if (disabled || isLocating || isSharing) return
    if (!navigator.geolocation) {
      onError('Location sharing is not supported by this browser.')
      return
    }

    const requestId = ++requestIdRef.current
    setIsLocating(true)
    onError('')
    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15_000,
            maximumAge: 30_000,
          })
        },
      )
      if (requestId !== requestIdRef.current) return

      const latitude = position.coords.latitude
      const longitude = position.coords.longitude
      const formattedLatitude = latitude.toFixed(6)
      const formattedLongitude = longitude.toFixed(6)
      setLocation({
        latitude,
        longitude,
        url:
          `https://www.openstreetmap.org/?mlat=${formattedLatitude}` +
          `&mlon=${formattedLongitude}#map=16/${formattedLatitude}/${formattedLongitude}`,
      })
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return
      onError(locationErrorMessage(requestError))
    } finally {
      if (requestId === requestIdRef.current) setIsLocating(false)
    }
  }

  async function confirmShare() {
    if (!location || isSharing) return

    setIsSharing(true)
    onError('')
    try {
      await onShare(location)
      closePreview()
    } catch (shareError) {
      onError(
        shareError instanceof Error
          ? shareError.message
          : 'Your location was not shared.',
      )
    } finally {
      setIsSharing(false)
    }
  }

  return (
    <>
      <button
        className="location-button"
        type="button"
        disabled={disabled || isLocating || isSharing}
        aria-label="Share current location"
        title="Share current location"
        onClick={() => void findCurrentLocation()}
      >
        {isLocating ? (
          <LoaderCircle className="spin" size={18} />
        ) : (
          <MapPin size={18} />
        )}
      </button>

      {location && (
        <div className="location-preview-backdrop" role="presentation">
          <section
            className="location-preview-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="location-preview-title"
          >
            <div className="location-preview-heading">
              <div>
                <p className="eyebrow">Current location</p>
                <h2 id="location-preview-title">Share this location?</h2>
              </div>
              <button
                type="button"
                disabled={isSharing}
                aria-label="Cancel location sharing"
                onClick={closePreview}
              >
                <X size={17} />
              </button>
            </div>

            <iframe
              className="location-preview-map"
              src={locationPreviewUrl(location)}
              title="Current location preview"
              loading="eager"
            />
            <p className="location-preview-coordinates">
              <MapPin size={15} />
              {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
            </p>

            <div className="location-preview-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isSharing}
                onClick={closePreview}
              >
                Cancel
              </button>
              <button
                className="location-preview-confirm"
                type="button"
                disabled={isSharing}
                onClick={() => void confirmShare()}
              >
                {isSharing ? (
                  <>
                    <LoaderCircle className="spin" size={16} />
                    Sharing…
                  </>
                ) : (
                  <>
                    <MapPin size={16} />
                    Share location
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

function locationPreviewUrl(location: SharedLocation) {
  const offset = 0.006
  const bounds = [
    location.longitude - offset,
    location.latitude - offset,
    location.longitude + offset,
    location.latitude + offset,
  ].join(',')
  const marker = `${location.latitude},${location.longitude}`
  return (
    `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bounds)}` +
    `&layer=mapnik&marker=${encodeURIComponent(marker)}`
  )
}

function locationErrorMessage(error: unknown) {
  const geolocationError =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number'
      ? (error as GeolocationPositionError)
      : null

  if (!geolocationError) {
    return error instanceof Error
      ? error.message
      : 'Your current location is unavailable.'
  }

  if (geolocationError.code === geolocationError.PERMISSION_DENIED) {
    return 'Location permission was denied.'
  }
  if (geolocationError.code === geolocationError.TIMEOUT) {
    return 'Could not get your location in time.'
  }
  return 'Your current location is unavailable.'
}
