import { Link } from 'react-router-dom';
import { buttonClasses } from '../ui/Button.js';
import { EmptyState } from '../ui/EmptyState.js';
import { useDocumentTitle } from './useDocumentTitle.js';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <EmptyState
      title="Page not found"
      description="That address does not match anything in BranchSuite."
      action={
        <Link to="/" className={buttonClasses('primary')}>
          Go to the board
        </Link>
      }
    />
  );
}
