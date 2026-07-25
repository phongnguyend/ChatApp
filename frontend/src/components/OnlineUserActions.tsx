import { Ban, Check, EllipsisVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type OnlineUserActionsProps = {
  username: string
  isBlocked: boolean
  disabled?: boolean
  onToggleBlock: () => void
}

export function OnlineUserActions({
  username,
  isBlocked,
  disabled = false,
  onToggleBlock,
}: OnlineUserActionsProps) {
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
      className={`member-actions online-user-actions ${
        opensBelow ? 'opens-below' : ''
      }`}
      ref={rootRef}
    >
      <button
        className="member-actions-trigger"
        type="button"
        disabled={disabled}
        aria-label={`Manage ${username}`}
        aria-expanded={isOpen}
        onClick={() => {
          if (!isOpen) {
            const actionRect = rootRef.current?.getBoundingClientRect()
            const listRect = rootRef.current
              ?.closest('.people-list')
              ?.getBoundingClientRect()
            setOpensBelow(
              Boolean(
                actionRect &&
                  listRect &&
                  actionRect.top - listRect.top < 90,
              ),
            )
          }
          setIsOpen((current) => !current)
        }}
      >
        <EllipsisVertical size={16} />
      </button>

      {isOpen && (
        <div className="member-actions-menu" role="menu">
          <button
            className={isBlocked ? '' : 'member-remove-action'}
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false)
              onToggleBlock()
            }}
          >
            {isBlocked ? <Check size={15} /> : <Ban size={15} />}
            {isBlocked ? 'Unblock user' : 'Block user'}
          </button>
        </div>
      )}
    </div>
  )
}
