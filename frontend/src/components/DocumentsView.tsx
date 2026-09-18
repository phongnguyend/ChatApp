import { ArrowLeft, CheckSquare2, ChevronRight, Copy, Download, FileImage, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Globe2, History, Info, Link2, LoaderCircle, Pencil, QrCode, RotateCcw, Search, Send, Share2, Trash2, Upload, Users, X } from "lucide-react";
import { type ChangeEvent, type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ConversationFilesPanel } from "./ConversationFilesPanel";
import { discardDocumentUpload, uploadDocument, type UploadProgress } from "./documentUploads";
import "./DocumentsView.css";

type Permission = "owner" | "editor" | "viewer";
type FolderItem = { id: string; parentFolderId: string | null; name: string; createdAt: string; updatedAt: string; deletedAt: string | null; permission: Permission; ownerUsername: string | null };
type FileItem = { id: string; folderId: string | null; name: string; contentType: string; sizeBytes: number; createdAt: string; updatedAt: string; deletedAt: string | null; permission: Permission; ownerUsername: string | null };
type SharingSummary = { peopleCount: number; hasPublicLink: boolean; publicLinkExpired: boolean };
type Listing = { currentFolder: FolderItem | null; breadcrumbs: FolderItem[]; folders: FolderItem[]; files: FileItem[]; sharingSummaries?: Record<string, SharingSummary> | null; locations?: Record<string, string> | null };
type Selection = { kind: "folder" | "file"; id: string };
type DocumentMode = "mine" | "shared" | "outgoing" | "conversationMine" | "conversationOthers" | "trash";
const documentDragType = "application/x-chatapp-documents";
type ShareItem = { id: string; username: string; displayName: string; permission: "viewer" | "editor" };
type PublicLink = { token: string; createdAt: string; expiresAt: string | null };
type DocumentVersion = { id: string | null; number: number; contentType: string; sizeBytes: number; createdAt: string; isCurrent: boolean };
type Person = { id: string; username: string; displayName: string };
type NameDialog = { kind: "create" | "folder" | "file"; id?: string; name: string };
type DeleteDialog = { kind: "folder" | "file"; id: string; name: string };
type UploadConflict = { file: File; remaining: File[]; folderId: string | null };
type DocumentProperties = { kind: "folder" | "file"; id: string; name: string; location: string; ownerUsername: string; ownerDisplayName: string; permission: Permission; createdAt: string; updatedAt: string; deletedAt: string | null; contentType: string | null; sizeBytes: number; folderCount: number | null; fileCount: number | null };

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: string } | null;
  return body?.message || `Request failed (${response.status}).`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function expiryDateValue(expiresAt: string | null) {
  return expiresAt ? localDateValue(new Date(new Date(expiresAt).getTime() - 1)) : "";
}

function endOfLocalDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day + 1).toISOString();
}

function canPreview(file: FileItem) {
  return file.contentType === "application/pdf" || ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.contentType);
}

function sharingSummary(summary?: SharingSummary) {
  if (!summary) return "";
  const parts = [];
  if (summary.peopleCount) parts.push(`Shared with ${summary.peopleCount} ${summary.peopleCount === 1 ? "person" : "people"}`);
  if (summary.hasPublicLink) parts.push(summary.publicLinkExpired ? "Public link expired" : "Anyone with the link");
  return parts.join(" · ");
}

export function DocumentsView({ apiUrl, currentUsername, onBack, onOpenConversation, hidden }: {
  apiUrl: string;
  currentUsername: string;
  onBack: () => void;
  onOpenConversation: (conversationId: string, messageId: string) => Promise<void>;
  hidden: boolean;
}) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [mode, setMode] = useState<DocumentMode>("mine");
  const isConversationMode = mode === "conversationMine" || mode === "conversationOthers";
  const [listing, setListing] = useState<Listing | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selection[]>([]);
  const [destinationAction, setDestinationAction] = useState<"move" | "copy" | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [destinationListing, setDestinationListing] = useState<Listing | null>(null);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [bulkTrashOpen, setBulkTrashOpen] = useState(false);
  const [sort, setSort] = useState<"name" | "updated">("name");
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialog | null>(null);
  const [purgeDialog, setPurgeDialog] = useState<DeleteDialog | null>(null);
  const [conflict, setConflict] = useState<UploadConflict | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [versionFile, setVersionFile] = useState<FileItem | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<DocumentVersion | null>(null);
  const [propertiesTarget, setPropertiesTarget] = useState<{ kind: "folder" | "file"; id: string } | null>(null);
  const [properties, setProperties] = useState<DocumentProperties | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesError, setPropertiesError] = useState("");
  const [shareDialog, setShareDialog] = useState<{ kind: "folder" | "file"; id: string; name: string } | null>(null);
  const [shareTab, setShareTab] = useState<"internal" | "public">("internal");
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [publicLink, setPublicLink] = useState<PublicLink | null>(null);
  const [publicLinkLoading, setPublicLinkLoading] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  const [shareNow, setShareNow] = useState(Date.now());
  const [peopleQuery, setPeopleQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [recipient, setRecipient] = useState<Person | null>(null);
  const [sharePermission, setSharePermission] = useState<"viewer" | "editor">("viewer");
  const [dragging, setDragging] = useState(false);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragItems = useRef<Selection[] | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const baseUrl = `${apiUrl}/api/documents`;
  const usernameQuery = `username=${encodeURIComponent(currentUsername)}`;

  function openShareDialog(kind: "folder" | "file", id: string, name: string) {
    setShareTab("internal");
    setError("");
    setShareDialog({ kind, id, name });
  }

  useEffect(() => {
    if (hidden || isConversationMode) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const term = query.trim();
    const endpoint = term ? `${baseUrl}/search?${usernameQuery}&query=${encodeURIComponent(term)}`
      : mode === "trash" ? `${baseUrl}/trash?${usernameQuery}`
      : mode === "shared" && !folderId ? `${baseUrl}/shared?${usernameQuery}`
      : mode === "outgoing" && !folderId ? `${baseUrl}/shared-by-me?${usernameQuery}`
      : `${baseUrl}?${usernameQuery}${folderId ? `&folderId=${folderId}` : ""}`;
    const timer = window.setTimeout(() => fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response));
        return response.json() as Promise<Listing>;
      })
      .then(setListing)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load documents.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); }), term ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [baseUrl, usernameQuery, folderId, mode, version, hidden, query, isConversationMode]);

  useEffect(() => { setSelected([]); }, [folderId, mode, query]);

  useEffect(() => {
    if (!destinationAction) return;
    const controller = new AbortController();
    setDestinationListing(null);
    setDestinationLoading(true);
    fetch(`${baseUrl}?${usernameQuery}${destinationId ? `&folderId=${destinationId}` : ""}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(await errorMessage(response)); return response.json() as Promise<Listing>; })
      .then((value) => { if (!controller.signal.aborted) setDestinationListing(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load destination folders."); })
      .finally(() => { if (!controller.signal.aborted) setDestinationLoading(false); });
    return () => controller.abort();
  }, [baseUrl, usernameQuery, destinationAction, destinationId]);

  useEffect(() => {
    if (!shareDialog) return;
    const controller = new AbortController();
    setPublicLink(null);
    setPublicLinkLoading(true);
    setExpiryDate("");
    setShareNow(Date.now());
    fetch(`${baseUrl}/shares?${usernameQuery}&kind=${shareDialog.kind}&id=${shareDialog.id}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(await errorMessage(response)); return response.json() as Promise<ShareItem[]>; })
      .then(setShares)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load sharing settings."); });
    fetch(`${baseUrl}/public-links?${usernameQuery}&kind=${shareDialog.kind}&id=${shareDialog.id}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(await errorMessage(response)); return response.status === 204 ? null : response.json() as Promise<PublicLink>; })
      .then((value) => { if (!controller.signal.aborted) { setPublicLink(value); setExpiryDate(expiryDateValue(value?.expiresAt ?? null)); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load public link."); })
      .finally(() => { if (!controller.signal.aborted) setPublicLinkLoading(false); });
    return () => controller.abort();
  }, [baseUrl, usernameQuery, shareDialog]);

  useEffect(() => {
    if (!shareDialog) return;
    const timer = window.setInterval(() => setShareNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [shareDialog]);

  useEffect(() => {
    if (!propertiesTarget) return;
    const controller = new AbortController();
    setProperties(null);
    setPropertiesError("");
    setPropertiesLoading(true);
    fetch(`${baseUrl}/${propertiesTarget.kind === "folder" ? "folders" : "files"}/${propertiesTarget.id}/properties?${usernameQuery}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response));
        return response.json() as Promise<DocumentProperties>;
      })
      .then((value) => { if (!controller.signal.aborted) setProperties(value); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setPropertiesError(reason instanceof Error ? reason.message : "Could not load properties.");
      })
      .finally(() => { if (!controller.signal.aborted) setPropertiesLoading(false); });
    return () => controller.abort();
  }, [baseUrl, usernameQuery, propertiesTarget]);

  useEffect(() => {
    if (!versionFile) return;
    const controller = new AbortController();
    setVersionsLoading(true);
    fetch(`${baseUrl}/files/${versionFile.id}/versions?${usernameQuery}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(await errorMessage(response)); return response.json() as Promise<DocumentVersion[]>; })
      .then((items) => { if (!controller.signal.aborted) setVersions(items); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load version history."); })
      .finally(() => { if (!controller.signal.aborted) setVersionsLoading(false); });
    return () => controller.abort();
  }, [baseUrl, usernameQuery, versionFile]);

  useEffect(() => {
    if (!shareDialog || !peopleQuery.trim() || recipient) { setPeople([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`${apiUrl}/api/users?currentUsername=${encodeURIComponent(currentUsername)}&query=${encodeURIComponent(peopleQuery.trim())}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<Person[]> : [])
        .then(setPeople).catch(() => { if (!controller.signal.aborted) setPeople([]); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiUrl, currentUsername, peopleQuery, recipient, shareDialog]);

  useEffect(() => { if (nameDialog) nameInput.current?.focus(); }, [nameDialog]);

  const visible = useMemo(() => {
    const filter = query.trim().toLocaleLowerCase();
    const folders = (listing?.folders ?? []).filter((item) => item.name.toLocaleLowerCase().includes(filter));
    const files = (listing?.files ?? []).filter((item) => item.name.toLocaleLowerCase().includes(filter));
    const compare = (a: FolderItem | FileItem, b: FolderItem | FileItem) => sort === "name"
      ? a.name.localeCompare(b.name)
      : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    return { folders: folders.sort(compare), files: files.sort(compare) };
  }, [listing, query, sort]);

  function refresh() { setVersion((current) => current + 1); window.dispatchEvent(new Event("documents-storage-changed")); }
  function navigate(id: string | null) { setFolderId(id); setListing(null); setQuery(""); setSelected([]); setNotice(""); setPreview(null); }
  function openProperties(kind: "folder" | "file", id: string) { setPreview(null); setPropertiesTarget({ kind, id }); }
  function changeMode(next: DocumentMode) { setMode(next); navigate(null); setError(""); }
  const canEditCurrent = !query.trim() && mode !== "trash" && (folderId ? listing?.currentFolder?.permission !== "viewer" : mode === "mine");
  const isTrashView = mode === "trash" && !query.trim();
  const publicLinkExpired = Boolean(publicLink?.expiresAt && new Date(publicLink.expiresAt).getTime() <= shareNow);
  const publicQrUrl = publicLink ? `${baseUrl}/public/${encodeURIComponent(publicLink.token)}/qr-code?origin=${encodeURIComponent(window.location.origin)}` : "";

  function toggleSelected(item: Selection) {
    setSelected((current) => current.some((entry) => entry.kind === item.kind && entry.id === item.id)
      ? current.filter((entry) => entry.kind !== item.kind || entry.id !== item.id)
      : current.length < 100 ? [...current, item] : current);
  }

  function selectVisible() {
    const eligible: Selection[] = [
      ...visible.folders.filter((item) => item.permission === "owner" && !isTrashView).map((item) => ({ kind: "folder" as const, id: item.id })),
      ...visible.files.filter((item) => item.permission === "owner" && !isTrashView).map((item) => ({ kind: "file" as const, id: item.id })),
    ];
    setSelected(eligible.slice(0, 100));
    if (eligible.length > 100) setNotice("Selected the first 100 items.");
  }

  async function runBulk(action: "move" | "copy" | "trash", targetFolderId: string | null = null, items = selected) {
    if (!items.length || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${baseUrl}/bulk?${usernameQuery}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, items, destinationFolderId: action === "trash" ? null : targetFolderId }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const { count } = await response.json() as { count: number };
      setSelected([]);
      setDestinationAction(null);
      setBulkTrashOpen(false);
      setNotice(`${count} ${count === 1 ? "item" : "items"} ${action === "move" ? "moved" : action === "copy" ? "copied" : "moved to Trash"}.`);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not ${action} selected items.`); }
    finally { setBusy(false); }
  }

  async function cloneFile(file: FileItem) {
    if (file.permission !== "owner" || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${baseUrl}/bulk?${usernameQuery}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "copy", items: [{ kind: "file", id: file.id }], destinationFolderId: file.folderId }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setPreview((current) => current?.id === file.id ? null : current);
      setNotice(`Cloned “${file.name}” in the same folder.`);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not clone this file."); }
    finally { setBusy(false); }
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameDialog || !nameDialog.name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const url = nameDialog.kind === "create" ? `${baseUrl}/folders?${usernameQuery}`
        : `${baseUrl}/${nameDialog.kind === "folder" ? "folders" : "files"}/${nameDialog.id}?${usernameQuery}`;
      const response = await fetch(url, {
        method: nameDialog.kind === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nameDialog.kind === "create"
          ? { name: nameDialog.name.trim(), parentFolderId: folderId }
          : { name: nameDialog.name.trim() }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setNameDialog(null);
      setNotice(nameDialog.kind === "create" ? "Folder created." : "Name updated.");
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the name.");
    } finally { setBusy(false); }
  }

  async function deleteItem() {
    if (!deleteDialog || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${baseUrl}/${deleteDialog.kind === "folder" ? "folders" : "files"}/${deleteDialog.id}?${usernameQuery}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setDeleteDialog(null);
      setNotice("Moved to Trash.");
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete the item.");
    } finally { setBusy(false); }
  }

  async function restoreItem(kind: "folder" | "file", id: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${baseUrl}/${kind === "folder" ? "folders" : "files"}/${id}/restore?${usernameQuery}`, { method: "PATCH" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setNotice("Restored successfully."); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not restore the item."); }
    finally { setBusy(false); }
  }

  async function purgeItem() {
    if (!purgeDialog || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${baseUrl}/trash/${purgeDialog.kind === "folder" ? "folders" : "files"}/${purgeDialog.id}?${usernameQuery}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setPurgeDialog(null); setNotice("Permanently deleted."); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not permanently delete the item."); }
    finally { setBusy(false); }
  }

  async function saveShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shareDialog || !recipient || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${baseUrl}/shares?${usernameQuery}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: shareDialog.kind, id: shareDialog.id, recipientUsername: recipient.username, permission: sharePermission }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const saved = await response.json() as ShareItem;
      setShares((current) => [...current.filter((item) => item.username !== saved.username), saved]);
      setRecipient(null); setPeopleQuery(""); setNotice("Sharing updated."); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not share this item."); }
    finally { setBusy(false); }
  }

  async function removeShare(id: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${baseUrl}/shares/${id}?${usernameQuery}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setShares((current) => current.filter((item) => item.id !== id));
      setNotice("Access removed."); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove access."); }
    finally { setBusy(false); }
  }

  async function setPublicAccess(enabled: boolean) {
    if (!shareDialog || busy) return;
    const expiresAt = enabled && expiryDate ? endOfLocalDay(expiryDate) : null;
    if (enabled && expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setError("Choose today or a future expiry date.");
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch(`${baseUrl}/public-links?${usernameQuery}${enabled ? "" : `&kind=${shareDialog.kind}&id=${shareDialog.id}`}`, {
        method: enabled ? "PUT" : "DELETE",
        ...(enabled ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: shareDialog.kind, id: shareDialog.id, expiresAt }) } : {}),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setPublicLink(enabled ? await response.json() as PublicLink : null);
      setShareNow(Date.now());
      if (!enabled) setExpiryDate("");
      setNotice(enabled ? publicLink ? "Public link expiry updated." : "Public link enabled." : "Public link removed.");
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change public access."); }
    finally { setBusy(false); }
  }

  async function copyPublicLink() {
    if (!publicLink || publicLinkExpired) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?publicDocument=${encodeURIComponent(publicLink.token)}`);
      setNotice("Public link copied.");
    } catch { setError("Could not copy the link. Select and copy it below."); }
  }

  async function downloadPublicQr() {
    if (!publicLink || publicLinkExpired) return;
    setError("");
    try {
      const response = await fetch(publicQrUrl);
      if (!response.ok) throw new Error(await errorMessage(response));
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "public-document-qr.png";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not download the QR code."); }
  }

  async function postFile(file: File, targetFolderId: string | null, choice: "ask" | "replace" | "keepBoth") {
    return uploadDocument(baseUrl, usernameQuery, currentUsername, file, targetFolderId,
      choice, setUploadProgress);
  }

  async function processUploads(files: File[], targetFolderId: string | null) {
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      for (let index = 0; index < files.length; index += 1) {
        const response = await postFile(files[index], targetFolderId, "ask");
        if (response.status === 409) {
          const body = await response.json() as { code?: string; message?: string };
          if (body.code === "name_conflict") {
            setConflict({ file: files[index], remaining: files.slice(index + 1), folderId: targetFolderId });
            refresh();
            return;
          }
          throw new Error(body.message || "A file with this name already exists.");
        }
        if (!response.ok) throw new Error(await errorMessage(response));
      }
      setNotice(files.length === 1 ? "File uploaded." : `${files.length} files uploaded.`);
      refresh();
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : "Could not upload files."} Select the same file again to resume.`);
      refresh();
    } finally { setBusy(false); setUploadProgress(null); }
  }

  async function resolveConflict(choice: "replace" | "keepBoth" | "skip") {
    if (!conflict || busy) return;
    const pending = conflict;
    setBusy(true);
    setError("");
    try {
      if (choice === "skip") await discardDocumentUpload(baseUrl, usernameQuery,
        currentUsername, pending.file, pending.folderId);
      else {
        const response = await postFile(pending.file, pending.folderId, choice);
        if (!response.ok) throw new Error(await errorMessage(response));
      }
      setConflict(null);
      refresh();
      setBusy(false); setUploadProgress(null);
      if (pending.remaining.length) await processUploads(pending.remaining, pending.folderId);
      else setNotice(choice === "skip" ? "Upload skipped." : choice === "replace" ? "File replaced." : "Both files kept.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not finish the upload.");
      setBusy(false); setUploadProgress(null);
    }
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (canEditCurrent) void processUploads(files, folderId);
  }
  function dropFiles(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.types.includes(documentDragType) || dragItems.current) {
      clearDocumentDrag();
      return;
    }
    if (canEditCurrent) void processUploads(Array.from(event.dataTransfer.files), folderId);
  }

  function clearDocumentDrag() {
    dragItems.current = null;
    setDraggedItem(null);
    setDropTarget(null);
  }

  function startDocumentDrag(event: DragEvent<HTMLDivElement>, item: Selection) {
    if (busy || (event.target as HTMLElement).closest(".documents-row-actions, input")) {
      event.preventDefault();
      return;
    }
    const items = selected.some((entry) => entry.kind === item.kind && entry.id === item.id)
      ? selected : [item];
    dragItems.current = items;
    setDraggedItem(`${item.kind}:${item.id}`);
    setDragging(false);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(documentDragType, "move");
  }

  function canDropDocument(event: DragEvent<HTMLElement>, targetId: string | null) {
    const items = dragItems.current;
    if (!items?.length || !event.dataTransfer.types.includes(documentDragType) || busy) return false;
    return !items.some((item) => item.kind === "folder" && item.id === targetId);
  }

  function hoverDocumentFolder(event: DragEvent<HTMLElement>, targetId: string | null) {
    if (!canDropDocument(event, targetId)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(targetId ?? "root");
  }

  function dropDocumentInto(event: DragEvent<HTMLElement>, targetId: string | null) {
    if (!canDropDocument(event, targetId)) return;
    event.preventDefault();
    event.stopPropagation();
    const items = dragItems.current!;
    clearDocumentDrag();
    void runBulk("move", targetId, items);
  }

  function contentUrl(file: FileItem, download: boolean) {
    return `${baseUrl}/files/${file.id}/content?${usernameQuery}&download=${download}&v=${encodeURIComponent(file.updatedAt)}`;
  }
  async function downloadFile(file: FileItem) {
    setError("");
    try {
      const response = await fetch(contentUrl(file, true));
      if (!response.ok) throw new Error(await errorMessage(response));
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not download the file.");
    }
  }

  async function replaceContent(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected || !preview || preview.permission === "viewer" || busy) return;
    setBusy(true); setError("");
    try {
      const response = await uploadDocument(baseUrl, usernameQuery, currentUsername, selected,
        preview.folderId, "replace", setUploadProgress, preview.id);
      if (!response.ok) throw new Error(await errorMessage(response));
      setPreview(null); setNotice("File content replaced."); refresh();
    } catch (reason) { setError(`${reason instanceof Error ? reason.message : "Could not replace file content."} Select the same file again to resume.`); }
    finally { setBusy(false); setUploadProgress(null); }
  }

  async function downloadVersion(item: DocumentVersion) {
    if (!versionFile) return;
    if (item.isCurrent) { await downloadFile(versionFile); return; }
    setError("");
    try {
      const response = await fetch(`${baseUrl}/files/${versionFile.id}/versions/${item.id}/content?${usernameQuery}&download=true`);
      if (!response.ok) throw new Error(await errorMessage(response));
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = versionFile.name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not download this version."); }
  }

  async function restoreVersion(item: DocumentVersion) {
    if (!versionFile || !item.id || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${baseUrl}/files/${versionFile.id}/versions/${item.id}/restore?${usernameQuery}`, { method: "POST" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const saved = await response.json() as FileItem;
      setVersionFile({ ...saved, permission: versionFile.permission, ownerUsername: versionFile.ownerUsername });
      setVersionToDelete(null);
      setPreview(null);
      setNotice(`Version ${item.number} restored as a new current version.`);
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not restore this version."); }
    finally { setBusy(false); }
  }

  async function deleteVersion() {
    if (!versionFile || !versionToDelete?.id || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${baseUrl}/files/${versionFile.id}/versions/${versionToDelete.id}?${usernameQuery}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setVersions((current) => current.filter((item) => item.id !== versionToDelete.id));
      setVersionToDelete(null);
      setNotice("Version deleted and storage freed.");
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete this version."); }
    finally { setBusy(false); }
  }

  return (
    <section className="documents-view" aria-label="My Documents" hidden={hidden}
      onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); if (canEditCurrent) setDragging(true); } }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={dropFiles}>
      <header className="documents-header">
        <div><p className="eyebrow">Your files</p><h1>My Documents</h1><p>Keep files organized and share them with people.</p></div>
        <button type="button" className="documents-back" onClick={onBack}><ArrowLeft size={16} /> Back to chat</button>
      </header>
      <div className="documents-tabs" role="tablist" aria-label="Document sections">
        <button type="button" role="tab" aria-selected={mode === "mine"} onClick={() => changeMode("mine")}><FolderOpen size={15} aria-hidden="true" /> My Documents</button>
        <button type="button" role="tab" aria-selected={mode === "shared"} onClick={() => changeMode("shared")}><Share2 size={15} aria-hidden="true" /> Shared with me</button>
        <button type="button" role="tab" aria-selected={mode === "outgoing"} onClick={() => changeMode("outgoing")}><Send size={15} aria-hidden="true" /> Shared by me</button>
        <button type="button" role="tab" aria-selected={mode === "conversationMine"} onClick={() => changeMode("conversationMine")}><Send size={15} aria-hidden="true" /> Files I shared in chats</button>
        <button type="button" role="tab" aria-selected={mode === "conversationOthers"} onClick={() => changeMode("conversationOthers")}><Download size={15} aria-hidden="true" /> Files others shared in chats</button>
        <button type="button" role="tab" aria-selected={mode === "trash"} onClick={() => changeMode("trash")}><Trash2 size={15} aria-hidden="true" /> Trash</button>
      </div>
      {isConversationMode ? <ConversationFilesPanel key={mode} apiUrl={apiUrl} currentUsername={currentUsername} scope={mode === "conversationMine" ? "mine" : "others"} hidden={hidden} onOpenConversation={onOpenConversation} /> : <>
      <div className="documents-toolbar">
        <div className="documents-actions">
          {canEditCurrent && <><button type="button" onClick={() => setNameDialog({ kind: "create", name: "" })} disabled={busy}><FolderPlus size={17} /> New folder</button>
          <button type="button" className="documents-upload-button" onClick={() => uploadInput.current?.click()} disabled={busy}><Upload size={17} /> Upload files</button></>}
          <input ref={uploadInput} type="file" multiple hidden onChange={chooseFiles} aria-label="Choose files to upload" />
          {!isTrashView && (visible.folders.some((item) => item.permission === "owner") || visible.files.some((item) => item.permission === "owner")) && <button type="button" onClick={selected.length ? () => setSelected([]) : selectVisible} disabled={busy}><CheckSquare2 size={16} /> {selected.length ? "Clear selection" : "Select all"}</button>}
        </div>
        <div className="documents-tools">
          <label className="documents-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all documents" aria-label="Search all documents" /></label>
          <select aria-label="Sort documents" value={sort} onChange={(event) => setSort(event.target.value as "name" | "updated")}><option value="name">Name</option><option value="updated">Last modified</option></select>
        </div>
      </div>
      {selected.length > 0 && <div className="documents-selection-bar"><strong>{selected.length} selected</strong><button type="button" onClick={() => { setDestinationId(null); setDestinationAction("move"); setError(""); }} disabled={busy}><FolderInput size={15} /> Move</button><button type="button" onClick={() => { setDestinationId(null); setDestinationAction("copy"); setError(""); }} disabled={busy}><Copy size={15} /> Copy</button><button type="button" onClick={() => { setBulkTrashOpen(true); setError(""); }} disabled={busy}><Trash2 size={15} /> Move to Trash</button></div>}
      <nav className="documents-breadcrumbs" aria-label="Folder path">
        {query.trim() ? <span>Search results across My Documents and Shared with me</span> : <><button type="button" className={dropTarget === "root" ? "documents-drop-target" : undefined} onClick={() => navigate(null)} onDragOver={mode === "mine" ? (event) => hoverDocumentFolder(event, null) : undefined} onDragLeave={() => setDropTarget(null)} onDrop={mode === "mine" ? (event) => dropDocumentInto(event, null) : undefined} aria-current={folderId === null ? "page" : undefined}>{mode === "mine" ? "My Documents" : mode === "shared" ? "Shared with me" : mode === "outgoing" ? "Shared by me" : "Trash"}</button>
        {listing?.breadcrumbs.map((folder) => <span key={folder.id}><ChevronRight size={14} /><button type="button" className={dropTarget === folder.id ? "documents-drop-target" : undefined} onClick={() => navigate(folder.id)} onDragOver={folder.permission === "owner" ? (event) => hoverDocumentFolder(event, folder.id) : undefined} onDragLeave={() => setDropTarget(null)} onDrop={folder.permission === "owner" ? (event) => dropDocumentInto(event, folder.id) : undefined} aria-current={folder.id === folderId ? "page" : undefined}>{folder.name}</button></span>)}</>}
      </nav>
      {error && <div className="documents-message error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
      {uploadProgress && <div className="documents-upload-progress" role="status"><span>Uploading {uploadProgress.name}: {Math.round(uploadProgress.uploadedBytes / uploadProgress.totalBytes * 100)}%</span><progress value={uploadProgress.uploadedBytes} max={uploadProgress.totalBytes} /></div>}
      {notice && <div className="documents-message" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss message"><X size={14} /></button></div>}
      <div className={`documents-list ${dragging ? "dragging" : ""}`}>
        <div className="documents-list-heading"><span>Name</span><span>Modified</span><span>Size</span><span>Actions</span></div>
        {loading && <p className="documents-state"><LoaderCircle className="spin" size={18} /> Loading documents…</p>}
        {!loading && !error && visible.folders.length === 0 && visible.files.length === 0 && <div className="documents-empty"><Folder size={33} /><strong>{query ? "No matching items" : mode === "trash" ? "Trash is empty" : mode === "shared" && !folderId ? "Nothing shared with you yet" : mode === "outgoing" && !folderId ? "Nothing shared by you yet" : "This folder is empty"}</strong><p>{query ? "Try another search." : mode === "mine" ? "Create a folder or upload files to get started." : mode === "outgoing" && !folderId ? "Share a file or folder to see it here." : "Items will appear here when available."}</p></div>}
        {!loading && visible.folders.map((folder) => <div className={`documents-row ${dropTarget === folder.id ? "documents-drop-target" : ""} ${draggedItem === `folder:${folder.id}` ? "documents-drag-source" : ""}`} key={folder.id} draggable={!isTrashView && folder.permission === "owner" && !busy} onDragStart={(event) => startDocumentDrag(event, { kind: "folder", id: folder.id })} onDragEnd={clearDocumentDrag} onDragOver={folder.permission === "owner" && !isTrashView ? (event) => hoverDocumentFolder(event, folder.id) : undefined} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null); }} onDrop={folder.permission === "owner" && !isTrashView ? (event) => dropDocumentInto(event, folder.id) : undefined}>
          <div className="documents-row-leading">{!isTrashView && folder.permission === "owner" && <input type="checkbox" aria-label={`Select ${folder.name}`} checked={selected.some((item) => item.kind === "folder" && item.id === folder.id)} onChange={() => toggleSelected({ kind: "folder", id: folder.id })} />}<button className="documents-item-name" type="button" disabled={isTrashView} onClick={() => navigate(folder.id)}><span className="documents-item-icon folder"><Folder size={20} /></span><span title={folder.name}>{folder.name}{folder.ownerUsername && <small>Shared by @{folder.ownerUsername}</small>}{mode === "outgoing" && listing?.sharingSummaries?.[folder.id] && <small>{sharingSummary(listing.sharingSummaries[folder.id])}</small>}{query.trim() && listing?.locations?.[folder.id] && <small>{listing.locations[folder.id]}</small>}</span></button></div>
          <span className="documents-row-meta">{formatDate(folder.deletedAt ?? folder.updatedAt)}</span><span className="documents-row-meta">—</span>
          <div className="documents-row-actions"><button type="button" title="Folder properties" aria-label={`Properties for ${folder.name}`} onClick={() => openProperties("folder", folder.id)}><Info size={16} /></button>{isTrashView ? <><button type="button" title="Restore folder" aria-label={`Restore ${folder.name}`} onClick={() => void restoreItem("folder", folder.id)}><RotateCcw size={16} /></button><button type="button" title="Delete folder permanently" aria-label={`Delete ${folder.name} permanently`} onClick={() => setPurgeDialog({ kind: "folder", id: folder.id, name: folder.name })}><Trash2 size={16} /></button></> : <><button type="button" title="Open folder" aria-label={`Open ${folder.name}`} onClick={() => navigate(folder.id)}><ChevronRight size={16} /></button>{folder.permission !== "viewer" && <button type="button" title="Rename folder" aria-label={`Rename ${folder.name}`} onClick={() => setNameDialog({ kind: "folder", id: folder.id, name: folder.name })}><Pencil size={16} /></button>}{folder.permission === "owner" && <><button type="button" title="Share folder" aria-label={`Share ${folder.name}`} onClick={() => openShareDialog("folder", folder.id, folder.name)}><Share2 size={16} /></button><button type="button" title="Move folder to Trash" aria-label={`Move ${folder.name} to Trash`} onClick={() => setDeleteDialog({ kind: "folder", id: folder.id, name: folder.name })}><Trash2 size={16} /></button></>}</>}</div>
        </div>)}
        {!loading && visible.files.map((file) => <div className={`documents-row ${draggedItem === `file:${file.id}` ? "documents-drag-source" : ""}`} key={file.id} draggable={!isTrashView && file.permission === "owner" && !busy} onDragStart={(event) => startDocumentDrag(event, { kind: "file", id: file.id })} onDragEnd={clearDocumentDrag}>
          <div className="documents-row-leading">{!isTrashView && file.permission === "owner" && <input type="checkbox" aria-label={`Select ${file.name}`} checked={selected.some((item) => item.kind === "file" && item.id === file.id)} onChange={() => toggleSelected({ kind: "file", id: file.id })} />}<button className="documents-item-name" type="button" disabled={isTrashView} onClick={() => setPreview(file)}><span className="documents-item-icon file">{file.contentType.startsWith("image/") ? <FileImage size={20} /> : <FileText size={20} />}</span><span title={file.name}>{file.name}{file.ownerUsername && <small>Shared by @{file.ownerUsername}</small>}{mode === "outgoing" && listing?.sharingSummaries?.[file.id] && <small>{sharingSummary(listing.sharingSummaries[file.id])}</small>}{query.trim() && listing?.locations?.[file.id] && <small>{listing.locations[file.id]}</small>}</span></button></div>
          <span className="documents-row-meta">{formatDate(file.deletedAt ?? file.updatedAt)}</span><span className="documents-row-meta">{formatSize(file.sizeBytes)}</span>
          <div className="documents-row-actions"><button type="button" title="File properties" aria-label={`Properties for ${file.name}`} onClick={() => openProperties("file", file.id)}><Info size={16} /></button>{isTrashView ? <><button type="button" title="Restore file" aria-label={`Restore ${file.name}`} onClick={() => void restoreItem("file", file.id)}><RotateCcw size={16} /></button><button type="button" title="Delete file permanently" aria-label={`Delete ${file.name} permanently`} onClick={() => setPurgeDialog({ kind: "file", id: file.id, name: file.name })}><Trash2 size={16} /></button></> : <><button type="button" title="Version history" aria-label={`Version history for ${file.name}`} onClick={() => { setVersionFile(file); setVersions([]); setVersionToDelete(null); }}><History size={16} /></button><button type="button" title="Download file" aria-label={`Download ${file.name}`} onClick={() => void downloadFile(file)}><Download size={16} /></button>{file.permission !== "viewer" && <button type="button" title="Rename file" aria-label={`Rename ${file.name}`} onClick={() => setNameDialog({ kind: "file", id: file.id, name: file.name })}><Pencil size={16} /></button>}{file.permission === "owner" && <><button type="button" title="Clone file in this folder" aria-label={`Clone ${file.name} in this folder`} disabled={busy} onClick={() => void cloneFile(file)}><Copy size={16} /></button><button type="button" title="Share file" aria-label={`Share ${file.name}`} onClick={() => openShareDialog("file", file.id, file.name)}><Share2 size={16} /></button><button type="button" title="Move file to Trash" aria-label={`Move ${file.name} to Trash`} onClick={() => setDeleteDialog({ kind: "file", id: file.id, name: file.name })}><Trash2 size={16} /></button></>}</>}</div>
        </div>)}
      </div>
      {busy && <p className="documents-busy" role="status"><LoaderCircle className="spin" size={16} /> Working…</p>}
      {dragging && <div className="documents-drop-hint">Drop files to upload to {listing?.currentFolder?.name ?? "My Documents"}</div>}
      </>}

      {destinationAction && <div className="documents-modal-backdrop"><div className="documents-modal documents-destination" role="dialog" aria-modal="true" aria-labelledby="documents-destination-title">
        <div className="documents-modal-heading"><h2 id="documents-destination-title">{destinationAction === "move" ? "Move" : "Copy"} {selected.length} {selected.length === 1 ? "item" : "items"}</h2><button type="button" aria-label="Close destination picker" onClick={() => setDestinationAction(null)} disabled={busy}><X size={18} /></button></div>
        <p>Choose a folder in My Documents.</p>
        <nav className="documents-destination-path" aria-label="Destination path"><button type="button" onClick={() => setDestinationId(null)}>My Documents</button>{destinationListing?.breadcrumbs.map((folder) => <span key={folder.id}><ChevronRight size={13} /><button type="button" onClick={() => setDestinationId(folder.id)}>{folder.name}</button></span>)}</nav>
        <div className="documents-destination-list">{destinationLoading ? <p className="documents-state"><LoaderCircle className="spin" size={16} /> Loading folders…</p> : destinationListing?.folders.length ? destinationListing.folders.map((folder) => <button type="button" key={folder.id} onClick={() => setDestinationId(folder.id)}><Folder size={17} /> {folder.name}<ChevronRight size={15} /></button>) : <p>No folders here.</p>}</div>
        {error && <p className="documents-modal-error" role="alert">{error}</p>}
        <div className="documents-modal-actions"><button type="button" onClick={() => setDestinationAction(null)} disabled={busy}>Cancel</button><button type="button" onClick={() => void runBulk(destinationAction, destinationId)} disabled={busy || destinationLoading || !destinationListing}>{destinationAction === "move" ? "Move here" : "Copy here"}</button></div>
      </div></div>}
      {bulkTrashOpen && <div className="documents-modal-backdrop"><div className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="documents-bulk-trash-title">
        <div className="documents-modal-heading"><h2 id="documents-bulk-trash-title">Move {selected.length} items to Trash?</h2><button type="button" aria-label="Close" onClick={() => setBulkTrashOpen(false)} disabled={busy}><X size={18} /></button></div>
        <p>Selected folders will move with everything inside. You can restore them later.</p>
        {error && <p className="documents-modal-error" role="alert">{error}</p>}
        <div className="documents-modal-actions"><button type="button" onClick={() => setBulkTrashOpen(false)} disabled={busy}>Cancel</button><button type="button" className="danger" onClick={() => void runBulk("trash")} disabled={busy}>Move to Trash</button></div>
      </div></div>}

      {nameDialog && <div className="documents-modal-backdrop"><form className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="documents-name-title" onSubmit={(event) => void saveName(event)}>
        <div className="documents-modal-heading"><h2 id="documents-name-title">{nameDialog.kind === "create" ? "New folder" : `Rename ${nameDialog.kind}`}</h2><button type="button" aria-label="Close" onClick={() => setNameDialog(null)} disabled={busy}><X size={18} /></button></div>
        <label htmlFor="documents-name-input">Name</label><input id="documents-name-input" ref={nameInput} value={nameDialog.name} maxLength={255} onChange={(event) => setNameDialog({ ...nameDialog, name: event.target.value })} required />
        {error && <p className="documents-modal-error" role="alert">{error}</p>}
        <div className="documents-modal-actions"><button type="button" onClick={() => setNameDialog(null)} disabled={busy}>Cancel</button><button type="submit" disabled={busy || !nameDialog.name.trim()}>{nameDialog.kind === "create" ? "Create folder" : "Save name"}</button></div>
      </form></div>}
      {deleteDialog && <div className="documents-modal-backdrop"><div className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="documents-delete-title">
        <div className="documents-modal-heading"><h2 id="documents-delete-title">Move to Trash?</h2><button type="button" aria-label="Close" onClick={() => setDeleteDialog(null)} disabled={busy}><X size={18} /></button></div>
        <p>“{deleteDialog.name}” will move to Trash{deleteDialog.kind === "folder" ? " with everything inside it" : ""}. You can restore it later.</p>
        {error && <p className="documents-modal-error" role="alert">{error}</p>}
        <div className="documents-modal-actions"><button type="button" onClick={() => setDeleteDialog(null)} disabled={busy}>Keep</button><button className="danger" type="button" onClick={() => void deleteItem()} disabled={busy}>Move to Trash</button></div>
      </div></div>}
      {purgeDialog && <div className="documents-modal-backdrop"><div className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="documents-purge-title">
        <div className="documents-modal-heading"><h2 id="documents-purge-title">Delete permanently?</h2><button type="button" aria-label="Close" onClick={() => setPurgeDialog(null)} disabled={busy}><X size={18} /></button></div>
        <p>“{purgeDialog.name}”{purgeDialog.kind === "folder" ? " and everything inside it" : ""} cannot be restored after this.</p>
        {error && <p className="documents-modal-error" role="alert">{error}</p>}
        <div className="documents-modal-actions"><button type="button" onClick={() => setPurgeDialog(null)} disabled={busy}>Cancel</button><button className="danger" type="button" onClick={() => void purgeItem()} disabled={busy}>Delete permanently</button></div>
      </div></div>}
      {shareDialog && <div className="documents-modal-backdrop"><div className="documents-modal documents-share-modal" role="dialog" aria-modal="true" aria-labelledby="documents-share-title">
        <div className="documents-modal-heading"><h2 id="documents-share-title">Share “{shareDialog.name}”</h2><button type="button" aria-label="Close sharing" onClick={() => { setShareDialog(null); setRecipient(null); setPeopleQuery(""); setError(""); }} disabled={busy}><X size={18} /></button></div>
        <div className="documents-share-tabs" role="tablist" aria-label="Share type" onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const next = shareTab === "internal" ? "public" : "internal";
          setShareTab(next);
          document.getElementById(`documents-${next}-share-tab`)?.focus();
        }}>
          <button id="documents-internal-share-tab" type="button" role="tab" aria-controls="documents-internal-share-panel" aria-selected={shareTab === "internal"} tabIndex={shareTab === "internal" ? 0 : -1} onClick={() => setShareTab("internal")}><Users size={15} aria-hidden="true" /> Internal share</button>
          <button id="documents-public-share-tab" type="button" role="tab" aria-controls="documents-public-share-panel" aria-selected={shareTab === "public"} tabIndex={shareTab === "public" ? 0 : -1} onClick={() => setShareTab("public")}><Globe2 size={15} aria-hidden="true" /> Public share</button>
        </div>
        {error && <p className="documents-modal-error" role="alert">{error}</p>}
        <div id="documents-internal-share-panel" role="tabpanel" aria-labelledby="documents-internal-share-tab" hidden={shareTab !== "internal"}>
        <form onSubmit={(event) => void saveShare(event)}>
          <label htmlFor="documents-person-search">Add a person</label>
          <input id="documents-person-search" autoComplete="off" value={peopleQuery} onChange={(event) => { setPeopleQuery(event.target.value); setRecipient(null); }} placeholder="Search name or username" />
          {people.length > 0 && <div className="documents-people-results">{people.map((person) => <button type="button" key={person.id} onClick={() => { setRecipient(person); setPeopleQuery(`${person.displayName} (@${person.username})`); setPeople([]); }}>{person.displayName} <small>@{person.username}</small></button>)}</div>}
          {recipient && <p className="documents-selected-person">Selected: {recipient.displayName} (@{recipient.username})</p>}
          <label htmlFor="documents-permission">Permission</label>
          <select id="documents-permission" value={sharePermission} onChange={(event) => setSharePermission(event.target.value as "viewer" | "editor")}><option value="viewer">Viewer — open and download</option><option value="editor">Editor — rename and add or replace files</option></select>
          <div className="documents-modal-actions"><button type="submit" disabled={!recipient || busy}>Share</button></div>
        </form>
        <div className="documents-share-list"><strong>People with access</strong>{shares.length === 0 ? <p>Only you have access.</p> : shares.map((share) => <div className="documents-share-person" key={share.id}><span>{share.displayName}<small>@{share.username} · {share.permission}</small></span><button type="button" onClick={() => void removeShare(share.id)} disabled={busy} aria-label={`Remove ${share.displayName}`}>Remove</button></div>)}</div>
        </div>
        <div id="documents-public-share-panel" className="documents-public-sharing" role="tabpanel" aria-labelledby="documents-public-share-tab" hidden={shareTab !== "public"}>
          <strong><Link2 size={15} /> Anyone with the link</strong>
          <p>People with this link can view and download {shareDialog.kind === "folder" ? "this folder and its contents" : "this file"} without signing in.</p>
          <label htmlFor="documents-public-expiry">Expiry date (optional)</label>
          <div className="documents-public-expiry"><input id="documents-public-expiry" type="date" min={localDateValue(new Date(shareNow))} value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} disabled={busy || publicLinkLoading} /><button type="button" onClick={() => setExpiryDate("")} disabled={busy || publicLinkLoading || !expiryDate}>No expiry</button></div>
          <p>Access ends after the selected day in your local time.</p>
          {publicLinkLoading ? <p>Loading link…</p> : publicLink ? <>
            {publicLinkExpired && <p className="documents-public-expired" role="status">This link expired. Choose a new date or no expiry, then save to reactivate it.</p>}
            <label htmlFor="documents-public-url">Public link</label>
            <input id="documents-public-url" readOnly onFocus={(event) => event.target.select()} value={`${window.location.origin}/?publicDocument=${encodeURIComponent(publicLink.token)}`} />
            {!publicLinkExpired && <div className="documents-public-qr"><img src={publicQrUrl} alt="QR code for the public document link" /><button type="button" onClick={() => void downloadPublicQr()}><QrCode size={14} /> Download QR code</button></div>}
            <div className="documents-public-actions"><button type="button" onClick={() => void copyPublicLink()} disabled={publicLinkExpired}><Copy size={14} /> Copy link</button><button type="button" onClick={() => void setPublicAccess(true)} disabled={busy || expiryDate === expiryDateValue(publicLink.expiresAt)}>Save expiry</button><button type="button" disabled={busy} onClick={() => void setPublicAccess(false)}>Remove link</button></div>
          </> : <div className="documents-public-actions"><button type="button" disabled={busy} onClick={() => void setPublicAccess(true)}><Link2 size={14} /> Create public link</button></div>}
        </div>
      </div></div>}
      {conflict && <div className="documents-modal-backdrop"><div className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="documents-conflict-title">
        <div className="documents-modal-heading"><h2 id="documents-conflict-title">File already exists</h2></div>
        <p>“{conflict.file.name}” is already in this folder. What would you like to do?</p>
        {error && <p className="documents-modal-error" role="alert">{error}</p>}
        <div className="documents-conflict-actions"><button type="button" disabled={busy} onClick={() => void resolveConflict("replace")}>Replace existing</button><button type="button" disabled={busy} onClick={() => void resolveConflict("keepBoth")}>Keep both</button><button type="button" disabled={busy} onClick={() => void resolveConflict("skip")}>Skip this file</button></div>
      </div></div>}
      {propertiesTarget && <div className="documents-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPropertiesTarget(null); }}><div className="documents-modal documents-properties" role="dialog" aria-modal="true" aria-labelledby="documents-properties-title">
        <div className="documents-modal-heading"><h2 id="documents-properties-title">Properties</h2><button type="button" aria-label="Close properties" onClick={() => setPropertiesTarget(null)}><X size={18} /></button></div>
        {propertiesLoading && <p className="documents-state"><LoaderCircle className="spin" size={16} /> Loading properties…</p>}
        {propertiesError && <p className="documents-modal-error" role="alert">{propertiesError}</p>}
        {properties && <>
          <div className="documents-properties-item"><span className={`documents-item-icon ${properties.kind}`}>{properties.kind === "folder" ? <Folder size={22} /> : <FileText size={22} />}</span><div><strong>{properties.name}</strong><small>{properties.kind === "folder" ? "Folder" : properties.contentType || "File"}</small></div></div>
          <dl className="documents-properties-list">
            <div><dt>Location</dt><dd>{properties.location}</dd></div>
            <div><dt>Owner</dt><dd>{properties.ownerDisplayName} (@{properties.ownerUsername})</dd></div>
            <div><dt>Your access</dt><dd>{properties.permission[0].toUpperCase() + properties.permission.slice(1)}</dd></div>
            <div><dt>Size</dt><dd>{formatSize(properties.sizeBytes)} ({properties.sizeBytes.toLocaleString()} bytes)</dd></div>
            {properties.kind === "folder" && <div><dt>Contains</dt><dd>{properties.fileCount ?? 0} files, {properties.folderCount ?? 0} folders</dd></div>}
            <div><dt>Created</dt><dd>{formatDateTime(properties.createdAt)}</dd></div>
            <div><dt>Modified</dt><dd>{formatDateTime(properties.updatedAt)}</dd></div>
            {properties.deletedAt && <div><dt>Moved to Trash</dt><dd>{formatDateTime(properties.deletedAt)}</dd></div>}
          </dl>
        </>}
      </div></div>}
      {versionFile && <div className="documents-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setVersionFile(null); }}><div className="documents-modal documents-versions" role="dialog" aria-modal="true" aria-labelledby="documents-versions-title">
        <div className="documents-modal-heading"><h2 id="documents-versions-title">Version history</h2><button type="button" aria-label="Close version history" onClick={() => setVersionFile(null)} disabled={busy}><X size={18} /></button></div>
        <p className="documents-versions-name">{versionFile.name}</p>
        <p className="documents-versions-note">Older versions use storage until deleted. Restoring creates a new current version and keeps the selected version in history.</p>
        {versionsLoading && <p className="documents-state"><LoaderCircle className="spin" size={16} /> Loading versions…</p>}
        {error && <p className="documents-modal-error" role="alert">{error}</p>}
        {!versionsLoading && <div className="documents-versions-list">{versions.map((item) => <div className="documents-version" key={item.id ?? "current"}>
          <div className="documents-version-info"><strong>Version {item.number} {item.isCurrent && <span>Current</span>}</strong><small>{formatDateTime(item.createdAt)} · {formatSize(item.sizeBytes)}</small></div>
          <div className="documents-version-actions"><button type="button" onClick={() => void downloadVersion(item)} disabled={busy} title={`Download version ${item.number}`}><Download size={15} /> Download</button>{!item.isCurrent && versionFile.permission !== "viewer" && <><button type="button" onClick={() => void restoreVersion(item)} disabled={busy} title={`Restore version ${item.number}`}><RotateCcw size={15} /> Restore</button><button type="button" className="danger" onClick={() => setVersionToDelete(item)} disabled={busy} title={`Delete version ${item.number}`}><Trash2 size={15} /> Delete</button></>}</div>
        </div>)}</div>}
        {versionToDelete && <div className="documents-version-confirm"><p>Delete version {versionToDelete.number} permanently? This frees {formatSize(versionToDelete.sizeBytes)} and cannot be undone.</p><div><button type="button" onClick={() => setVersionToDelete(null)} disabled={busy}>Cancel</button><button type="button" className="danger" onClick={() => void deleteVersion()} disabled={busy}>Delete version</button></div></div>}
      </div></div>}
      {preview && <div className="documents-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}><div className="documents-modal documents-preview" role="dialog" aria-modal="true" aria-labelledby="documents-preview-title">
        <div className="documents-modal-heading"><h2 id="documents-preview-title">{preview.name}</h2><button type="button" aria-label="Close preview" onClick={() => setPreview(null)}><X size={18} /></button></div>
        {canPreview(preview) ? preview.contentType.startsWith("image/") ? <img src={contentUrl(preview, false)} alt={preview.name} /> : <iframe src={contentUrl(preview, false)} title={preview.name} /> : <div className="documents-preview-fallback"><FileText size={40} /><p>Preview is not available for this file type.</p></div>}
        {error && <p className="documents-modal-error" role="alert">{error}</p>}
        <div className="documents-preview-footer"><span>{formatSize(preview.sizeBytes)} · Modified {formatDate(preview.updatedAt)}</span><div className="documents-preview-actions"><button type="button" onClick={() => openProperties("file", preview.id)}><Info size={16} /> Properties</button><button type="button" onClick={() => { setVersionFile(preview); setVersions([]); setVersionToDelete(null); setPreview(null); }}><History size={16} /> Version history</button>{preview.permission === "owner" && <button type="button" disabled={busy} onClick={() => void cloneFile(preview)}><Copy size={16} /> Clone</button>}{preview.permission !== "viewer" && <><input ref={replaceInput} type="file" hidden onChange={(event) => void replaceContent(event)} aria-label="Choose replacement file" /><button type="button" disabled={busy} onClick={() => replaceInput.current?.click()}><Upload size={16} /> Replace content</button></>}<button type="button" onClick={() => void downloadFile(preview)}><Download size={16} /> Download</button></div></div>
      </div></div>}
    </section>
  );
}
