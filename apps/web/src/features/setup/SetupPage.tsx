import { Building2, FileInput, Filter, Mail, MonitorSmartphone, Route as RouteIcon, Store, Tv, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useMeContext } from '../../app/MeContext.js';
import { useDocumentTitle } from '../../app/useDocumentTitle.js';
import { cx } from '../../ui/cx.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { AccountImportSection } from './AccountImportSection.js';
import { AccountsSection } from './AccountsSection.js';
import { BranchesSection } from './BranchesSection.js';
import { DisplaysSection } from './DisplaysSection.js';
import { FilteredMailSection } from './FilteredMailSection.js';
import { MailboxesSection } from './MailboxesSection.js';
import { PeopleSection } from './PeopleSection.js';
import { RoutingTesterSection } from './RoutingTesterSection.js';
import { SetupBranchProvider, useSetupBranch } from './SetupBranchContext.js';
import { WallSettingsSection } from './WallSettingsSection.js';

interface SectionDef {
  path: string;
  label: string;
  icon: ReactNode;
  element: ReactNode;
  adminOnly?: boolean;
  /** Works on the selected branch (shows the branch picker). */
  branchScoped?: boolean;
}

export const SETUP_SECTIONS: readonly SectionDef[] = [
  { path: 'branches', label: 'Branches', icon: <Building2 />, element: <BranchesSection /> },
  { path: 'people', label: 'People', icon: <Users />, element: <PeopleSection />, branchScoped: true },
  { path: 'accounts', label: 'Accounts', icon: <Store />, element: <AccountsSection />, branchScoped: true },
  { path: 'routing', label: 'Routing tester', icon: <RouteIcon />, element: <RoutingTesterSection />, branchScoped: true },
  { path: 'import', label: 'Import accounts', icon: <FileInput />, element: <AccountImportSection />, adminOnly: true, branchScoped: true },
  { path: 'mailboxes', label: 'Mailboxes', icon: <Mail />, element: <MailboxesSection /> },
  { path: 'displays', label: 'Displays', icon: <MonitorSmartphone />, element: <DisplaysSection />, branchScoped: true },
  { path: 'wall', label: 'Wall settings', icon: <Tv />, element: <WallSettingsSection />, branchScoped: true },
  { path: 'filtered', label: 'Filtered mail', icon: <Filter />, element: <FilteredMailSection />, branchScoped: true },
];

/** Setup: managers and admins (the router guards the route). Owns the nested /setup/* routes. */
export function SetupPage() {
  useDocumentTitle('Setup');
  return (
    <SetupBranchProvider>
      <SetupLayout />
    </SetupBranchProvider>
  );
}

function SetupLayout() {
  const { isAdmin } = useMeContext();
  const sections = SETUP_SECTIONS.filter((s) => isAdmin || !s.adminOnly);
  const location = useLocation();
  const current = sections.find((s) => location.pathname.startsWith(`/setup/${s.path}`));

  return (
    <section className="mx-auto max-w-7xl px-4 py-5 sm:px-5 sm:py-6">
      <header className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.75rem] font-bold leading-none tracking-tight sm:text-3xl">Setup</h1>
          <p className="mt-1 text-sm text-muted">Branches, people, accounts, mailboxes and lobby displays.</p>
        </div>
        {current?.branchScoped ? <SetupBranchPicker /> : null}
      </header>

      <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8">
        <SetupNav sections={sections} currentPath={current?.path} />
        <div className="min-w-0">
          <Routes>
            <Route index element={<Navigate to="branches" replace />} />
            {sections.map((s) => (
              <Route key={s.path} path={`${s.path}/*`} element={s.branchScoped ? <BranchGate>{s.element}</BranchGate> : s.element} />
            ))}
            <Route path="*" element={<Navigate to="/setup/branches" replace />} />
          </Routes>
        </div>
      </div>
    </section>
  );
}

function SetupNav({ sections, currentPath }: { sections: readonly SectionDef[]; currentPath: string | undefined }) {
  const navigate = useNavigate();
  return (
    <>
      {/* Phones: a select keeps the whole list one tap away without a long horizontal strip. */}
      <label className="flex flex-col gap-1 md:hidden">
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Section</span>
        <select
          value={currentPath ?? ''}
          onChange={(e) => navigate(`/setup/${e.target.value}`)}
          className="h-10 w-full rounded-md border border-line-strong bg-surface px-2.5 font-semibold text-fg"
        >
          {sections.map((s) => (
            <option key={s.path} value={s.path}>
              {s.label}
              {s.adminOnly ? ' (admin)' : ''}
            </option>
          ))}
        </select>
      </label>
      <nav aria-label="Setup sections" className="hidden md:block">
        <ul className="sticky top-20 flex flex-col gap-0.5">
          {sections.map((s) => (
            <li key={s.path}>
              <NavLink
                to={`/setup/${s.path}`}
                className={({ isActive }) =>
                  cx(
                    'relative flex h-9 items-center gap-2.5 rounded-md pl-3 pr-2 text-sm font-semibold transition-colors',
                    'before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full',
                    isActive ? 'bg-surface text-fg shadow-card before:bg-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
                  )
                }
              >
                <span aria-hidden="true" className="inline-flex [&>svg]:size-4">
                  {s.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {s.adminOnly ? <span className="rounded-sm bg-surface-2 px-1 text-[0.6875rem] font-bold uppercase tracking-wider text-subtle">Admin</span> : null}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function SetupBranchPicker() {
  const { branches, branchId, setBranchId, branch } = useSetupBranch();
  if (branches.length === 0) return null;
  if (branches.length === 1) {
    return (
      <p className="text-sm font-semibold text-muted">
        Branch: <span className="text-fg">{branch?.name}</span>
      </p>
    );
  }
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">Branch</span>
      <select
        value={branchId}
        onChange={(e) => setBranchId(e.target.value)}
        className="h-9 w-full min-w-[12rem] max-w-xs rounded-md border border-line-strong bg-surface pl-2.5 pr-8 text-sm font-semibold text-fg hover:border-fg/50"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.code})
          </option>
        ))}
      </select>
    </label>
  );
}

/** Branch-scoped sections need an active managed branch. */
function BranchGate({ children }: { children: ReactNode }) {
  const { branchId } = useSetupBranch();
  if (!branchId) {
    return <EmptyState title="No branch to manage" description="You do not manage an active branch. An admin can add you to one, or reactivate a branch under Branches." />;
  }
  return children;
}
