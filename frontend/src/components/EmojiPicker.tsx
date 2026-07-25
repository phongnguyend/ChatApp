import { Smile, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type EmojiPickerProps = {
  disabled?: boolean
  onSelect: (emoji: string) => void
}

const EMOJI_GROUPS = [
  {
    name: 'Faces',
    icon: '😊',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
      '😊', '😇', '🙂', '🙃', '😉', '😍', '🥰', '😘',
      '😋', '😎', '🤩', '🥳', '😏', '😴', '🤔', '🫡',
      '😮', '😢', '😭', '😤', '😡', '🤯', '🥶', '🫠',
    ],
  },
  {
    name: 'Gestures',
    icon: '👋',
    emojis: [
      '👍', '👎', '👏', '🙌', '🫶', '🤝', '🙏', '💪',
      '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👋', '🖐️',
      '☝️', '👇', '👈', '👉', '💅', '🤌', '🫰', '🫵',
    ],
  },
  {
    name: 'Hearts',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗',
      '💖', '💘', '💝', '💟', '❣️', '💌', '💋', '🌹',
    ],
  },
  {
    name: 'Things',
    icon: '🎉',
    emojis: [
      '🎉', '🎊', '🎂', '🎁', '🏆', '🥇', '⭐', '✨',
      '🔥', '💯', '✅', '❌', '⚡', '💡', '🚀', '💻',
      '📱', '📌', '📎', '🔔', '☕', '🍕', '🌈', '☀️',
    ],
  },
]

export function EmojiPicker({ disabled = false, onSelect }: EmojiPickerProps) {
  const controlRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState(0)

  useEffect(() => {
    if (!isOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !controlRef.current?.contains(event.target)
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

  const group = EMOJI_GROUPS[activeGroup]

  return (
    <div className="emoji-picker-control" ref={controlRef}>
      <button
        className="emoji-picker-button"
        type="button"
        disabled={disabled}
        aria-label="Choose an emoji"
        aria-expanded={isOpen}
        title="Choose emoji"
        onClick={() => setIsOpen((current) => !current)}
      >
        <Smile size={18} />
      </button>

      {isOpen && (
        <div className="emoji-picker-popover" role="dialog" aria-label="Choose an emoji">
          <div className="emoji-picker-heading">
            <strong>Emoji</strong>
            <button
              type="button"
              aria-label="Close emoji picker"
              onClick={() => setIsOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="emoji-group-tabs" role="tablist" aria-label="Emoji categories">
            {EMOJI_GROUPS.map((emojiGroup, index) => (
              <button
                className={index === activeGroup ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={index === activeGroup}
                aria-label={emojiGroup.name}
                key={emojiGroup.name}
                onClick={() => setActiveGroup(index)}
              >
                {emojiGroup.icon}
              </button>
            ))}
          </div>
          <div className="emoji-grid" role="tabpanel" aria-label={group.name}>
            {group.emojis.map((emoji) => (
              <button
                type="button"
                key={emoji}
                aria-label={`Insert ${emoji}`}
                onClick={() => {
                  onSelect(emoji)
                  setIsOpen(false)
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
