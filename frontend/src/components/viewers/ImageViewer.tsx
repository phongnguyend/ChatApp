import { Modal } from '../Modal';
import { useEffect, useEffectEvent, type ReactNode, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { ErrorBanner, MaximizeButton } from '../signing/ui';
import { useViewerMaximized } from '../signing/useViewerMaximized';
import './viewers.css';
export function ImageViewer({ name, sourceKey, load, onClose, footer }: {
    name: string;
    sourceKey: string;
    load: (signal: AbortSignal) => Promise<Blob>;
    footer?: ReactNode;
    onClose: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const [maximized, toggleMaximized] = useViewerMaximized();
    const loadDocument = useEffectEvent((signal: AbortSignal) => load(signal));
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        let objectUrl: string | undefined;
        setUrl(null);
        setError(null);
        loadDocument(controller.signal).then(blob => {
            if (!controller.signal.aborted) {
                objectUrl = URL.createObjectURL(blob);
                setUrl(objectUrl);
            }
        }).catch(cause => {
            if (!controller.signal.aborted) {
                setError(cause instanceof Error ? cause.message : String(cause));
            }
        });
        return () => {
            controller.abort();
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
        // sourceKey identifies the image; capture the loader for this request.
    }, [sourceKey]);
    return <Modal ref={dialogRef} className={maximized ? 'office-dialog is-maximized' : 'office-dialog'} aria-label={`Preview ${name}`} onCancel={event => {
            if (event.target !== event.currentTarget) {
                return;
            }
            event.preventDefault();
            onClose();
        }}>
<Modal.Header as="div" className="office-toolbar">
      <strong title={name}>{name}</strong>
      <div className="row">
        {url ? <a className="button-link" href={url} download={name}><Download size={14}/>Download</a> : null}
        <MaximizeButton maximized={maximized} onToggle={toggleMaximized}/>
        <button className="ghost" ref={closeRef} onClick={onClose}><X size={15}/>Close</button>
      </div>
    </Modal.Header>
<Modal.Body>
<div className="office-content image-preview-content">
      {error ? <ErrorBanner message={error}/> : !url ? <div className="office-message" role="status">Downloading image…</div> : (<img src={url} alt={name} onError={() => setError('This image could not be displayed. Download the original file to open it.')}/>)}
    </div>
</Modal.Body>{footer && <Modal.Footer className="office-footer">{footer}</Modal.Footer>}

</Modal>;
}
