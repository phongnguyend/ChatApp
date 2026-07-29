import { HubConnectionBuilder } from '@microsoft/signalr'

const apiUrl = process.argv[2] ?? process.env.VITE_API_URL ?? 'http://localhost:5045'
const username = `Live Test ${Date.now()}`

const loginResponse = await fetch(`${apiUrl}/api/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username }),
})
if (!loginResponse.ok) throw new Error(await loginResponse.text())
const user = await loginResponse.json()

const conversationResponse = await fetch(
  `${apiUrl}/api/conversations?username=${encodeURIComponent(user.username)}`,
)
if (!conversationResponse.ok) {
  throw new Error(await conversationResponse.text())
}
const conversations = await conversationResponse.json()
const conversation = conversations.find((item) => item.title === 'General')
if (!conversation) throw new Error('General conversation was not found.')

const connection = new HubConnectionBuilder()
  .withUrl(
    `${apiUrl}/hubs/chat?username=${encodeURIComponent(user.username)}`,
  )
  .build()

let resolveUpdate
let resolveStop
const updateEvent = new Promise((resolve) => {
  resolveUpdate = resolve
})
const stopEvent = new Promise((resolve) => {
  resolveStop = resolve
})
connection.on('LiveLocationUpdated', resolveUpdate)
connection.on('LiveLocationStopped', resolveStop)

await connection.start()
try {
  const message = await connection.invoke('StartLiveLocation', {
    conversationId: conversation.id,
    clientMessageId: crypto.randomUUID(),
    latitude: 13.756331,
    longitude: 100.501762,
    accuracyMeters: 8.5,
    durationMinutes: 15,
  })
  if (
    message.messageType !== 'live_location' ||
    !message.liveLocation?.isActive
  ) {
    throw new Error('Start did not return an active live location.')
  }

  await connection.invoke('UpdateLiveLocation', {
    messageId: message.id,
    latitude: 13.7565,
    longitude: 100.502,
    accuracyMeters: 7,
  })
  const updated = await withTimeout(updateEvent, 'Update event timed out.')
  if (Number(updated.latitude) !== 13.7565) {
    throw new Error('Updated latitude was not broadcast.')
  }

  await connection.invoke('StopLiveLocation', message.id)
  const stopped = await withTimeout(stopEvent, 'Stop event timed out.')
  const deleteResponse = await fetch(
    `${apiUrl}/api/messages/${message.id}?username=${encodeURIComponent(user.username)}`,
    { method: 'DELETE' },
  )
  if (!deleteResponse.ok) throw new Error(await deleteResponse.text())

  console.log(
    JSON.stringify({
      messageType: message.messageType,
      updatedLatitude: updated.latitude,
      stoppedAt: stopped.stoppedAt,
    }),
  )
} finally {
  await connection.stop()
}

function withTimeout(promise, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), 5_000),
    ),
  ])
}
