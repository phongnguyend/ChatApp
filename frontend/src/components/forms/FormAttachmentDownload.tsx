import { useState } from 'react';
import { Download } from 'lucide-react';
import { API_URL, authFetch } from '../../services/auth';

export function FormAttachmentDownload({ formId, attachment }: { formId: string; attachment: { id: string; fileName: string; size: number } }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setBusy(true);
    setError('');
    try {
      const response = await authFetch(`${API_URL}/api/forms/${formId}/attachments/${attachment.id}`);
      if (!response.ok) {
        throw new Error('Unable to download attachment. Please try again.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Download failed.');
    } finally {
      setBusy(false);
    }
  }
  return <div><button type="button" disabled={busy} onClick={() => { void download(); }}><Download size={16} aria-hidden="true" />{attachment.fileName} ({Math.ceil(attachment.size / 1024)} KiB)</button>{error && <p className="forms-error" role="alert">{error}</p>}</div>;
}
