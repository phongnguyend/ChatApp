import {
  Crown,
  EllipsisVertical,
  MessageCircleMore,
  UserMinus,
  UserRound,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type GroupMemberActionsProps = {
  displayName: string
  isOwner: boolean
  canChangeRole: boolean
  canRemove: boolean
  disabled?: boolean
  onChat: () => void
  onViewProfile: () => void
  onMakeOwner: () => void
  onRemoveOwner: () => void
  onRemove: () => void
}

export function GroupMemberActions({
  displayName,
  isOwner,
  canChangeRole,
  canRemove,
  disabled = false,
  onChat,
  onViewProfile,
  onMakeOwner,
  onRemoveOwner,
  onRemove,
}: GroupMemberActionsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })

  function updateMenuPosition() {
    const trigger = rootRef.current?.querySelector(
      '.member-actions-trigger',
    )
    if (!(trigger instanceof HTMLElement)) return

    const triggerRect = trigger.getBoundingClientRect()
    const menuWidth = menuRef.current?.offsetWidth ?? 174
    const menuHeight = menuRef.current?.offsetHeight ?? 164
    const viewportPadding = 8
    const gap = 4
    const fitsBelow =
      window.innerHeight - triggerRect.bottom >= menuHeight + gap
    const top = fitsBelow
      ? triggerRect.bottom + gap
      : triggerRect.top - menuHeight - gap
    const left = Math.min(
      Math.max(viewportPadding, triggerRect.right - menuWidth),
      window.innerWidth - menuWidth - viewportPadding,
    )

    setMenuPosition({
      left,
      top: Math.max(viewportPadding, top),
    })
  }

  useEffect(() => {
    if (!isOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setIsOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [isOpen])

  useLayoutEffect(() => {
    if (isOpen) updateMenuPosition()
  }, [isOpen])

  useEffect(() => {
    if (disabled) setIsOpen(false)
  }, [disabled])

  return (
    <div className="member-actions" ref={rootRef}>
      <button
        className="member-actions-trigger"
        type="button"
        disabled={disabled}
        aria-label={`Manage ${displayName}`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <EllipsisVertical size={16} />
      </button>

      {isOpen &&
        createPortal(
          <div
            className="member-actions-menu floating-member-actions-menu"
            role="menu"
            ref={menuRef}
            style={menuPosition}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                onChat()
              }}
            >
              <MessageCircleMore size={15} />
              Chat
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                onViewProfile()
              }}
            >
              <UserRound size={15} />
              View profile
            </button>
            {canChangeRole && !isOwner && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false)
                  onMakeOwner()
                }}
              >
                <Crown size={15} />
                Make Owner
              </button>
            )}
            {canChangeRole && isOwner && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false)
                  onRemoveOwner()
                }}
              >
                <Crown size={15} />
                Remove Owner
              </button>
            )}
            {canRemove && (
              <button
                className="member-remove-action"
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false)
                  onRemove()
                }}
              >
                <UserMinus size={15} />
                Remove from group
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
