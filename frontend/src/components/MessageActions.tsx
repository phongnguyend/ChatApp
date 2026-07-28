import { Copy, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react'
import { useState } from 'react'

export type ChatReaction = {
  reaction: string
  count: number
  isOwn: boolean
  users: ChatReactionUser[]
}

export type ChatReactionUser = {
  id: string
  displayName: string
  avatarUrl: string | null
}

type MessageActionsProps = {
  isOwn: boolean
  canEdit: boolean
  canCopy: boolean
  disabled?: boolean
  reactions: ChatReaction[]
  resolveAvatarUrl: (avatarUrl: string | null) => string | null
  onReaction: (reaction: string) => void
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onCopy: () => void
}

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

export function MessageActions({
  isOwn,
  canEdit,
  canCopy,
  disabled = false,
  reactions,
  resolveAvatarUrl,
  onReaction,
  onReply,
  onEdit,
  onDelete,
  onCopy,
}: MessageActionsProps) {
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false)

  return (
    <>
      <div className="message-actions" aria-label="Message actions">
        <button
          type="button"
          disabled={disabled}
          aria-label="React to message"
          title="React"
          onClick={() => setIsReactionPickerOpen((current) => !current)}
        >
          <SmilePlus size={15} />
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label="Reply to message"
          title="Reply"
          onClick={onReply}
        >
          <Reply size={15} />
        </button>
        {canCopy && (
          <button
            type="button"
            disabled={disabled}
            aria-label="Copy message"
            title="Copy"
            onClick={onCopy}
          >
            <Copy size={15} />
          </button>
        )}
        {isOwn && canEdit && (
          <button
            type="button"
            disabled={disabled}
            aria-label="Edit message"
            title="Edit"
            onClick={onEdit}
          >
            <Pencil size={15} />
          </button>
        )}
        {isOwn && (
          <button
            className="message-delete-action"
            type="button"
            disabled={disabled}
            aria-label="Delete message"
            title="Delete"
            onClick={onDelete}
          >
            <Trash2 size={15} />
          </button>
        )}

        {isReactionPickerOpen && (
          <div className="message-reaction-picker" aria-label="Choose a reaction">
            {REACTIONS.map((reaction) => (
              <button
                className={
                  reactions.some((item) => item.reaction === reaction && item.isOwn)
                    ? 'active'
                    : ''
                }
                type="button"
                key={reaction}
                aria-label={`React with ${reaction}`}
                onClick={() => {
                  onReaction(reaction)
                  setIsReactionPickerOpen(false)
                }}
              >
                {reaction}
              </button>
            ))}
          </div>
        )}
      </div>

      {reactions.length > 0 && (
        <div className="message-reactions" aria-label="Message reactions">
          {reactions.map((item) => (
            <span className="message-reaction-item" key={item.reaction}>
              <button
                className={item.isOwn ? 'active' : ''}
                type="button"
                disabled={disabled}
                aria-label={`${item.reaction}, reacted by ${item.users
                  .map((reactingUser) => reactingUser.displayName)
                  .join(', ')}`}
                onClick={() => onReaction(item.reaction)}
              >
                <span>{item.reaction}</span>
                <strong>{item.count}</strong>
              </button>
              <span
                className="reaction-people"
                role="tooltip"
              >
                {item.users.map((reactingUser) => {
                  const avatarUrl = resolveAvatarUrl(reactingUser.avatarUrl)
                  return (
                    <span className="reaction-person" key={reactingUser.id}>
                      <span className="reaction-person-avatar">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="" />
                        ) : (
                          reactionInitials(reactingUser.displayName)
                        )}
                      </span>
                      <strong>{reactingUser.displayName}</strong>
                    </span>
                  )
                })}
              </span>
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function reactionInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}
