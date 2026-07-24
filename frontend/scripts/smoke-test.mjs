import { HubConnectionBuilder } from '@microsoft/signalr'

const apiUrl = process.env.VITE_API_URL ?? 'http://localhost:5045'
const suffix = Date.now().toString().slice(-6)

async function login(username) {
  const response = await fetch(`${apiUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  return response.json()
}

const alice = await login(`Alice ${suffix}`)
const bob = await login(`Bob ${suffix}`)
const charlie = await login(`Charlie ${suffix}`)
const diana = await login(`Diana ${suffix}`)
const conversationResponse = await fetch(
  `${apiUrl}/api/conversations?username=${encodeURIComponent(alice.username)}`,
)
const conversations = await conversationResponse.json()
const general = conversations.find((conversation) => conversation.title === 'General')

if (!general) {
  throw new Error('The General conversation was not created.')
}

const aliceConnection = new HubConnectionBuilder()
  .withUrl(`${apiUrl}/hubs/chat?username=${encodeURIComponent(alice.username)}`)
  .build()
const bobConnection = new HubConnectionBuilder()
  .withUrl(`${apiUrl}/hubs/chat?username=${encodeURIComponent(bob.username)}`)
  .build()
const dianaConnection = new HubConnectionBuilder()
  .withUrl(`${apiUrl}/hubs/chat?username=${encodeURIComponent(diana.username)}`)
  .build()

let liveMessage
let directConversationForBob
let createdGroupForBob
let updatedGroupForDiana
bobConnection.on('MessageReceived', (message) => {
  liveMessage = message
})
bobConnection.on('ConversationAdded', (conversation) => {
  if (conversation.type === 'direct') {
    directConversationForBob = conversation
  } else {
    createdGroupForBob = conversation
  }
})
dianaConnection.on('ConversationAdded', (conversation) => {
  if (conversation.type === 'group') {
    updatedGroupForDiana = conversation
  }
})

await aliceConnection.start()
await bobConnection.start()
await dianaConnection.start()

const discoveredUsers = await (
  await fetch(
    `${apiUrl}/api/users?currentUsername=${encodeURIComponent(
      alice.username,
    )}&query=${encodeURIComponent(bob.username)}`,
  )
).json()
if (!discoveredUsers.some((user) => user.id === bob.id)) {
  throw new Error('User discovery did not return the intended recipient.')
}

async function createDirectConversation() {
  const response = await fetch(
    `${apiUrl}/api/conversations/direct?username=${encodeURIComponent(
      alice.username,
    )}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: bob.username }),
    },
  )
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return response.json()
}

const directConversation = await createDirectConversation()
const duplicateRequest = await createDirectConversation()
if (directConversation.id !== duplicateRequest.id) {
  throw new Error('The same user pair created two direct conversations.')
}

const groupResponse = await fetch(
  `${apiUrl}/api/conversations?username=${encodeURIComponent(alice.username)}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `Project ${suffix}`,
      usernames: [bob.username, charlie.username],
    }),
  },
)
if (!groupResponse.ok) {
  throw new Error(await groupResponse.text())
}
const groupConversation = await groupResponse.json()
if (groupConversation.memberCount !== 3) {
  throw new Error('The group was not created with all selected people.')
}

const addMembersResponse = await fetch(
  `${apiUrl}/api/conversations/${groupConversation.id}/members?username=${encodeURIComponent(
    alice.username,
  )}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      usernames: [bob.username, diana.username],
    }),
  },
)
if (!addMembersResponse.ok) {
  throw new Error(await addMembersResponse.text())
}
const groupMembers = await addMembersResponse.json()
if (groupMembers.length !== 4) {
  throw new Error('Adding people duplicated an existing member or omitted a new one.')
}

await aliceConnection.invoke('SendMessage', {
  conversationId: directConversation.id,
  content: 'Direct SignalR integration check',
  clientMessageId: crypto.randomUUID(),
})
await new Promise((resolve) => setTimeout(resolve, 500))

const historyResponse = await fetch(
  `${apiUrl}/api/conversations/${directConversation.id}/messages?username=${encodeURIComponent(bob.username)}`,
)
const history = await historyResponse.json()
const persistedMessage = history.at(-1)

await aliceConnection.stop()
await bobConnection.stop()
await dianaConnection.stop()

if (directConversationForBob?.title !== alice.displayName) {
  throw new Error('The recipient did not receive the new direct conversation live.')
}

if (createdGroupForBob?.id !== groupConversation.id) {
  throw new Error('A selected group member did not receive the new group live.')
}

if (
  updatedGroupForDiana?.id !== groupConversation.id ||
  updatedGroupForDiana?.memberCount !== 4
) {
  throw new Error('A newly added member did not receive the existing group live.')
}

if (liveMessage?.content !== 'Direct SignalR integration check') {
  throw new Error('The second client did not receive the live SignalR message.')
}

if (persistedMessage?.content !== 'Direct SignalR integration check') {
  throw new Error('The message was not persisted to SQL Server.')
}

console.log(
  JSON.stringify({
    conversation: directConversation.title,
    pairIsUnique: directConversation.id === duplicateRequest.id,
    recipientNotified: directConversationForBob.title,
    groupCreatedWith: groupConversation.memberCount,
    groupExpandedTo: groupMembers.length,
    addedMemberNotified: updatedGroupForDiana.title,
    liveReceived: liveMessage.content,
    persisted: persistedMessage.content,
  }),
)
