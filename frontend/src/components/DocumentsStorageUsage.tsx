import { authFetch as fetch } from "../services/auth";
import { useEffect, useState } from "react";
import "./DocumentsStorageUsage.css";

type StorageUsage = { usedBytes: number; limitBytes: number };

function formatStorage(bytes: number) {
  const unit = bytes >= 1024 ** 3 ? 1024 ** 3 : 1024 ** 2;
  return `${(bytes / unit).toFixed(bytes >= 1024 ** 3 ? 1 : 0)} ${unit === 1024 ** 3 ? "GB" : "MB"}`;
}

export function DocumentsStorageUsage({ apiUrl, username }: { apiUrl: string; username: string }) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(`${apiUrl}/api/documents/storage?username=${encodeURIComponent(username)}`);
        if (!response.ok) throw new Error("Storage unavailable");
        const next = await response.json() as StorageUsage;
        if (active) setUsage(next);
      } catch { if (active) setUsage(null); }
    }
    void refresh();
    window.addEventListener("documents-storage-changed", refresh);
    return () => { active = false; window.removeEventListener("documents-storage-changed", refresh); };
  }, [apiUrl, username]);

  if (!usage) return null;
  const percentage = Math.min(100, Math.round(usage.usedBytes / usage.limitBytes * 100));
  return <div className="documents-storage-usage">
    <div className="documents-storage-heading"><strong>Storage</strong><span>{percentage}%</span></div>
    <div className="documents-storage-track" role="progressbar" aria-label="Document storage used" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percentage}%` }} /></div>
    <small>{formatStorage(usage.usedBytes)} of {formatStorage(usage.limitBytes)} used</small>
  </div>;
}
