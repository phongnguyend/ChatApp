export function formatMediaDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? [hours, minutes, seconds]
        .map((part) => part.toString().padStart(2, '0'))
        .join(':')
    : `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function resolveUnknownVideoDuration(
  video: HTMLVideoElement,
  durationMs: number | null,
) {
  if (Number.isFinite(video.duration) && video.duration > 0) return

  const fallbackSeconds =
    durationMs !== null && durationMs > 0
      ? Math.max(1, durationMs / 1000)
      : Number.MAX_SAFE_INTEGER
  const restorePlaybackPosition = () => {
    video.currentTime = 0
  }
  video.addEventListener('timeupdate', restorePlaybackPosition, { once: true })
  try {
    video.currentTime = fallbackSeconds
  } catch {
    video.removeEventListener('timeupdate', restorePlaybackPosition)
  }
}
