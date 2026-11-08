import { useDocumentTitle } from '../../app/useDocumentTitle.js';

/** Placeholder; the inbox feature replaces this page. */
export function InboxPage() {
  useDocumentTitle('Inbox');
  return (
    <section className="mx-auto max-w-7xl px-3 py-6 sm:px-5">
      <h1 className="font-display text-3xl font-bold">Inbox</h1>
      <p className="mt-2 text-muted">Tasks from branch and personal mailboxes.</p>
    </section>
  );
}
