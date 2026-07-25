import { Crown, EllipsisVertical, UserMinus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type GroupMemberActionsProps = {
  displayName: string
  isOwner: boolean
  canRemove: boolean
  disabled?: boolean
  onMakeOwner: () => void
  onRemove: () => void
}

export function GroupMemberActions({
  displayName,
  isOwner,
  canRemove,
  disabled = false,
  onMakeOwner,
  onRemove,
}: GroupMemberActionsProps) {
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
      className={`member-actions ${opensBelow ? 'opens-below' : ''}`}
      ref={rootRef}
    >
      <button
        className="member-actions-trigger"
        type="button"
        disabled={disabled}
        aria-label={`Manage ${displayName}`}
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
                  actionRect.top - listRect.top < 100,
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
          {!isOwner && (
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
        </div>
      )}
    </div>
  )
}
