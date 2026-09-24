import { ArrowLeft, ChevronRight, Download, FileImage, FileText, Folder, Link2, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import "./PublicDocumentsView.css";

type FolderItem = { id: string; name: string };
type FileItem = { id: string; name: string; contentType: string; sizeBytes: number; updatedAt: string };
type Listing = { kind: "folder" | "file"; name: string; currentFolder: FolderItem | null; breadcrumbs: FolderItem[]; folders: FolderItem[]; files: FileItem[] };

function previewable(file: FileItem) {
  return file.contentType === "application/pdf" || ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.contentType);
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PublicDocumentsView({ apiUrl, token }: { apiUrl: string; token: string }) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<FileItem | null>(null);
  const contentUrl = (file: FileItem, download: boolean) =>
    `${apiUrl}/api/documents/public/${encodeURIComponent(token)}/files/${file.id}/content?download=${download}`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`${apiUrl}/api/documents/public/${encodeURIComponent(token)}${folderId ? `?folderId=${folderId}` : ""}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404
          ? "This link is unavailable. It may have expired, been removed, or the item may be in Trash."
          : "Could not load the shared item.");
        return response.json() as Promise<Listing>;
      })
      .then((value) => { if (!controller.signal.aborted) setListing(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) { setListing(null); setError(reason instanceof Error ? reason.message : "Could not load the shared item."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiUrl, token, folderId]);

  return <main className="public-documents">
    <header className="public-documents-header"><a href="/"><ArrowLeft size={16} /> ChatApp</a><span><Link2 size={15} /> Public share</span></header>
    <section className="public-documents-card">
      {loading ? <div className="public-documents-state"><LoaderCircle size={22} className="spin" /> Loading shared item…</div>
        : error ? <div className="public-documents-state"><Link2 size={30} /><h1>Link unavailable</h1><p>{error}</p></div>
        : listing && <>
          <div className="public-documents-title"><span className="public-documents-icon">{listing.kind === "folder" ? <Folder size={25} /> : <FileText size={25} />}</span><div><small>SHARED {listing.kind.toUpperCase()}</small><h1>{listing.name}</h1><p>Anyone with this link can view and download.</p></div></div>
          {listing.kind === "folder" && <nav className="public-documents-breadcrumbs" aria-label="Folder path">{listing.breadcrumbs.map((folder, index) => <span key={folder.id}>{index > 0 && <ChevronRight size={14} />}<button type="button" aria-current={index === listing.breadcrumbs.length - 1 ? "page" : undefined} onClick={() => { setFolderId(index === 0 ? null : folder.id); setPreview(null); }}>{folder.name}</button></span>)}</nav>}
          {listing.folders.length === 0 && listing.files.length === 0 ? <div className="public-documents-empty">This folder is empty.</div> : <div className="public-documents-list">
            {listing.folders.map((folder) => <button className="public-documents-row" type="button" key={folder.id} onClick={() => { setFolderId(folder.id); setPreview(null); }}><Folder size={20} /><span>{folder.name}</span><ChevronRight size={17} /></button>)}
            {listing.files.map((file) => <div className="public-documents-row" key={file.id}><button type="button" className="public-documents-file" onClick={() => setPreview(file)}>{file.contentType.startsWith("image/") ? <FileImage size={20} /> : <FileText size={20} />}<span>{file.name}<small>{size(file.sizeBytes)}</small></span></button><a href={contentUrl(file, true)} download={file.name} aria-label={`Download ${file.name}`}><Download size={17} /></a></div>)}
          </div>}
        </>}
    </section>
    {preview && <div className="public-documents-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><div className="public-documents-preview" role="dialog" aria-modal="true" aria-label={preview.name}><div className="public-documents-preview-heading"><strong>{preview.name}</strong><button type="button" onClick={() => setPreview(null)} aria-label="Close preview">×</button></div>{previewable(preview) ? preview.contentType.startsWith("image/") ? <img src={contentUrl(preview, false)} alt={preview.name} /> : <iframe src={contentUrl(preview, false)} title={preview.name} /> : <p>Preview is unavailable for this file type.</p>}<a href={contentUrl(preview, true)} download={preview.name}><Download size={16} /> Download</a></div></div>}
  </main>;
}
