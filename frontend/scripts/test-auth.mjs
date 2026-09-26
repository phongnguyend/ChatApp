import { randomUUID } from 'node:crypto'

// Test accounts are created through the real administrator API, with no auth bypass.
export function testAuthentication(apiUrl) {
  const tokens = new Map()
  let adminToken
  async function json(path, options = {}, token) {
    const response = await globalThis.fetch(`${apiUrl}${path}`, {
      ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (!response.ok) throw new Error(`Test setup failed (${response.status}): ${await response.text()}`)
    return response.status === 204 ? null : response.json()
  }
  async function login(name) {
    if (!adminToken) {
      const username = process.env.TEST_ADMIN_EMAIL
      const password = process.env.TEST_ADMIN_PASSWORD
      if (!username || !password) throw new Error('Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD for a disposable test environment.')
      adminToken = (await json('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })).accessToken
    }
    const email = `${name.toLowerCase().replaceAll(' ', '-').slice(0, 25)}-${randomUUID().slice(0, 8)}@test.local`
    const password = `Test-${randomUUID()}-aA!`
    const user = await json('/api/admin/users', { method: 'POST', body: JSON.stringify({ email, isEnabled: true, roles: ['User'] }) }, adminToken)
    await json(`/api/admin/users/${user.id}/password-authentication`, { method: 'PUT', body: JSON.stringify({ allowPasswordAuthentication: true, password }) }, adminToken)
    const token = (await json('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: email, password }) })).accessToken
    const profile = await json('/api/session', { method: 'POST' }, token)
    tokens.set(profile.username, token)
    return profile
  }
  function fetch(input, options = {}) {
    const url = new URL(input)
    const username = url.searchParams.get('username') ?? url.searchParams.get('currentUsername')
    const token = tokens.get(username)
    return globalThis.fetch(input, { ...options, headers: { ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  }
  return { login, fetch, accessToken: username => tokens.get(username) ?? '' }
}
