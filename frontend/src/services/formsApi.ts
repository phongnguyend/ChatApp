import { API_URL, authFetch } from './auth';

export class FormsError extends Error {
  errors: Record<string, string>;
  status: number;
  constructor(message: string, status: number, errors: Record<string, string> = {}) {
    super(message);
    this.errors = errors;
    this.status = status;
  }
}
export async function formsApi<T>(path: string, method = 'GET', body?: unknown, publicRequest = false): Promise<T> {
  const response = await (publicRequest ? window.fetch.bind(window) : authFetch)(`${API_URL}/api/${path}`, {
    method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new FormsError(response.status >= 500 ? 'The service is temporarily unavailable. Please try again.' : problem.error ?? 'Unable to complete this request.', response.status, problem.errors);
  }
  return response.status === 204 ? undefined as T : response.json();
}
