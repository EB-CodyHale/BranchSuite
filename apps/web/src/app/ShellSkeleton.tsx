import { Skeleton } from '../ui/Skeleton.js';
import { ProductMark } from './ProductMark.js';

/** First-paint placeholder shaped like the shell, shown while the roster user loads. */
export function ShellSkeleton() {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="flex h-14 items-center gap-4 border-b border-line bg-surface px-3 sm:px-5">
        <ProductMark compact />
        <Skeleton className="hidden h-5 w-56 md:block" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-3 py-6 sm:px-5" role="status">
        <span className="sr-only">Loading BranchSuite…</span>
        <Skeleton className="h-7 w-48" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    </div>
  );
}
