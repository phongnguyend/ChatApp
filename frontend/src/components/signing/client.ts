import { authFetch } from '../../services/auth'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5045'
async function response(path: string, init?: RequestInit) {
  const result = await authFetch(`${apiUrl}${path}`, init)
  if (!result.ok) {
    const body = await result.json().catch(() => null)
    throw new Error(body?.error ?? body?.message ?? `Request failed (${result.status}).`)
  }
  return result
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await response(path, init)).json()
}
async function downloadBlob(path: string, signal?: AbortSignal) {
  return (await response(path, { signal, cache: 'no-store' })).blob()
}
export const downloadAttachmentFile = (id: string, requestId: string, signal?: AbortSignal) =>
  downloadBlob(`${signaturesPath(id)}/${encodeURIComponent(requestId)}/original`, signal)

export interface SignatureRequest {
  id: string
  provider: string
  subject: string
  message: string | null
  recipientsJson: string
  status: string
  externalId: string | null
  createdAtUtc: string
}

const signaturesPath = (id: string) => `/api/documents/files/${encodeURIComponent(id)}/signatures`

export const getSigningProviders = (signal?: AbortSignal) => request<string[]>('/api/documents/files/signing-options', { signal })
export const listSignatureRequests = (id: string, signal?: AbortSignal) => request<SignatureRequest[]>(signaturesPath(id), { signal })
export const deleteSignatureRequest = (id: string, requestId: string) => request<{ deleted: boolean }>(
  `${signaturesPath(id)}/${encodeURIComponent(requestId)}`, { method: 'DELETE' })
export const createSignatureRequest = (id: string, input: {
  provider: string; subject: string; message: string; recipients: { name: string; email: string }[]; clientRequestId: string
}) => request<SignatureRequest>(signaturesPath(id), {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
})
export const prepareSignatureRequest = (id: string, requestId: string) => request<{ url: string }>(
  `${signaturesPath(id)}/${encodeURIComponent(requestId)}/prepare`, { method: 'POST' })
export const refreshSignatureRequest = (id: string, requestId: string) => request<SignatureRequest>(
  `${signaturesPath(id)}/${encodeURIComponent(requestId)}/refresh`, { method: 'POST' })
export const downloadSignatureDocument = (id: string, requestId: string, audit: boolean, signal?: AbortSignal) => downloadBlob(
  `${signaturesPath(id)}/${encodeURIComponent(requestId)}/download?audit=${audit}`, signal)

export type SigningFieldType = 'signature' | 'initials' | 'date' | 'text'

/** Coordinates are fractions of the displayed page, measured from its top-left corner. */
export interface SigningField {
  id: string
  type: SigningFieldType
  page: number
  x: number
  y: number
  width: number
  height: number
  value: string | null
}

export const getSigningFields = (id: string, requestId: string, signal?: AbortSignal) => request<{ status: string; fields: SigningField[] }>(
  `${signaturesPath(id)}/${encodeURIComponent(requestId)}/fields`, { signal, cache: 'no-store' })
export const saveSigningFields = (id: string, requestId: string, fields: SigningField[]) => request<{ status: string; fields: SigningField[] }>(
  `${signaturesPath(id)}/${encodeURIComponent(requestId)}/fields`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
  })
export const completeInAppSigning = (id: string, requestId: string, pdf: Blob) => request<SignatureRequest>(
  `${signaturesPath(id)}/${encodeURIComponent(requestId)}/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdf,
  })
