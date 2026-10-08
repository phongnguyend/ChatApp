import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { FormRenderer } from '../components/forms/FormRenderer';
import { type Answers, type FormDefinition } from '../components/forms/formModel';
import { FormsError, formsApi } from '../services/formsApi';
import '../components/forms/Forms.css';
export function PublicFormView({ token }: { token: string }) {
  const [data, setData] = useState<{ version: number; definition: FormDefinition } | null>(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [submissionKey] = useState(() => crypto.randomUUID());
  const uploadedFiles = useRef(new WeakMap<File, string>());
  useEffect(() => {
    let active = true;
    formsApi<{ version: number; definition: FormDefinition }>(`public/forms/${encodeURIComponent(token)}`, 'GET', undefined, true)
      .then(result => {
        if (active) {
          setData(result);
        }
      })
      .catch(reason => {
        if (active) {
          setError(reason.message);
        }
      });
    return () => { active = false; };
  }, [token]);
  async function uploadFile(questionId: string, file: File) {
    if (!data) {
      throw new Error('The form is not loaded.');
    }
    const body = new FormData();
    body.append('version', String(data.version));
    body.append('submissionKey', submissionKey);
    body.append('questionId', questionId);
    body.append('file', file);
    const uploaded = await formsApi<{ id: string }>(`public/forms/${encodeURIComponent(token)}/attachments`, 'POST', body, true);
    uploadedFiles.current.set(file, uploaded.id);
  }
  async function submit(answers: Answers, files: Record<string, File[]>) {
    if (!data || busy) {
      return;
    }
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const attachments = Object.fromEntries(Object.entries(files).map(([questionId, selected]) => [questionId, selected.map(file => {
        const id = uploadedFiles.current.get(file);
        if (!id) {
          throw new Error('A file has not finished uploading. Please select it again.');
        }
        return id;
      })]));
      await formsApi(`public/forms/${encodeURIComponent(token)}/responses`, 'POST', { version: data.version, submissionKey, answers, attachments }, true);
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Submission failed. Please try again.');
      if (reason instanceof FormsError) {
        setErrors(reason.errors);
      }
    } finally {
      setBusy(false);
    }
  }
  return <main className="forms-public forms-scope">
    {error && <div className="forms-banner forms-error" role="alert">{error}<button type="button" onClick={() => window.location.reload()}><RefreshCw size={16} aria-hidden="true" />Reload form</button></div>}
    {done ? <section className="forms-success" role="status"><span>✓</span><h1>Response submitted</h1><p>{data?.definition.confirmationMessage || 'Thank you! Your response has been recorded.'}</p></section>
      : data ? <FormRenderer definition={data.definition} onUploadFile={uploadFile} onSubmit={(answers, files) => { void submit(answers, files); }} busy={busy} errors={errors} /> : !error && <p role="status">Loading form…</p>}
    <footer>Powered by ChatApp Forms</footer>
  </main>;
}
