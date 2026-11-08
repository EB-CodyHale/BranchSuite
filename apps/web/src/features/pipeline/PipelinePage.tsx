import { useDocumentTitle } from '../../app/useDocumentTitle.js';

/** Placeholder; the pipeline feature replaces this page. */
export function PipelinePage() {
  useDocumentTitle('Candidate pipeline');
  return (
    <section className="mx-auto max-w-7xl px-3 py-6 sm:px-5">
      <h1 className="font-display text-3xl font-bold">Candidate pipeline</h1>
      <p className="mt-2 text-muted">Candidates in process, by stage.</p>
    </section>
  );
}
