import { Bell, BellOff, BellRing, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type PushState = 'loading' | 'unavailable' | 'off' | 'on' | 'working'

type PushConfig = {
  enabled: boolean
  vapidPublicKey: string
}

type PushNotificationButtonProps = {
  apiUrl: string
  username: string
  onError: (message: string) => void
}

const INSTALLATION_ID_KEY = 'huddle-push-installation-id'

export function PushNotificationButton({
  apiUrl,
  username,
  onError,
}: PushNotificationButtonProps) {
  const [state, setState] = useState<PushState>('loading')
  const [config, setConfig] = useState<PushConfig | null>(null)

  const registerWithApi = useCallback(
    async (subscription: PushSubscription) => {
      const serialized = subscription.toJSON()
      const p256dh = serialized.keys?.p256dh
      const auth = serialized.keys?.auth
      if (!serialized.endpoint || !p256dh || !auth) {
        throw new Error('The browser returned an incomplete push subscription.')
      }

      const response = await fetch(
        `${apiUrl}/api/push/subscriptions?username=${encodeURIComponent(username)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            installationId: getInstallationId(username),
            endpoint: serialized.endpoint,
            p256dh,
            auth,
          }),
        },
      )
      if (!response.ok) {
        throw new Error(await readPushError(response))
      }
    },
    [apiUrl, username],
  )

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      if (!supportsPushNotifications()) {
        if (!cancelled) setState('unavailable')
        return
      }

      try {
        const response = await fetch(`${apiUrl}/api/push/config`)
        if (!response.ok) throw new Error('Could not load notification settings.')
        const nextConfig = (await response.json()) as PushConfig
        if (cancelled) return
        setConfig(nextConfig)
        if (!nextConfig.enabled) {
          setState('unavailable')
          return
        }

        getInstallationId(username)
        const registration = await navigator.serviceWorker.register('/push-sw.js')
        let subscription = await registration.pushManager.getSubscription()
        if (cancelled) return
        if (subscription && Notification.permission === 'granted') {
          const usesConfiguredKey = hasMatchingApplicationServerKey(
            subscription,
            nextConfig.vapidPublicKey,
          )
          if (!usesConfiguredKey) {
            await subscription.unsubscribe()
            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: base64UrlToBytes(nextConfig.vapidPublicKey),
            })
          }
          await registerWithApi(subscription)
          if (!cancelled) setState('on')
        } else {
          setState('off')
        }
      } catch (error) {
        if (!cancelled) {
          setState('unavailable')
          onError(
            error instanceof Error
              ? error.message
              : 'Could not initialize push notifications.',
          )
        }
      }
    }

    void initialize()
    return () => {
      cancelled = true
    }
  }, [apiUrl, onError, registerWithApi, username])

  async function toggleNotifications() {
    if (!config?.enabled || state === 'working') return
    setState('working')
    onError('')

    try {
      const registration = await navigator.serviceWorker.register('/push-sw.js')
      const existing = await registration.pushManager.getSubscription()
      if (existing) {
        const response = await fetch(
          `${apiUrl}/api/push/subscriptions/${encodeURIComponent(
            getInstallationId(username),
          )}?username=${encodeURIComponent(username)}`,
          { method: 'DELETE' },
        )
        if (!response.ok) throw new Error(await readPushError(response))
        await existing.unsubscribe()
        setState('off')
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error(
          permission === 'denied'
            ? 'Notifications are blocked in your browser settings.'
            : 'Notification permission was not granted.',
        )
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(config.vapidPublicKey),
      })
      try {
        await registerWithApi(subscription)
      } catch (error) {
        await subscription.unsubscribe()
        throw error
      }
      setState('on')
    } catch (error) {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      setState(subscription ? 'on' : 'off')
      onError(
        error instanceof Error
          ? error.message
          : 'Could not update push notifications.',
      )
    }
  }

  const isOn = state === 'on'
  const isWorking = state === 'loading' || state === 'working'
  const isUnavailable = state === 'unavailable'
  const title = isUnavailable
    ? config?.enabled === false
      ? 'Configure Azure Notification Hubs to enable push notifications'
      : 'Push notifications are not supported in this browser'
    : isOn
      ? 'Turn off push notifications'
      : 'Turn on push notifications'

  return (
    <button
      className={`icon-button push-notification-button ${isOn ? 'active' : ''}`}
      type="button"
      aria-label={title}
      aria-pressed={isOn}
      title={title}
      disabled={isWorking || isUnavailable}
      onClick={() => void toggleNotifications()}
    >
      {isWorking ? (
        <LoaderCircle className="spin" size={16} />
      ) : isOn ? (
        <BellRing size={16} />
      ) : isUnavailable ? (
        <BellOff size={16} />
      ) : (
        <Bell size={16} />
      )}
    </button>
  )
}

function supportsPushNotifications() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function getInstallationId(username: string) {
  const storageKey = `${INSTALLATION_ID_KEY}:${username.trim().toLowerCase()}`
  const existing = localStorage.getItem(storageKey)
  if (existing) return existing
  const legacyInstallationId = localStorage.getItem(INSTALLATION_ID_KEY)
  if (legacyInstallationId) {
    localStorage.setItem(storageKey, legacyInstallationId)
    localStorage.removeItem(INSTALLATION_ID_KEY)
    return legacyInstallationId
  }
  const installationId = crypto.randomUUID().replaceAll('-', '')
  localStorage.setItem(storageKey, installationId)
  return installationId
}

function base64UrlToBytes(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = `${value}${padding}`.replaceAll('-', '+').replaceAll('_', '/')
  const decoded = atob(base64)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function hasMatchingApplicationServerKey(
  subscription: PushSubscription,
  configuredKey: string,
) {
  const currentKey = subscription.options.applicationServerKey
  if (!currentKey) return false

  const actual = new Uint8Array(currentKey)
  const expected = base64UrlToBytes(configuredKey)
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

async function readPushError(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('json')) {
    const body = (await response.json()) as {
      message?: string
      detail?: string
      title?: string
    }
    return body.message ?? body.detail ?? body.title ?? 'Azure push request failed.'
  }
  return (await response.text()) || 'Azure push request failed.'
}
