import { useEffect } from 'react';

/** Sets the tab title as "<page> · BranchSuite". */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · BranchSuite` : 'BranchSuite';
  }, [title]);
}
