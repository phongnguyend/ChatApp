import { Bell, BellOff, EllipsisVertical, LogOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type ConversationActionsProps = {
  title: string
  isMuted: boolean
  canLeave: boolean
  disabled?: boolean
  onToggleMute: () => void
  onLeave: () => void
}

export function ConversationActions({
  title,
  isMuted,
  canLeave,
  disabled = false,
  onToggleMute,
  onLeave,
}: ConversationActionsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [opensBelow, setOpensBelow] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setIsOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  useEffect(() => {
    if (disabled) setIsOpen(false)
  }, [disabled])

  return (
    <div
      className={`conversation-actions ${opensBelow ? 'opens-below' : ''}`}
      ref={rootRef}
    >
      <button
        className="conversation-actions-trigger"
        type="button"
        disabled={disabled}
        aria-label={`Manage ${title}`}
        aria-expanded={isOpen}
        onClick={() => {
          if (!isOpen) {
            const actionRect = rootRef.current?.getBoundingClientRect()
            const listRect = rootRef.current
              ?.closest('.sidebar-section')
              ?.getBoundingClientRect()
            setOpensBelow(
              Boolean(
                actionRect &&
                  listRect &&
                  actionRect.top - listRect.top < 120,
              ),
            )
          }
          setIsOpen((current) => !current)
        }}
      >
        <EllipsisVertical size={16} />
      </button>

      {isOpen && (
        <div className="conversation-actions-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false)
              onToggleMute()
            }}
          >
            {isMuted ? <Bell size={15} /> : <BellOff size={15} />}
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          {canLeave && (
            <button
              className="conversation-leave-action"
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                onLeave()
              }}
            >
              <LogOut size={15} />
              Leave conversation
            </button>
          )}
        </div>
      )}
    </div>
  )
}
