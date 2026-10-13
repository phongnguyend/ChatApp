import { confirmDialog } from '../services/dialogs';
import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Presentation, Trash2 } from 'lucide-react';
import { boardsApi } from '../services/whiteboardsApi';
import { type Board, type BoardSummary } from '../components/whiteboards/boardModel';
import { WhiteboardWorkspace } from '../components/whiteboards/WhiteboardWorkspace';
import '../components/whiteboards/Whiteboards.css';

export function WhiteboardsView({ hidden, onBack }: { hidden: boolean; onBack: () => void }) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [active, setActive] = useState<Board | null>(null);
  const [error, setError] = useState('');
  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : 'Unable to load whiteboards.');
  }
  function refresh() {
    return boardsApi<BoardSummary[]>('/').then(setBoards).catch(report);
  }
  useEffect(() => {
    if (!hidden) {
      void refresh();
      const id = new URLSearchParams(location.search).get('whiteboard');
      if (id) {
        void boardsApi<Board>(`/${encodeURIComponent(id)}`).then(setActive).catch(report);
        const url = new URL(location.href);
        url.searchParams.delete('whiteboard');
        history.replaceState(null, '', url);
      }
    }
  }, [hidden]);
  if (hidden && !active) {
    return null;
  }
  return <section className="whiteboards-view" hidden={hidden}>{active ? <WhiteboardWorkspace key={active.id} initial={active} onBack={() => { setActive(null); void refresh(); }} /> : <>
    <header><button onClick={onBack}><ArrowLeft size={18} /> Back</button><div><h1>Whiteboards</h1><p>Sketch ideas and work together on a shared canvas.</p></div><button onClick={() => void boardsApi<Board>('/', 'POST').then(setActive).catch(report)}><Plus size={18} /> New whiteboard</button></header>
    {error && <p role="alert">{error}</p>}
    <div className="whiteboard-list">{boards.map(board => <article key={board.id}><button className="whiteboard-card" onClick={() => void boardsApi<Board>(`/${board.id}`).then(setActive).catch(report)}><Presentation size={32} /><h2>{board.title}</h2><span>{board.isOwner ? 'Your board' : 'Shared with you'} · {new Date(board.updatedAt).toLocaleDateString()}</span></button>{board.isOwner && <button aria-label={`Delete ${board.title}`} onClick={async () => {
      if (await confirmDialog('Delete this whiteboard? Uploaded images remain in My Documents.')) {
        void boardsApi(`/${board.id}`, 'DELETE').then(refresh).catch(report);
      }
    }}><Trash2 size={16} /> Delete</button>}</article>)}{!boards.length && <p>Create your first whiteboard to start drawing.</p>}</div>
  </>}</section>;
}
