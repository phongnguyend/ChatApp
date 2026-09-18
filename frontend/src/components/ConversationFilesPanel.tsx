import { Download, FileImage, FileText, LoaderCircle, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ConversationFile = {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  senderUsername: string;
  senderDisplayName: string;
  sharedAt: string;
};
type ConversationFilesPage = { items: ConversationFile[]; hasMore: boolean };

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function ConversationFilesPanel({ apiUrl, currentUsername, scope, hidden, onOpenConversation }: {
  apiUrl: string;
  currentUsername: string;
  scope: "mine" | "others";
  hidden: boolean;
  onOpenConversation: (conversationId: string, messageId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<ConversationFile[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const baseUrl = `${apiUrl}/api/documents/conversation-files?username=${encodeURIComponent(currentUsername)}&scope=${scope}`;

  useEffect(() => {
    if (hidden) return;
    const controller = new AbortController();
    moreRequest.current?.abort();
    setFiles([]);
    setHasMore(false);
    setLoadingMore(false);
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${baseUrl}&query=${encodeURIComponent(query.trim())}&offset=0`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load conversation files (${response.status}).`);
        const page = await response.json() as ConversationFilesPage;
        if (!controller.signal.aborted) { setFiles(page.items); setHasMore(page.hasMore); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load conversation files.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, query.trim() ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); moreRequest.current?.abort(); };
  }, [baseUrl, query, hidden]);

  async function loadMore() {
    if (!hasMore || loading || loadingMore) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true); setError("");
    try {
      const response = await fetch(`${baseUrl}&query=${encodeURIComponent(query.trim())}&offset=${files.length}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Could not load more conversation files (${response.status}).`);
      const page = await response.json() as ConversationFilesPage;
      if (!controller.signal.aborted) { setFiles((current) => [...current, ...page.items]); setHasMore(page.hasMore); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load more conversation files.");
    } finally { if (!controller.signal.aborted) setLoadingMore(false); }
  }

  async function openConversation(conversationId: string, messageId: string) {
    setOpeningId(messageId);
    setError("");
    try {
      await onOpenConversation(conversationId, messageId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open the conversation.");
    } finally {
      setOpeningId(null);
    }
  }

  const heading = scope === "mine" ? "Files I shared in conversations" : "Files others shared in conversations";
  return <section className="documents-conversation-files" aria-label={heading}>
    <div className="documents-conversation-toolbar">
      <div><strong>{heading}</strong><small>{files.length}{hasMore ? "+" : ""} {files.length === 1 && !hasMore ? "file" : "files"}</small></div>
      <label className="documents-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="Search conversation files" aria-label="Search conversation files" /></label>
    </div>
    {error && <div className="documents-message error" role="alert">{error}</div>}
    <div className="documents-list documents-conversation-list">
      <div className="documents-conversation-heading"><span>Name</span><span>Conversation</span><span>Shared</span><span>Actions</span></div>
      {loading && <p className="documents-state"><LoaderCircle className="spin" size={18} /> Loading conversation files…</p>}
      {!loading && !error && files.length === 0 && <div className="documents-empty"><FileText size={33} /><strong>{query ? "No matching files" : "No conversation files yet"}</strong><p>{query ? "Try another file name." : scope === "mine" ? "Files you share in conversations will appear here." : "Files other members share in conversations will appear here."}</p></div>}
      {!loading && files.map((file) => {
        const url = `${apiUrl}/api/attachments/${file.id}?username=${encodeURIComponent(currentUsername)}&download=true`;
        return <div className="documents-conversation-row" key={file.id}>
          <div className="documents-conversation-name"><span className="documents-item-icon file">{file.contentType.startsWith("image/") ? <FileImage size={20} /> : <FileText size={20} />}</span><span><a href={url} download={file.fileName} title={file.fileName}>{file.fileName}</a><small>{scope === "mine" ? "You" : file.senderDisplayName} · {formatSize(file.fileSize)}</small></span></div>
          <button type="button" className="documents-conversation-link" title={`Go to message in ${file.conversationTitle}`} onClick={() => void openConversation(file.conversationId, file.messageId)} disabled={openingId !== null}>{file.conversationTitle}</button>
          <time className="documents-conversation-meta" dateTime={file.sharedAt}>{formatDate(file.sharedAt)}</time>
          <div className="documents-conversation-row-actions">
            <a href={url} download={file.fileName} aria-label={`Download ${file.fileName}`} title="Download file"><Download size={16} /></a>
          </div>
        </div>;
      })}
    </div>
    {hasMore && !loading && <button className="documents-conversation-more" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <><LoaderCircle className="spin" size={15} /> Loading…</> : "Load more files"}</button>}
  </section>;
}
