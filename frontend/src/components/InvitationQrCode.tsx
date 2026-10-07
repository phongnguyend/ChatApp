import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { authFetch } from '../services/auth';

export function InvitationQrCode({ src, alt, linkLabel = 'invitation link', downloadName }: {
  src: string;
  alt: string;
  linkLabel?: string;
  downloadName?: string;
}) {
  const [image, setImage] = useState<{ source: string; url: string } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      setError(false);
      try {
        const response = await authFetch(src, { signal: controller.signal });
        if (!response.ok) {
          throw new Error('QR code unavailable');
        }
        const blob = await response.blob();
        if (controller.signal.aborted) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setImage({ source: src, url: objectUrl });
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
        }
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src, attempt]);

  if (error) {
    return <div className="join-link-qr-status"><p role="alert">Could not load the QR code. You can still copy the {linkLabel}.</p><button type="button" className="secondary-button" onClick={() => { setImage(null); setAttempt(value => value + 1); }}><RefreshCw size={16} aria-hidden="true" />Retry QR code</button></div>;
  }
  if (image?.source !== src) {
    return <p className="join-link-qr-status" role="status">Loading QR code…</p>;
  }
  return <>
    <img className="join-link-qr-code" src={image.url} alt={alt} onError={() => setError(true)} />
    {downloadName && <a href={image.url} download={downloadName}><Download size={16} aria-hidden="true" />Download QR code</a>}
  </>;
}
