import type { PersonalMailStatus } from '@branchsuite/shared';
import { CircleAlert, Clock, Lock, MailCheck, ShieldCheck, Unplug } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../lib/api.js';
import { relativeAgeLong } from '../../lib/format.js';
import { useConnectMyMail, useDisconnectMyMail, useMyMail } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { ConfirmDialog } from '../../ui/ConfirmDialog.js';
import { cx } from '../../ui/cx.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { useToast } from '../../ui/Toast.js';

export function isMailConnected(status: PersonalMailStatus | undefined): boolean {
  return !!status && status.connected && status.status !== 'not_connected' && status.status !== 'disabled';
}

const STATE: Record<'pending' | 'ok' | 'no_access' | 'error', { label: string; tone: string; icon: ReactNode }> = {
  pending: { label: 'Waiting for access', tone: 'text-warning', icon: <Clock /> },
  ok: { label: 'Connected', tone: 'text-success', icon: <MailCheck /> },
  no_access: { label: 'Needs admin approval', tone: 'text-warning', icon: <CircleAlert /> },
  error: { label: 'Sync problem', tone: 'text-danger', icon: <CircleAlert /> },
};

function statusDetail(s: PersonalMailStatus): string {
  switch (s.status) {
    case 'pending':
      return 'Your request is in. Tasks start arriving after the first successful sync, usually within a few minutes once an admin has approved access.';
    case 'no_access':
      return s.help ?? 'BranchSuite cannot read your mailbox yet. An admin needs to approve personal mail access for you.';
    case 'error':
      return s.lastError ?? 'The last sync failed. It will retry automatically.';
    case 'ok':
      return s.lastSyncAt ? `Last checked ${relativeAgeLong(s.lastSyncAt)}.` : 'Waiting for the first sync.';
    default:
      return '';
  }
}

/**
 * Personal mail opt-in. `full` explains the feature (shown in the Personal view before connecting);
 * `strip` is a one-line status with Disconnect (and Connect when not yet connected).
 */
export function PersonalMailCard({ variant }: { variant: 'full' | 'strip' }) {
  const mail = useMyMail();
  const connect = useConnectMyMail();
  const disconnect = useDisconnectMyMail();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  if (mail.isPending) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4" aria-busy="true">
        <span className="sr-only">Checking your mailbox connection…</span>
        <Skeleton className="h-5 w-48" />
      </div>
    );
  }
  if (mail.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
        <CircleAlert aria-hidden="true" className="size-4" />
        <span className="flex-1">Your mailbox status did not load. {errorMessage(mail.error)}</span>
        <Button size="sm" onClick={() => void mail.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const status = mail.data;
  const connected = isMailConnected(status);
  const onConnect = () =>
    connect.mutate(undefined, {
      onSuccess: () => toast({ title: 'Mailbox connection requested', tone: 'success' }),
      onError: (e) => toast({ title: 'Could not connect your mailbox', description: errorMessage(e), tone: 'danger' }),
    });
  const onDisconnect = () =>
    disconnect.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        toast({ title: 'Mailbox disconnected', description: 'New mail will no longer become tasks.', tone: 'success' });
      },
      onError: (e) => toast({ title: 'Could not disconnect', description: errorMessage(e), tone: 'danger' }),
    });

  const confirm = (
    <ConfirmDialog
      open={confirming}
      title="Disconnect your mailbox?"
      description="BranchSuite stops reading your mailbox. Your existing personal tasks stay, and you can reconnect at any time."
      confirmLabel="Disconnect"
      tone="danger"
      loading={disconnect.isPending}
      onConfirm={onDisconnect}
      onCancel={() => setConfirming(false)}
    />
  );

  if (!connected) {
    if (variant === 'strip') {
      return (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm">
          <Lock aria-hidden="true" className="size-4 text-muted" />
          <span className="min-w-0 flex-1 text-muted">Connect your own mailbox to see private tasks here too. Only you can see them.</span>
          <Button size="sm" variant="secondary" onClick={onConnect} loading={connect.isPending}>
            Connect my mailbox
          </Button>
        </div>
      );
    }
    return (
      <section aria-labelledby="personal-mail-title" className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6 shadow-card">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Lock className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="personal-mail-title" className="font-display text-2xl font-bold leading-tight">
              Personal mail
            </h2>
            <p className="mt-1 text-sm text-muted">Turn requests in your own Outlook inbox into tasks, sorted and prioritized like the branch inbox.</p>
          </div>
        </div>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          <li className="flex gap-2">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              <strong className="font-semibold">Private to you.</strong> Personal tasks are not visible to coworkers or managers, and never appear on the board or the wall.
            </span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>Read-only: BranchSuite never sends, moves or deletes your email.</span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>An admin approves access first. You can disconnect at any time.</span>
          </li>
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={onConnect} loading={connect.isPending}>
            Connect my mailbox
          </Button>
          {status?.status === 'disabled' && status.address ? <span className="text-sm text-muted">Previously connected: {status.address}</span> : null}
        </div>
      </section>
    );
  }

  const meta = STATE[status!.status as keyof typeof STATE] ?? STATE.pending;
  return (
    <div className={cx('flex flex-wrap items-start gap-3 rounded-lg border bg-surface px-4 py-2.5 text-sm', status!.status === 'ok' ? 'border-line' : 'border-warning/50')}>
      <span aria-hidden="true" className={cx('mt-0.5 inline-flex [&>svg]:size-4', meta.tone)}>
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p>
          <span className={cx('font-semibold', meta.tone)}>{meta.label}</span>
          {status!.address ? <span className="text-muted"> · {status!.address}</span> : null}
          <span className="text-muted"> · Private to you</span>
        </p>
        <p className="text-xs text-muted">{statusDetail(status!)}</p>
      </div>
      <Button size="sm" variant="ghost" icon={<Unplug aria-hidden="true" className="size-4" />} onClick={() => setConfirming(true)}>
        Disconnect
      </Button>
      {confirm}
    </div>
  );
}
