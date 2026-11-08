import { useDocumentTitle } from '../../app/useDocumentTitle.js';

/** Placeholder; the wall feature replaces this page. */
export function WallPreviewPage() {
  useDocumentTitle('Wall preview');
  return (
    <section className="mx-auto max-w-7xl px-3 py-6 sm:px-5">
      <h1 className="font-display text-3xl font-bold">Wall preview</h1>
      <p className="mt-2 text-muted">This page shows exactly what the lobby display shows.</p>
    </section>
  );
}
