import { useDocumentTitle } from '../../app/useDocumentTitle.js';

/**
 * Placeholder; the wall feature replaces this page. Rendered outside the authenticated shell:
 * no navigation, no user session, no /api/me.
 */
export function WallDisplayPage() {
  useDocumentTitle('Wall');
  return (
    <main data-theme="night" className="grid min-h-dvh place-items-center bg-bg px-4 text-fg">
      <h1 className="font-display text-4xl font-bold">BranchSuite wall</h1>
    </main>
  );
}
