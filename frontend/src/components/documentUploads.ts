import { authFetch as fetch } from "../services/auth";
type ConflictChoice = "ask" | "replace" | "keepBoth";

type UploadStatus = {
  id: string;
  fingerprint: string;
  sizeBytes: number;
  chunkSize: number;
  chunkCount: number;
  uploadedChunks: number[];
  uploadedChunkHashes: Record<string, string>;
  completedFile: unknown | null;
};

export type UploadProgress = { name: string; uploadedBytes: number; totalBytes: number };

function sessionKey(currentUsername: string, file: File, folderId: string | null, replaceFileId: string | null) {
  return `document-upload:${currentUsername}:${folderId ?? "root"}:${replaceFileId ?? "new"}:${file.name}:${file.size}:${file.lastModified}`;
}

function readSession(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function saveSession(key: string, id: string) { try { localStorage.setItem(key, id); } catch { /* Upload still works without local storage. */ } }
function clearSession(key: string) { try { localStorage.removeItem(key); } catch { /* The server remains authoritative. */ } }

export async function discardDocumentUpload(baseUrl: string, usernameQuery: string,
  currentUsername: string, file: File, folderId: string | null, replaceFileId: string | null = null) {
  const key = sessionKey(currentUsername, file, folderId, replaceFileId);
  const id = readSession(key);
  if (!id) return;
  const response = await fetch(`${baseUrl}/uploads/${id}?${usernameQuery}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`Could not cancel the previous upload (${response.status}).`);
  clearSession(key);
}

async function sha256(data: Blob | ArrayBuffer): Promise<string> {
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fingerprint(file: File): Promise<string> {
  const edge = 1024 * 1024;
  const sample = new Blob([
    file.slice(0, edge),
    file.slice(Math.max(edge, file.size - edge)),
    new TextEncoder().encode(String(file.size)),
  ]);
  return sha256(sample);
}

async function retryChunk(url: string, bytes: ArrayBuffer, hash: string): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "X-Chunk-SHA256": hash },
        body: bytes,
      });
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 3) return response;
    } catch (error) { if (attempt === 3) throw error; }
    await new Promise((resolve) => window.setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw new Error("Could not upload this chunk.");
}

export async function uploadDocument(
  baseUrl: string,
  usernameQuery: string,
  currentUsername: string,
  file: File,
  folderId: string | null,
  choice: ConflictChoice,
  onProgress: (progress: UploadProgress) => void,
  replaceFileId: string | null = null,
): Promise<Response> {
  // The existing endpoint handles zero-byte files. Every nonempty file uses the resumable path.
  if (file.size === 0) {
    const body = new FormData();
    body.append("file", file);
    if (folderId) body.append("folderId", folderId);
    body.append("conflict", choice);
    return fetch(replaceFileId
      ? `${baseUrl}/files/${replaceFileId}/content?${usernameQuery}`
      : `${baseUrl}/files?${usernameQuery}`,
    { method: replaceFileId ? "PUT" : "POST", body });
  }

  const fileFingerprint = await fingerprint(file);
  const storageKey = sessionKey(currentUsername, file, folderId, replaceFileId);
  let status: UploadStatus | null = null;
  const savedId = readSession(storageKey);
  if (savedId) {
    const response = await fetch(`${baseUrl}/uploads/${savedId}?${usernameQuery}`);
    if (response.ok) {
      const saved = await response.json() as UploadStatus;
      if (saved.fingerprint === fileFingerprint && saved.sizeBytes === file.size) {
        let matches = true;
        if (!saved.completedFile) {
          for (const index of saved.uploadedChunks) {
            const part = file.slice(index * saved.chunkSize, Math.min(file.size, (index + 1) * saved.chunkSize));
            if (await sha256(part) !== saved.uploadedChunkHashes?.[index]) { matches = false; break; }
          }
        }
        if (matches) status = saved;
        else await discardDocumentUpload(baseUrl, usernameQuery, currentUsername, file, folderId, replaceFileId);
      } else await discardDocumentUpload(baseUrl, usernameQuery, currentUsername, file, folderId, replaceFileId);
    } else if (response.status !== 404) return response;
    if (!status) clearSession(storageKey);
  }
  if (!status) {
    const response = await fetch(`${baseUrl}/uploads?${usernameQuery}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, folderId, replaceFileId, contentType: file.type || "application/octet-stream", sizeBytes: file.size, fingerprint: fileFingerprint, conflict: choice }),
    });
    if (!response.ok) return response;
    status = await response.json() as UploadStatus;
    saveSession(storageKey, status.id);
  }
  if (status.completedFile) {
    clearSession(storageKey);
    onProgress({ name: file.name, uploadedBytes: file.size, totalBytes: file.size });
    return new Response(JSON.stringify(status.completedFile), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const uploaded = new Set(status.uploadedChunks);
  const completedBytes = () => Array.from(uploaded).reduce((total, index) =>
    total + Math.min(status!.chunkSize, file.size - index * status!.chunkSize), 0);
  onProgress({ name: file.name, uploadedBytes: completedBytes(), totalBytes: file.size });
  for (let index = 0; index < status.chunkCount; index += 1) {
    if (uploaded.has(index)) continue;
    const bytes = await file.slice(index * status.chunkSize, Math.min(file.size, (index + 1) * status.chunkSize)).arrayBuffer();
    const response = await retryChunk(`${baseUrl}/uploads/${status.id}/chunks/${index}?${usernameQuery}`, bytes, await sha256(bytes));
    if (!response.ok) return response;
    uploaded.add(index);
    onProgress({ name: file.name, uploadedBytes: completedBytes(), totalBytes: file.size });
  }
  const response = await fetch(`${baseUrl}/uploads/${status.id}/complete?${usernameQuery}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conflict: choice }),
  });
  if (response.ok) clearSession(storageKey);
  return response;
}
