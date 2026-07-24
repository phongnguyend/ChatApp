import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection,
} from '@microsoft/signalr'
import {
  Check,
  Hash,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircleMore,
  Plus,
  Send,
  Search,
  UserRoundPlus,
  Users,
  WifiOff,
  X,
} from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5045'

type User = {
  id: string
  username: string
  displayName: string
}

type Conversation = {
  id: string
  type: 'direct' | 'group'
  title: string | null
  lastMessage: string | null
  lastMessageSenderUserId: string | null
  lastMessageSenderName: string | null
  lastMessageAt: string | null
  unreadCount: number
  memberCount: number
}

type SearchUser = User

type ConversationMember = User & {
  role: 'owner' | 'admin' | 'member'
  isOnline: boolean
}

type MembersChangedEvent = {
  conversationId: string
  memberCount: number
}

type Message = {
  id: string
  conversationId: string
  senderUserId: string | null
  username: string | null
  content: string | null
  messageType: string
  clientMessageId: string | null
  sequenceNumber: number
  replyToMessageId: string | null
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
}

type TypingEvent = {
  conversationId: string
  username: string
  isTyping: boolean
}

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'
const EMPTY_MESSAGES: Message[] = []

function conversationDisplayTitle(
  conversation: Conversation | null | undefined,
  fallback = 'Conversation',
) {
  const title = conversation?.title ?? fallback
  return conversation?.type === 'direct' && conversation.memberCount === 1
    ? `${title} (You)`
    : title
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function avatarColor(name: string) {
  const colors = ['#e7654b', '#7456d6', '#278b7b', '#d48c2f', '#3478c6']
  const hash = [...name].reduce((total, character) => total + character.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function dateLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message ?? 'Something went wrong. Please try again.'
  } catch {
    return 'The chat service could not complete that request.'
  }
}

function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const response = await fetch(`${API_URL}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      if (!response.ok) throw new Error(await readError(response))
      onLogin((await response.json()) as User)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The chat service is unavailable.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Welcome to Huddle">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <MessageCircleMore size={22} strokeWidth={2.5} />
          </span>
          <span>Huddle</span>
        </div>
        <div className="story-copy">
          <p className="eyebrow">A calmer place to chat</p>
          <h1>Good conversation starts with showing up.</h1>
          <p>
            Share an idea, ask a question, or simply say hello. Your team is
            already here.
          </p>
        </div>
        <div className="conversation-preview" aria-hidden="true">
          <div className="preview-avatar preview-avatar-one">AK</div>
          <div className="preview-bubble">
            <span className="preview-name">Avery</span>
            The new direction feels exactly right.
          </div>
          <div className="preview-bubble preview-reply">
            <span className="preview-name">Mina</span>
            Agreed — let’s share it with everyone ✨
          </div>
        </div>
        <p className="story-footer">Simple, real-time, and made for people.</p>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-brand brand">
            <span className="brand-mark" aria-hidden="true">
              <MessageCircleMore size={20} />
            </span>
            <span>Huddle</span>
          </div>
          <div>
            <p className="eyebrow">Welcome in</p>
            <h2>Join the conversation</h2>
            <p className="login-subtitle">Choose a name people will recognize.</p>
          </div>
          <label htmlFor="username">Your name</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoFocus
            maxLength={50}
            placeholder="e.g. Jamie Chen"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-describedby={error ? 'login-error' : undefined}
          />
          {error && (
            <p className="form-error" id="login-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button"
            disabled={isSubmitting || username.trim().length < 2}
            type="submit"
          >
            {isSubmitting ? <LoaderCircle className="spin" size={18} /> : 'Enter Huddle'}
          </button>
          <p className="login-note">No password needed. Just bring your good self.</p>
        </form>
      </section>
    </main>
  )
}

function ChatApp({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, Message[]>
  >({})
  const [onlineUsers, setOnlineUsers] = useState<string[]>([])
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({})
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState('')
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [conversationDialog, setConversationDialog] = useState<
    'direct' | 'group' | 'add-members' | null
  >(null)
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [userResults, setUserResults] = useState<SearchUser[]>([])
  const [selectedUsers, setSelectedUsers] = useState<SearchUser[]>([])
  const [membersByConversation, setMembersByConversation] = useState<
    Record<string, ConversationMember[]>
  >({})
  const [isSearchingUsers, setIsSearchingUsers] = useState(false)
  const [isSavingMembers, setIsSavingMembers] = useState(false)
  const [creatingDirectUserId, setCreatingDirectUserId] = useState<string | null>(
    null,
  )
  const [dialogError, setDialogError] = useState('')
  const connectionRef = useRef<HubConnection | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const typingTimerRef = useRef<number | null>(null)

  const activeConversation = conversations.find((item) => item.id === activeId)
  const activeMessages = activeId
    ? messagesByConversation[activeId] ?? EMPTY_MESSAGES
    : EMPTY_MESSAGES
  const activeMembers = activeId ? membersByConversation[activeId] ?? [] : []

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const loadConversations = useCallback(async () => {
    const response = await fetch(
      `${API_URL}/api/conversations?username=${encodeURIComponent(user.username)}`,
    )
    if (!response.ok) throw new Error(await readError(response))
    const items = (await response.json()) as Conversation[]
    setConversations(items)
    setActiveId((current) => current ?? items[0]?.id ?? null)
  }, [user.username])

  const loadMembers = useCallback(
    async (conversationId: string) => {
      const response = await fetch(
        `${API_URL}/api/conversations/${conversationId}/members?username=${encodeURIComponent(
          user.username,
        )}`,
      )
      if (!response.ok) throw new Error(await readError(response))
      const members = (await response.json()) as ConversationMember[]
      setMembersByConversation((current) => ({
        ...current,
        [conversationId]: members,
      }))
      return members
    },
    [user.username],
  )

  useEffect(() => {
    loadConversations().catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : 'Could not load chats.')
    })
  }, [loadConversations])

  useEffect(() => {
    const connection = new HubConnectionBuilder()
      .withUrl(
        `${API_URL}/hubs/chat?username=${encodeURIComponent(user.username)}`,
      )
      .withAutomaticReconnect([0, 1500, 4000, 8000])
      .configureLogging(LogLevel.Warning)
      .build()

    connection.on('MessageReceived', (message: Message) => {
      setMessagesByConversation((current) => {
        const existing = current[message.conversationId] ?? []
        const found = existing.some(
          (item) =>
            item.id === message.id ||
            (item.clientMessageId &&
              item.clientMessageId === message.clientMessageId &&
              item.senderUserId === message.senderUserId),
        )
        if (found) return current

        return {
          ...current,
          [message.conversationId]: [...existing, message].sort(
            (a, b) => a.sequenceNumber - b.sequenceNumber,
          ),
        }
      })
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === message.conversationId
            ? {
                ...conversation,
                lastMessage: message.content,
                lastMessageSenderUserId: message.senderUserId,
                lastMessageSenderName: message.username,
                lastMessageAt: message.createdAt,
                unreadCount:
                  activeIdRef.current === message.conversationId
                    ? 0
                    : conversation.unreadCount + 1,
              }
            : conversation,
        ),
      )
      if (activeIdRef.current === message.conversationId) {
        void connection.invoke('MarkRead', message.conversationId, message.sequenceNumber)
      }
    })
    connection.on('PresenceChanged', (usernames: string[]) => {
      setOnlineUsers(usernames)
      const onlineSet = new Set(usernames.map((name) => name.toLocaleLowerCase()))
      setMembersByConversation((current) =>
        Object.fromEntries(
          Object.entries(current).map(([conversationId, members]) => [
            conversationId,
            members.map((member) => ({
              ...member,
              isOnline: onlineSet.has(member.username.toLocaleLowerCase()),
            })),
          ]),
        ),
      )
    })
    connection.on('ConversationAdded', (conversation: Conversation) => {
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ])
    })
    connection.on('MembersChanged', (event: MembersChangedEvent) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === event.conversationId
            ? { ...conversation, memberCount: event.memberCount }
            : conversation,
        ),
      )
      if (activeIdRef.current === event.conversationId) {
        void loadMembers(event.conversationId)
      }
    })
    connection.on('UserTyping', (event: TypingEvent) => {
      setTypingUsers((current) => {
        const previous = current[event.conversationId] ?? []
        const next = event.isTyping
          ? [...new Set([...previous, event.username])]
          : previous.filter(
              (name) => name.toLocaleLowerCase() !== event.username.toLocaleLowerCase(),
            )
        return { ...current, [event.conversationId]: next }
      })
    })
    connection.onreconnecting(() => setStatus('reconnecting'))
    connection.onreconnected(() => setStatus('connected'))
    connection.onclose(() => setStatus('offline'))

    connectionRef.current = connection
    connection
      .start()
      .then(() => setStatus('connected'))
      .catch(() => {
        setStatus('offline')
        setError('Live chat is offline. Check that the server is running.')
      })

    return () => {
      connectionRef.current = null
      void connection.stop()
    }
  }, [loadMembers, user.username])

  useEffect(() => {
    if (!conversationDialog) return

    const abortController = new AbortController()
    const timer = window.setTimeout(() => {
      setIsSearchingUsers(true)
      const conversationFilter =
        conversationDialog === 'add-members' && activeId
          ? `&conversationId=${encodeURIComponent(activeId)}`
          : ''
      fetch(
        `${API_URL}/api/users?currentUsername=${encodeURIComponent(
          user.username,
        )}&query=${encodeURIComponent(userQuery.trim())}${conversationFilter}`,
        { signal: abortController.signal },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error(await readError(response))
          return (await response.json()) as SearchUser[]
        })
        .then(setUserResults)
        .catch((requestError) => {
          if (requestError instanceof DOMException && requestError.name === 'AbortError') {
            return
          }
          setDialogError(
            requestError instanceof Error
              ? requestError.message
              : 'Could not find people.',
          )
        })
        .finally(() => {
          if (!abortController.signal.aborted) setIsSearchingUsers(false)
        })
    }, 220)

    return () => {
      window.clearTimeout(timer)
      abortController.abort()
    }
  }, [activeId, conversationDialog, user.username, userQuery])

  useEffect(() => {
    if (!activeId) return
    setIsLoadingMessages(true)
    setConversations((current) =>
      current.map((item) =>
        item.id === activeId ? { ...item, unreadCount: 0 } : item,
      ),
    )

    fetch(
      `${API_URL}/api/conversations/${activeId}/messages?username=${encodeURIComponent(user.username)}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response))
        return (await response.json()) as Message[]
      })
      .then((messages) => {
        setMessagesByConversation((current) => ({
          ...current,
          [activeId]: messages,
        }))
        const lastMessage = messages.at(-1)
        if (lastMessage && connectionRef.current?.state === HubConnectionState.Connected) {
          return connectionRef.current.invoke(
            'MarkRead',
            activeId,
            lastMessage.sequenceNumber,
          )
        }
      })
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : 'Could not load messages.')
      })
      .finally(() => setIsLoadingMessages(false))
  }, [activeId, user.username])

  useEffect(() => {
    if (!activeId || activeConversation?.type !== 'group') return
    loadMembers(activeId).catch((requestError) => {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not load group members.',
      )
    })
  }, [activeConversation?.type, activeId, loadMembers])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeMessages.length, activeId])

  const groupedMessages = useMemo(() => {
    return activeMessages.map((message, index) => {
      const previous = activeMessages[index - 1]
      const startsDay =
        !previous ||
        new Date(previous.createdAt).toDateString() !==
          new Date(message.createdAt).toDateString()
      const startsGroup =
        !previous ||
        previous.senderUserId !== message.senderUserId ||
        new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() >
          5 * 60 * 1000
      return { message, startsDay, startsGroup }
    })
  }, [activeMessages])

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault()
    const content = draft.trim()
    const connection = connectionRef.current
    if (
      !content ||
      !activeId ||
      !connection ||
      connection.state !== HubConnectionState.Connected
    ) {
      return
    }

    setDraft('')
    setError('')
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current)
    try {
      await connection.invoke('SetTyping', activeId, false)
      await connection.invoke('SendMessage', {
        conversationId: activeId,
        content,
        clientMessageId: crypto.randomUUID(),
      })
    } catch (requestError) {
      setDraft(content)
      setError(
        requestError instanceof Error ? requestError.message : 'Your message was not sent.',
      )
    }
  }

  function handleDraftChange(value: string) {
    setDraft(value)
    const connection = connectionRef.current
    if (!activeId || connection?.state !== HubConnectionState.Connected) return

    void connection.invoke('SetTyping', activeId, value.trim().length > 0)
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current)
    typingTimerRef.current = window.setTimeout(() => {
      void connection.invoke('SetTyping', activeId, false)
    }, 1200)
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault()
    const title = newGroupTitle.trim()
    if (title.length < 2 || selectedUsers.length === 0) return

    setIsSavingMembers(true)
    setDialogError('')
    try {
      const response = await fetch(
        `${API_URL}/api/conversations?username=${encodeURIComponent(user.username)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            usernames: selectedUsers.map((selectedUser) => selectedUser.username),
          }),
        },
      )
      if (!response.ok) throw new Error(await readError(response))

      const conversation = (await response.json()) as Conversation
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ])
      setActiveId(conversation.id)
      setNewGroupTitle('')
      setSelectedUsers([])
      setUserQuery('')
      setConversationDialog(null)
      setIsSidebarOpen(false)
      await connectionRef.current?.invoke('JoinConversation', conversation.id)
    } catch (requestError) {
      setDialogError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not create the group.',
      )
    } finally {
      setIsSavingMembers(false)
    }
  }

  async function createDirectConversation(targetUser: SearchUser) {
    setCreatingDirectUserId(targetUser.id)
    setDialogError('')

    try {
      const response = await fetch(
        `${API_URL}/api/conversations/direct?username=${encodeURIComponent(
          user.username,
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: targetUser.username }),
        },
      )
      if (!response.ok) throw new Error(await readError(response))

      const conversation = (await response.json()) as Conversation
      setConversations((current) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ])
      setActiveId(conversation.id)
      setConversationDialog(null)
      setUserQuery('')
      setIsSidebarOpen(false)
      await connectionRef.current?.invoke('JoinConversation', conversation.id)
    } catch (requestError) {
      setDialogError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not start that conversation.',
      )
    } finally {
      setCreatingDirectUserId(null)
    }
  }

  function toggleSelectedUser(selectedUser: SearchUser) {
    setSelectedUsers((current) =>
      current.some((item) => item.id === selectedUser.id)
        ? current.filter((item) => item.id !== selectedUser.id)
        : [...current, selectedUser],
    )
    setDialogError('')
  }

  function openConversationDialog(mode: 'direct' | 'group' | 'add-members') {
    setConversationDialog(mode)
    setDialogError('')
    setUserQuery('')
    setUserResults([])
    setSelectedUsers([])
  }

  async function addMembers(event: FormEvent) {
    event.preventDefault()
    if (!activeId || selectedUsers.length === 0) return

    setIsSavingMembers(true)
    setDialogError('')
    try {
      const response = await fetch(
        `${API_URL}/api/conversations/${activeId}/members?username=${encodeURIComponent(
          user.username,
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            usernames: selectedUsers.map((selectedUser) => selectedUser.username),
          }),
        },
      )
      if (!response.ok) throw new Error(await readError(response))

      const members = (await response.json()) as ConversationMember[]
      setMembersByConversation((current) => ({
        ...current,
        [activeId]: members,
      }))
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeId
            ? { ...conversation, memberCount: members.length }
            : conversation,
        ),
      )
      setConversationDialog(null)
      setSelectedUsers([])
      setUserQuery('')
    } catch (requestError) {
      setDialogError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not add those people.',
      )
    } finally {
      setIsSavingMembers(false)
    }
  }

  const currentTypingUsers = activeId ? typingUsers[activeId] ?? [] : []
  const isOnline = status === 'connected'

  return (
    <main className="chat-shell">
      <button
        className={`mobile-scrim ${isSidebarOpen ? 'visible' : ''}`}
        aria-label="Close conversation menu"
        onClick={() => setIsSidebarOpen(false)}
      />
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand brand">
          <span className="brand-mark">
            <MessageCircleMore size={20} strokeWidth={2.5} />
          </span>
          <span>Huddle</span>
          <button
            className="icon-button mobile-close"
            aria-label="Close menu"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-heading">
            <span>Conversations</span>
            <button
              className="icon-button"
              aria-label="Create a conversation"
              onClick={() => openConversationDialog('direct')}
            >
              <Plus size={17} />
            </button>
          </div>
          <nav aria-label="Conversations">
            {conversations.map((conversation) => (
              <button
                className={`conversation-item ${
                  conversation.id === activeId ? 'active' : ''
                }`}
                key={conversation.id}
                onClick={() => {
                  setActiveId(conversation.id)
                  setIsSidebarOpen(false)
                }}
              >
                <span
                  className={`channel-icon ${
                    conversation.type === 'direct' ? 'direct-icon' : ''
                  }`}
                  style={
                    conversation.type === 'direct'
                      ? { backgroundColor: avatarColor(conversation.title ?? '') }
                      : undefined
                  }
                >
                  {conversation.type === 'direct' ? (
                    initials(conversation.title ?? 'Direct')
                  ) : (
                    <Hash size={17} />
                  )}
                </span>
                <span className="conversation-copy">
                  <strong>{conversationDisplayTitle(conversation)}</strong>
                  {conversation.lastMessage && conversation.lastMessageAt ? (
                    <small className="conversation-summary">
                      <span className="preview-sender">
                        {conversation.lastMessageSenderUserId === user.id
                          ? 'You'
                          : (conversation.lastMessageSenderName ?? 'Someone')}
                        :
                      </span>
                      <span className="preview-message">{conversation.lastMessage}</span>
                      <time dateTime={conversation.lastMessageAt}>
                        {formatTime(conversation.lastMessageAt)}
                      </time>
                    </small>
                  ) : (
                    <small>Start the conversation</small>
                  )}
                </span>
                {conversation.unreadCount > 0 && (
                  <span className="unread-badge">{conversation.unreadCount}</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-user">
          <span
            className="avatar avatar-small"
            style={{ backgroundColor: avatarColor(user.username) }}
          >
            {initials(user.displayName)}
            <i className="presence-dot" aria-label="Online" />
          </span>
          <span className="sidebar-user-copy">
            <strong>{user.displayName}</strong>
            <small>Online</small>
          </span>
          <button className="icon-button" aria-label="Sign out" onClick={onLogout}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <section className="conversation-panel">
        <header className="conversation-header">
          <button
            className="icon-button mobile-menu"
            aria-label="Open conversation menu"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="conversation-title">
            <span
              className={`header-channel-icon ${
                activeConversation?.type === 'direct' ? 'direct-icon' : ''
              }`}
              style={
                activeConversation?.type === 'direct'
                  ? {
                      backgroundColor: avatarColor(activeConversation.title ?? ''),
                    }
                  : undefined
              }
            >
              {activeConversation?.type === 'direct' ? (
                initials(activeConversation.title ?? 'Direct')
              ) : (
                <Hash size={19} />
              )}
            </span>
            <div>
              <h1>{conversationDisplayTitle(activeConversation, 'Welcome')}</h1>
              <p>
                {activeConversation?.type === 'direct'
                  ? 'Direct conversation'
                  : `${activeConversation?.memberCount ?? 0} ${
                      activeConversation?.memberCount === 1 ? 'member' : 'members'
                    } · ${activeMembers.filter((member) => member.isOnline).length} online`}
              </p>
            </div>
          </div>
          {activeConversation?.type === 'group' && (
            <button
              className="icon-button header-add-member"
              aria-label="Add people to this group"
              onClick={() => openConversationDialog('add-members')}
            >
              <UserRoundPlus size={17} />
            </button>
          )}
          <div className={`connection-pill ${status}`}>
            {status === 'offline' ? <WifiOff size={13} /> : <span />}
            {status === 'connected'
              ? 'Live'
              : status === 'reconnecting'
                ? 'Reconnecting'
                : status === 'offline'
                  ? 'Offline'
                  : 'Connecting'}
          </div>
        </header>

        {error && (
          <div className="chat-error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        <div className="message-list" aria-live="polite">
          {isLoadingMessages ? (
            <div className="center-state">
              <LoaderCircle className="spin" size={24} />
              <p>Bringing in the conversation…</p>
            </div>
          ) : activeMessages.length === 0 ? (
            <div className="empty-chat">
              <span className="empty-icon">
                <MessageCircleMore size={26} />
              </span>
              <h2>This is the beginning.</h2>
              <p>
                {activeConversation?.type === 'direct' ? (
                  <>
                    Say hello to{' '}
                    <strong>
                      {conversationDisplayTitle(activeConversation, 'this person')}
                    </strong>
                    . A good conversation only needs one first message.
                  </>
                ) : (
                  <>
                    Say hello in{' '}
                    <strong>#{activeConversation?.title ?? 'this chat'}</strong>. A
                    good conversation only needs one first message.
                  </>
                )}
              </p>
            </div>
          ) : (
            groupedMessages.map(({ message, startsDay, startsGroup }) => {
              const isOwnMessage = message.senderUserId === user.id

              return (
                <div key={message.id}>
                  {startsDay && (
                    <div className="date-divider">
                      <span>{dateLabel(message.createdAt)}</span>
                    </div>
                  )}
                  <article
                    className={`message ${startsGroup ? 'group-start' : 'compact'} ${
                      isOwnMessage ? 'own-message' : ''
                    }`}
                  >
                    {startsGroup && !isOwnMessage ? (
                      <span
                        className="avatar"
                        style={{
                          backgroundColor: avatarColor(message.username ?? 'System'),
                        }}
                      >
                        {initials(message.username ?? 'System')}
                      </span>
                    ) : !startsGroup ? (
                      <time className="compact-time">{formatTime(message.createdAt)}</time>
                    ) : null}
                    <div className="message-body">
                      {startsGroup && (
                        <div className="message-meta">
                          {!isOwnMessage && <strong>{message.username ?? 'System'}</strong>}
                          <time dateTime={message.createdAt}>
                            {formatTime(message.createdAt)}
                          </time>
                        </div>
                      )}
                      <p className={message.deletedAt ? 'deleted-message' : ''}>
                        {message.deletedAt ? 'This message was deleted.' : message.content}
                      </p>
                    </div>
                  </article>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="typing-line" aria-live="polite">
          {currentTypingUsers.length > 0 && (
            <>
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
              {currentTypingUsers.length === 1
                ? `${currentTypingUsers[0]} is typing`
                : `${currentTypingUsers.slice(0, 2).join(' and ')} are typing`}
            </>
          )}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <textarea
            aria-label={`Message ${conversationDisplayTitle(
              activeConversation,
              'conversation',
            )}`}
            disabled={!activeConversation || !isOnline}
            maxLength={2000}
            placeholder={
              isOnline
                ? `Message ${
                    activeConversation?.type === 'direct' ? '' : '#'
                  }${conversationDisplayTitle(activeConversation, 'conversation')}`
                : 'Waiting for a live connection…'
            }
            rows={1}
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          <button
            className="send-button"
            type="submit"
            disabled={!draft.trim() || !isOnline}
            aria-label="Send message"
          >
            <Send size={18} />
          </button>
          <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
        </form>
      </section>

      <aside className="people-panel">
        <div className="people-heading">
          <Users size={17} />
          <span>
            {activeConversation?.type === 'group' ? 'Group members' : 'Online now'}
          </span>
          <strong>
            {activeConversation?.type === 'group'
              ? activeConversation.memberCount
              : onlineUsers.length}
          </strong>
          {activeConversation?.type === 'group' && (
            <button
              className="icon-button add-member-button"
              aria-label="Add people to this group"
              onClick={() => openConversationDialog('add-members')}
            >
              <UserRoundPlus size={16} />
            </button>
          )}
        </div>
        <div className="people-list">
          {activeConversation?.type === 'group'
            ? activeMembers.map((member) => (
                <div className="person" key={member.id}>
                  <span
                    className="avatar avatar-small"
                    style={{ backgroundColor: avatarColor(member.username) }}
                  >
                    {initials(member.displayName)}
                    {member.isOnline && <i className="presence-dot" />}
                  </span>
                  <span>
                    <strong>
                      {member.displayName}
                      {member.id === user.id ? ' (you)' : ''}
                    </strong>
                    <small>
                      {member.role === 'owner'
                        ? 'Owner'
                        : member.isOnline
                          ? 'Online'
                          : 'Offline'}
                    </small>
                  </span>
                </div>
              ))
            : onlineUsers.map((name) => (
                <div className="person" key={name}>
                  <span
                    className="avatar avatar-small"
                    style={{ backgroundColor: avatarColor(name) }}
                  >
                    {initials(name)}
                    <i className="presence-dot" />
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>{name === user.username ? 'You' : 'Available'}</small>
                  </span>
                </div>
              ))}
        </div>
        <div className="people-note">
          <span>✦</span>
          <p>Small conversations can lead to big ideas.</p>
        </div>
      </aside>

      {conversationDialog && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <p className="eyebrow">New conversation</p>
                <h2>
                  {conversationDialog === 'direct'
                    ? 'Message someone'
                    : conversationDialog === 'group'
                      ? 'Create a group'
                      : 'Add people'}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close"
                onClick={() => {
                  setConversationDialog(null)
                  setSelectedUsers([])
                  setUserQuery('')
                }}
              >
                <X size={20} />
              </button>
            </div>
            {conversationDialog !== 'add-members' && (
              <div className="dialog-tabs" role="tablist" aria-label="Conversation type">
                <button
                  className={conversationDialog === 'direct' ? 'active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={conversationDialog === 'direct'}
                  onClick={() => openConversationDialog('direct')}
                >
                  <UserRoundPlus size={16} />
                  Direct message
                </button>
                <button
                  className={conversationDialog === 'group' ? 'active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={conversationDialog === 'group'}
                  onClick={() => openConversationDialog('group')}
                >
                  <Hash size={16} />
                  Group space
                </button>
              </div>
            )}

            {conversationDialog === 'direct' ? (
              <div className="direct-picker">
                <label htmlFor="user-search">Find a person</label>
                <div className="search-field">
                  <Search size={17} />
                  <input
                    id="user-search"
                    autoFocus
                    placeholder="Search by name or username"
                    value={userQuery}
                    onChange={(event) => {
                      setDialogError('')
                      setUserQuery(event.target.value)
                    }}
                  />
                </div>
                <div className="user-results" aria-live="polite">
                  {isSearchingUsers ? (
                    <div className="picker-state">
                      <LoaderCircle className="spin" size={18} />
                      Finding people…
                    </div>
                  ) : userResults.length === 0 ? (
                    <div className="picker-state">No other users found.</div>
                  ) : (
                    userResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        className="user-result"
                        disabled={creatingDirectUserId !== null}
                        onClick={() => void createDirectConversation(result)}
                      >
                        <span
                          className="avatar avatar-small"
                          style={{ backgroundColor: avatarColor(result.username) }}
                        >
                          {initials(result.displayName)}
                        </span>
                        <span>
                          <strong>{result.displayName}</strong>
                          <small>@{result.username}</small>
                        </span>
                        {creatingDirectUserId === result.id ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : (
                          <MessageCircleMore size={17} />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <form
                className="group-picker"
                onSubmit={
                  conversationDialog === 'group' ? createGroup : addMembers
                }
              >
                {conversationDialog === 'group' && (
                  <>
                    <label htmlFor="group-title">Group name</label>
                    <input
                      id="group-title"
                      autoFocus
                      maxLength={200}
                      placeholder="e.g. Product ideas"
                      value={newGroupTitle}
                      onChange={(event) => setNewGroupTitle(event.target.value)}
                    />
                  </>
                )}

                <div className="picker-label-row">
                  <label htmlFor="group-user-search">
                    {conversationDialog === 'group'
                      ? 'Add people'
                      : `Add to ${activeConversation?.title ?? 'group'}`}
                  </label>
                  <span>{selectedUsers.length} selected</span>
                </div>

                {selectedUsers.length > 0 && (
                  <div className="selected-users" aria-label="Selected people">
                    {selectedUsers.map((selectedUser) => (
                      <button
                        key={selectedUser.id}
                        type="button"
                        onClick={() => toggleSelectedUser(selectedUser)}
                        aria-label={`Remove ${selectedUser.displayName}`}
                      >
                        <span
                          className="avatar"
                          style={{
                            backgroundColor: avatarColor(selectedUser.username),
                          }}
                        >
                          {initials(selectedUser.displayName)}
                        </span>
                        {selectedUser.displayName}
                        <X size={13} />
                      </button>
                    ))}
                  </div>
                )}

                <div className="search-field">
                  <Search size={17} />
                  <input
                    id="group-user-search"
                    autoFocus={conversationDialog === 'add-members'}
                    placeholder="Search people"
                    value={userQuery}
                    onChange={(event) => {
                      setDialogError('')
                      setUserQuery(event.target.value)
                    }}
                  />
                </div>

                <div className="user-results multi-select-results" aria-live="polite">
                  {isSearchingUsers ? (
                    <div className="picker-state">
                      <LoaderCircle className="spin" size={18} />
                      Finding people…
                    </div>
                  ) : userResults.length === 0 ? (
                    <div className="picker-state">
                      {conversationDialog === 'add-members'
                        ? 'Everyone available is already in this group.'
                        : 'No other users found.'}
                    </div>
                  ) : (
                    userResults.map((result) => {
                      const isSelected = selectedUsers.some(
                        (selectedUser) => selectedUser.id === result.id,
                      )
                      return (
                        <button
                          key={result.id}
                          type="button"
                          className={`user-result ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleSelectedUser(result)}
                          aria-pressed={isSelected}
                        >
                          <span
                            className="avatar avatar-small"
                            style={{ backgroundColor: avatarColor(result.username) }}
                          >
                            {initials(result.displayName)}
                          </span>
                          <span>
                            <strong>{result.displayName}</strong>
                            <small>@{result.username}</small>
                          </span>
                          <span className="selection-check">
                            {isSelected && <Check size={14} />}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>

                <button
                  className="primary-button"
                  disabled={
                    isSavingMembers ||
                    selectedUsers.length === 0 ||
                    (conversationDialog === 'group' &&
                      newGroupTitle.trim().length < 2)
                  }
                  type="submit"
                >
                  {isSavingMembers ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : conversationDialog === 'group' ? (
                    `Create group with ${selectedUsers.length + 1} people`
                  ) : (
                    `Add ${selectedUsers.length} ${
                      selectedUsers.length === 1 ? 'person' : 'people'
                    }`
                  )}
                </button>
              </form>
            )}
            {dialogError && (
              <p className="form-error" role="alert">
                {dialogError}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

function App() {
  const [user, setUser] = useState<User | null>(null)

  return user ? (
    <ChatApp user={user} onLogout={() => setUser(null)} />
  ) : (
    <LoginScreen onLogin={setUser} />
  )
}

export default App
