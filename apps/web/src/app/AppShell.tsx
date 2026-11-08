import { useQueryClient } from '@tanstack/react-query';
import { Inbox, LayoutGrid, LogOut, Moon, Palette, Presentation, Radio, RefreshCw, Settings, Sun, Users, WifiOff } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useRealtime, type ConnectionStatus } from '../lib/realtime.js';
import { cx } from '../ui/cx.js';
import { MarkerDot, markerLabel } from '../ui/MarkerDot.js';
import { Menu, MenuItem, MenuLabel, MenuRadioItem, MenuSeparator } from '../ui/Menu.js';
import { signOut } from './auth/session.js';
import { ALL_BRANCHES, useBranchScope } from './BranchScope.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { useMeContext } from './MeContext.js';
import { ProductMark } from './ProductMark.js';
import { markerInkVar, markerWashVar, THEME_OPTIONS } from './theme.js';
import { useTheme } from './useTheme.js';

export const ROLE_LABELS = { admin: 'Admin', manager: 'Branch manager', member: 'Team member' } as const;

/** Authenticated chrome: top bar with product mark, primary nav, branch scope, theme and user menus. */
export function AppShell() {
  const { permissions } = useMeContext();
  const { status } = useRealtime(permissions.branchIds);
  const location = useLocation();

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <a
        href="#main"
        className="sr-only z-[80] rounded-md bg-accent px-3 py-2 font-semibold text-accent-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-4 sm:px-5">
          <NavLink to="/" aria-label="BranchSuite board" className="shrink-0 rounded-md">
            <ProductMark compact />
          </NavLink>
          <PrimaryNav className="hidden md:flex" />
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
            <ConnectionIndicator status={status} />
            <BranchScopeSelect />
            <ThemeMenu />
            <UserMenu />
          </div>
        </div>
        <PrimaryNav className="flex border-t border-line px-1.5 md:hidden" />
      </header>
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

function PrimaryNav({ className }: { className?: string }) {
  const { me, canManageAny } = useMeContext();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cx(
      'relative inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 transition-colors md:h-9',
      'after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full',
      isActive ? 'text-fg after:bg-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
    );
  const secondary = (s: { isActive: boolean }) => cx(linkClass(s), 'text-sm font-semibold');
  return (
    <nav aria-label="Primary" className={cx('items-center gap-0.5 overflow-x-auto', className)}>
      <NavLink to="/" end className={(s) => cx(linkClass(s), 'font-display text-[1.0625rem] font-bold tracking-wide')}>
        <LayoutGrid aria-hidden="true" className="size-4" />
        Board
      </NavLink>
      <NavLink to="/whiteboard" className={secondary}>
        <Presentation aria-hidden="true" className="size-4" />
        Whiteboard
      </NavLink>
      {me.features.pipeline ? (
        <NavLink to="/pipeline" className={secondary}>
          <Users aria-hidden="true" className="size-4" />
          Pipeline
        </NavLink>
      ) : null}
      <NavLink to="/inbox" className={secondary}>
        <Inbox aria-hidden="true" className="size-4" />
        Inbox
      </NavLink>
      {canManageAny ? (
        <NavLink to="/setup" className={secondary}>
          <Settings aria-hidden="true" className="size-4" />
          Setup
        </NavLink>
      ) : null}
    </nav>
  );
}

const CONNECTION: Record<ConnectionStatus, { label: string; detail: string; Icon: typeof Radio; tone: string }> = {
  live: { label: 'Live', detail: 'Live updates are on.', Icon: Radio, tone: 'text-success' },
  polling: { label: 'Polling', detail: 'Live updates are unavailable. Screens refresh on a timer.', Icon: RefreshCw, tone: 'text-warning' },
  offline: { label: 'Offline', detail: 'No network connection. New changes will load when you reconnect.', Icon: WifiOff, tone: 'text-danger' },
};

/** Connection state as icon + text (never color alone). */
export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const c = CONNECTION[status];
  return (
    <span role="status" title={c.detail} className={cx('inline-flex shrink-0 items-center gap-1 px-1 text-xs font-semibold', c.tone)}>
      <c.Icon aria-hidden="true" className="size-4" />
      <span className="max-lg:sr-only">{c.label}</span>
      <span className="sr-only">. {c.detail}</span>
    </span>
  );
}

function BranchScopeSelect() {
  const { scope, allBranchIds, branchesById, selectBranch } = useBranchScope();
  if (allBranchIds.length === 0) return null;
  if (allBranchIds.length === 1) {
    const only = branchesById.get(allBranchIds[0]!);
    return <span className="min-w-0 max-w-[9rem] truncate px-1 text-sm font-semibold text-muted sm:max-w-[14rem]">{only?.name}</span>;
  }
  return (
    <label className="min-w-0">
      <span className="sr-only">Branch scope</span>
      <select
        value={scope}
        onChange={(e) => selectBranch(e.target.value)}
        className="h-9 w-full max-w-[9.5rem] truncate rounded-md border border-line-strong bg-surface pl-2 pr-7 text-sm font-semibold text-fg hover:border-fg/50 sm:max-w-[15rem]"
      >
        <option value={ALL_BRANCHES}>All assigned branches</option>
        {allBranchIds.map((id) => (
          <option key={id} value={id}>
            {branchesById.get(id)?.name ?? id}
          </option>
        ))}
      </select>
    </label>
  );
}

const THEME_ICONS = { daylight: Sun, slate: Palette, night: Moon } as const;

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const Icon = THEME_ICONS[theme];
  return (
    <Menu
      label="Theme"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`Theme: ${THEME_OPTIONS.find((t) => t.id === theme)?.label ?? theme}`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
        >
          <Icon aria-hidden="true" className="size-[1.15rem]" />
        </button>
      )}
    >
      {THEME_OPTIONS.map((t) => {
        const ItemIcon = THEME_ICONS[t.id];
        return (
          <MenuRadioItem key={t.id} checked={t.id === theme} onSelect={() => setTheme(t.id)}>
            <span className="inline-flex items-center gap-2">
              <ItemIcon aria-hidden="true" className="size-4 text-muted" />
              {t.label}
            </span>
          </MenuRadioItem>
        );
      })}
    </Menu>
  );
}

function UserMenu() {
  const { me } = useMeContext();
  const qc = useQueryClient();
  const { user } = me;
  return (
    <Menu
      label="Account"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`Account: ${user.name}`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 font-display text-sm font-bold"
          style={{
            borderColor: `var(${markerInkVar(user.marker)})`,
            color: `var(${markerInkVar(user.marker)})`,
            backgroundColor: `var(${markerWashVar(user.marker)})`,
          }}
        >
          <span aria-hidden="true">{user.initials}</span>
        </button>
      )}
    >
      <MenuLabel>
        <span className="block font-semibold">{user.name}</span>
        <span className="block text-xs text-muted">{ROLE_LABELS[user.role]}</span>
        <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <MarkerDot marker={user.marker} label={null} size="sm" />
          {markerLabel(user.marker)} marker
        </span>
      </MenuLabel>
      <MenuSeparator />
      <MenuItem icon={<LogOut />} onSelect={() => signOut(() => void qc.resetQueries())}>
        Sign out
      </MenuItem>
    </Menu>
  );
}
