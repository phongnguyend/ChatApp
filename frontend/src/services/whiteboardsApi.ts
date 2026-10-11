import { API_URL, authFetch } from './auth';

export class BoardError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function boardsApi<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await authFetch(`${API_URL}/api/whiteboards${path}`, {
    method, headers: body === undefined || body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new BoardError(data.error ?? 'Unable to update this whiteboard.', response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}
