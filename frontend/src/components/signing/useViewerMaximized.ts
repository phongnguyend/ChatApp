import { useEffect, useState } from 'react'

const PREVIEW_MAXIMIZED_KEY = 'preview-maximized'

/** Whether preview popups fill the window. The choice is remembered for this browser. */
export function useViewerMaximized() {
  const [maximized, setMaximized] = useState(() => {
    try {
      return localStorage.getItem(PREVIEW_MAXIMIZED_KEY) === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_MAXIMIZED_KEY, String(maximized))
    } catch {
      // Storage can be unavailable (private windows, blocked site data); the toggle still works.
    }
  }, [maximized])

  return [maximized, () => setMaximized(value => !value)] as const
}
