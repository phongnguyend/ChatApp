import { BarChart3, Check, Clock3, ListChecks } from 'lucide-react'
import { useEffect, useState } from 'react'
import './MessagePoll.css'

export type ChatPollOption = {
  id: string
  text: string
  sortOrder: number
  voteCount: number
  isSelected: boolean
}

export type ChatPoll = {
  messageId: string
  question: string
  isMultiple: boolean
  expiresAt: string | null
  totalVotes: number
  options: ChatPollOption[]
}

export function MessagePoll({ poll, disabled, onVote }: {
  poll: ChatPoll
  disabled: boolean
  onVote: (optionId: string) => void
}) {
  const [currentTime, setCurrentTime] = useState(Date.now())
  const expirationTime = poll.expiresAt ? new Date(poll.expiresAt).getTime() : null
  const isExpired = expirationTime !== null && expirationTime <= currentTime

  useEffect(() => {
    setCurrentTime(Date.now())
    if (!poll.expiresAt) return
    const expires = new Date(poll.expiresAt).getTime()
    if (!Number.isFinite(expires) || expires <= Date.now()) return
    let timer = 0
    const schedule = () => {
      const remaining = expires - Date.now()
      if (remaining <= 0) {
        setCurrentTime(Date.now())
        return
      }
      timer = window.setTimeout(schedule, Math.min(remaining + 25, 2_147_483_647))
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [poll.expiresAt])

  return (
    <section className="message-poll" aria-label={`Poll: ${poll.question}`}>
      <header>
        <span><BarChart3 size={17} /></span>
        <div>
          <small>Poll</small>
          <strong>{poll.question}</strong>
          <span className="message-poll-mode">
            <ListChecks size={11} />
            {poll.isMultiple ? 'Multiple choice' : 'Single choice'}
          </span>
        </div>
      </header>
      <div
        className="message-poll-options"
        role={poll.isMultiple ? 'group' : 'radiogroup'}
        aria-label={poll.question}
      >
        {poll.options.map((option) => {
          const percentage = poll.totalVotes === 0
            ? 0
            : Math.round(option.voteCount * 100 / poll.totalVotes)
          return (
            <button
              className={option.isSelected ? 'selected' : ''}
              type="button"
              role={poll.isMultiple ? 'checkbox' : 'radio'}
              aria-checked={option.isSelected}
              disabled={disabled || isExpired}
              key={option.id}
              onClick={() => onVote(option.id)}
            >
              <span className="message-poll-progress" style={{ width: `${percentage}%` }} />
              <span className="message-poll-check">
                {option.isSelected && <Check size={12} />}
              </span>
              <span className="message-poll-option-text">{option.text}</span>
              <strong>{percentage}%</strong>
              <small>{option.voteCount}</small>
            </button>
          )
        })}
      </div>
      <footer>
        <span>{poll.totalVotes} {poll.totalVotes === 1 ? 'voter' : 'voters'}</span>
        <span className={isExpired ? 'expired' : ''}>
          <Clock3 size={11} />
          {poll.expiresAt
            ? `${isExpired ? 'Expired' : 'Closes'} ${new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(poll.expiresAt))}`
            : 'No expiration'}
        </span>
      </footer>
    </section>
  )
}
