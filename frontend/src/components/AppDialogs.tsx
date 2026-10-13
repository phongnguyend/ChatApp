import { useState, useSyncExternalStore } from 'react';
import { Modal } from './Modal';
import { currentDialog, finishDialog, subscribeDialogs, type DialogRequest } from '../services/dialogs';

function Dialog({ item }: { item: DialogRequest }) {
  const [value, setValue] = useState(item.initial);
  const cancel = () => finishDialog(item, item.kind === 'prompt' ? null : false);
  return <Modal returnFocus={item.opener} initialFocus={item.kind === 'prompt' ? 'input' : '.app-modal-footer button'} className="app-dialog" aria-labelledby="app-dialog-title" aria-describedby={item.kind === 'prompt' ? undefined : 'app-dialog-message'} onCancel={event => {
    event.preventDefault();
    cancel();
  }}>
    <form onSubmit={event => {
      event.preventDefault();
      finishDialog(item, item.kind === 'prompt' ? value : true);
    }}>
      <Modal.Header><h2 id="app-dialog-title">{item.kind === 'confirm' ? 'Confirm action' : item.kind === 'prompt' ? 'Enter details' : 'Notice'}</h2></Modal.Header>
      <Modal.Body>{item.kind === 'prompt' ? <label>{item.message}<input autoFocus value={value} onChange={event => setValue(event.target.value)} /></label> : <p id="app-dialog-message">{item.message}</p>}</Modal.Body>
      <Modal.Footer>
        {item.kind !== 'alert' && <button type="button" autoFocus={item.kind === 'confirm'} onClick={cancel}>Cancel</button>}
        <button type="submit" autoFocus={item.kind === 'alert'}>{item.kind === 'confirm' ? 'Confirm' : 'OK'}</button>
      </Modal.Footer>
    </form>
  </Modal>;
}
export function AppDialogs() {
  const item = useSyncExternalStore(subscribeDialogs, currentDialog);
  return item ? <Dialog key={item.id} item={item} /> : null;
}
