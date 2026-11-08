import {
  accountLabel,
  effectivePriority,
  payText,
  ROLE_CATEGORIES,
  shortDay,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  type AccountLite,
  type Task,
  type TaskCategory,
  type TaskPriority,
  type TaskUpdateInput,
} from '@branchsuite/shared';
import { CircleCheck, ClipboardList, ExternalLink, History, Lock, Mail, MessagesSquare, Reply, RotateCcw, Route, TriangleAlert, UserPlus } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../lib/api.js';
import { useUpdateTask } from '../../lib/queries.js';
import { Badge } from '../../ui/Badge.js';
import { Button, buttonClasses } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { Drawer } from '../../ui/Dialog.js';
import { Select, TextField } from '../../ui/Field.js';
import { useToast } from '../../ui/Toast.js';
import { CreateOrderDialog } from './CreateOrderDialog.js';
import { useInboxActions, useInboxEnv } from './InboxContext.js';
import {
  ageLongLabel,
  boardOrderHref,
  branchPeople,
  canClaim,
  categoryLabel,
  formatDateTime,
  needsRouting,
  PRIORITY_LABEL,
  safeWebLink,
  staffingChipLabel,
  staffingState,
  taskAccountText,
} from './inboxModel.js';
import { PersonTag, PriorityBadge, StaffingChip } from './TaskBits.js';
import { TaskMessages } from './TaskMessages.js';

export interface TaskDrawerProps {
  task: Task;
  /** Accounts of every branch in scope (filtered to the task's branch here). */
  accounts: readonly AccountLite[];
  onClose: () => void;
}

function Section({ title, icon, children, className }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('border-t border-line pt-4', className)} aria-label={title}>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
        {icon ? <span aria-hidden="true" className="inline-flex [&>svg]:size-3.5">{icon}</span> : null}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words font-medium text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Task details side panel: edit, route, read the thread, create an order, complete. */
export function TaskDrawer({ task, accounts, onClose }: TaskDrawerProps) {
  const env = useInboxEnv();
  const actions = useInboxActions();
  const update = useUpdateTask();
  const { toast } = useToast();
  const [pending, setPending] = useState<TaskUpdateInput>({});
  const [title, setTitle] = useState(task.title);
  const [showThread, setShowThread] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const titleFormId = useId();

  useEffect(() => setTitle(task.title), [task.title]);

  const isBranch = task.scope === 'branch' && task.branchId !== null;
  const branch = task.branchId ? env.branchesById.get(task.branchId) : undefined;
  const timeZone = branch?.timeZone;
  const manager = isBranch && env.canManage(task.branchId!);
  const editable = !env.readOnly && task.status === 'open';
  const busy = actions.busyIds.has(task.id);

  // Values on screen: the server's task with any in-flight patch applied.
  const { category: pendingCategory, ...pendingRest } = pending;
  const shown: Task = { ...task, ...pendingRest, ...(pendingCategory ? { category: pendingCategory } : {}) };
  const categoryValue = pendingCategory !== undefined ? (pendingCategory ?? '') : task.categorySource === 'auto' ? '' : task.category;
  const priority = effectivePriority(shown, env.accountsById);
  const branchAccounts = accounts.filter((a) => a.branchId === task.branchId && a.active).sort((a, b) => a.name.localeCompare(b.name));
  const account = shown.accountId ? env.accountsById.get(shown.accountId) : undefined;
  const people = branchPeople(env.peopleById.values(), task.branchId);
  const assignee = shown.assigneeId ? env.peopleById.get(shown.assigneeId) : undefined;
  const staffing = staffingState(task, env.ordersById);
  const webLink = safeWebLink(task.email?.webLink);
  const today = env.todayFor(task);

  const patch = (input: TaskUpdateInput, success?: string) => {
    setPending((p) => ({ ...p, ...input }));
    update.mutate(
      { scopeId: task.scopeId, taskId: task.id, input },
      {
        onSuccess: () => (success ? toast({ title: success, tone: 'success' }) : undefined),
        onError: (e) => toast({ title: 'Change not saved', description: errorMessage(e), tone: 'danger' }),
        onSettled: () =>
          setPending((p) => {
            const next = { ...p };
            for (const k of Object.keys(input) as Array<keyof TaskUpdateInput>) delete next[k];
            return next;
          }),
      },
    );
  };

  const saveTitle = (e: FormEvent) => {
    e.preventDefault();
    const next = title.trim();
    if (!next || next === task.title) return;
    patch({ title: next }, 'Title saved');
  };

  const routingStatus = needsRouting(task);
  const candidates = task.routing.candidates.filter((c) => env.accountsById.has(c.accountId));

  const footer = env.readOnly ? (
    <p className="mr-auto text-sm text-muted">Saved day: a read-only record.</p>
  ) : (
    <>
      {canClaim(task, env.readOnly) ? (
        <Button icon={<UserPlus aria-hidden="true" className="size-4" />} onClick={() => actions.claim(task)} loading={busy}>
          Claim
        </Button>
      ) : null}
      {task.status === 'open' ? (
        <Button variant="primary" icon={<CircleCheck aria-hidden="true" className="size-4" />} onClick={() => actions.complete(task)} loading={busy}>
          Mark complete
        </Button>
      ) : (
        <Button icon={<RotateCcw aria-hidden="true" className="size-4" />} onClick={() => actions.reopen(task)} loading={busy}>
          Reopen
        </Button>
      )}
    </>
  );

  return (
    <>
      <Drawer
        open
        width="34rem"
        onClose={onClose}
        title={task.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {task.scope === 'personal' ? (
              <span className="inline-flex items-center gap-1 font-semibold">
                <Lock aria-hidden="true" className="size-3.5" />
                Private · only you can see this
              </span>
            ) : (
              <span>{branch?.name ?? 'Branch task'}</span>
            )}
            <span aria-hidden="true">·</span>
            <span>{ageLongLabel(task.boardDate, today) || `Board ${task.boardDate}`}</span>
            {task.boardDate !== today ? <span>(originally on {shortDay(task.boardDate)})</span> : null}
          </span>
        }
        footer={footer}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={priority} />
            {task.status !== 'open' ? (
              <Badge tone="success" icon={<CircleCheck />}>
                {task.status === 'reply_closed' ? 'Completed by reply' : 'Completed'}
              </Badge>
            ) : null}
            <Badge tone="neutral">{categoryLabel(shown.category)}{task.categorySource === 'auto' ? ' · Auto' : ''}</Badge>
            {staffing ? <StaffingChip state={staffing} /> : null}
          </div>

          {task.status === 'reply_closed' && task.closedByReply ? (
            <div className="rounded-md border border-success/40 bg-success-soft px-3 py-2.5 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-success">
                <Reply aria-hidden="true" className="size-4" />
                Completed by a team reply
              </p>
              <p className="mt-0.5 text-fg">
                {task.closedByReply.fromAddress} · {formatDateTime(task.closedByReply.at, timeZone)}
              </p>
              {task.closedByReply.excerpt ? <blockquote className="mt-1.5 border-l-2 border-success/50 pl-2 italic text-muted">{task.closedByReply.excerpt}</blockquote> : null}
              {task.closedByReply.reason ? <p className="mt-1 text-xs text-muted">Why: {task.closedByReply.reason}</p> : null}
            </div>
          ) : task.status === 'done' ? (
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <CircleCheck aria-hidden="true" className="size-4 text-success" />
              Completed{task.completedBy && env.peopleById.get(task.completedBy) ? ` by ${env.peopleById.get(task.completedBy)!.name}` : ''}
              {task.completedAt ? ` · ${formatDateTime(task.completedAt, timeZone)}` : ''}
            </p>
          ) : null}

          {isBranch && editable ? (
            <form id={titleFormId} onSubmit={saveTitle} className="flex items-end gap-2">
              <TextField label="Title" className="flex-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
              {title.trim() !== task.title && title.trim() !== '' ? (
                <Button type="submit" size="md" variant="primary" loading={update.isPending && pending.title !== undefined}>
                  Save
                </Button>
              ) : null}
            </form>
          ) : null}

          {task.summary ? <p className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-fg">{task.summary}</p> : <p className="text-sm italic text-muted">No summary.</p>}

          {/* ---- routing ---- */}
          {routingStatus ? (
            <div className="rounded-md border border-warning/50 bg-warning-soft px-3 py-2.5 text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-warning">
                <Route aria-hidden="true" className="size-4" />
                Needs routing
              </p>
              <p className="mt-0.5 text-fg">
                {task.routing.status === 'ambiguous'
                  ? 'The sender matches more than one account.'
                  : 'The sender did not match any account.'}{' '}
                {manager ? 'Pick the account this belongs to.' : 'A manager confirms the account.'}
              </p>
              {candidates.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1.5" aria-label="Suggested accounts">
                  {candidates.map((c) => {
                    const a = env.accountsById.get(c.accountId)!;
                    const label = accountLabel(a, c.unitId);
                    return (
                      <li key={`${c.accountId}:${c.unitId ?? ''}`} className="flex flex-wrap items-center gap-2">
                        {manager && editable ? (
                          <Button size="sm" onClick={() => patch({ accountId: c.accountId, unitId: c.unitId }, `Routed to ${label}`)}>
                            Use {label}
                          </Button>
                        ) : (
                          <span className="font-semibold">{label}</span>
                        )}
                        {c.reason ? <span className="text-xs text-muted">{c.reason}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* ---- fields ---- */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Priority"
              value={shown.priority}
              disabled={!editable}
              onChange={(e) => patch({ priority: e.target.value as TaskPriority })}
              hint={priority !== shown.priority ? 'Priority account: shown as at least Normal.' : undefined}
              options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            />
            <Select
              label="Category"
              value={categoryValue}
              disabled={!editable}
              onChange={(e) => patch({ category: e.target.value === '' ? null : (e.target.value as TaskCategory) })}
              hint={task.categorySource === 'auto' ? `Automatic: ${categoryLabel(task.category)}` : undefined}
              options={[{ value: '', label: 'Automatic' }, ...TASK_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]}
            />
            {isBranch ? (
              <Select
                label="Assignee"
                value={shown.assigneeId ?? ''}
                disabled={!editable}
                onChange={(e) => patch({ assigneeId: e.target.value || null })}
                options={[
                  { value: '', label: 'Unclaimed' },
                  ...people.map((p) => ({ value: p.id, label: p.id === env.viewerId ? `${p.name} (you)` : p.name })),
                  ...(shown.assigneeId && !people.some((p) => p.id === shown.assigneeId)
                    ? [{ value: shown.assigneeId, label: `${assignee?.name ?? 'Former owner'} · not in branch`, disabled: true }]
                    : []),
                ]}
              />
            ) : null}
            {isBranch && manager ? (
              <>
                <Select
                  label="Account"
                  value={shown.accountId ?? ''}
                  disabled={!editable}
                  onChange={(e) => patch({ accountId: e.target.value || null, unitId: null })}
                  options={[{ value: '', label: 'No account' }, ...branchAccounts.map((a) => ({ value: a.id, label: a.name }))]}
                />
                {account && account.units.some((u) => u.active) ? (
                  <Select
                    label="Unit"
                    value={shown.unitId ?? ''}
                    disabled={!editable}
                    onChange={(e) => patch({ unitId: e.target.value || null })}
                    options={[
                      { value: '', label: 'Whole account' },
                      ...account.units.filter((u) => u.active).map((u) => ({ value: u.id, label: accountLabel(account, u.id).split(' › ').slice(1).join(' › ') })),
                    ]}
                  />
                ) : null}
              </>
            ) : isBranch ? (
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">Account</span>
                <span className="text-muted">{taskAccountText(shown, env.accountsById) ?? 'Not routed yet'}</span>
              </div>
            ) : null}
          </div>

          {isBranch && assignee && !editable ? (
            <p className="text-sm text-muted">
              Owner: <PersonTag person={assignee} /> {assignee.name}
            </p>
          ) : null}

          {task.deadline ? (
            <p className="flex items-center gap-1.5 text-sm">
              <span className="font-semibold">Deadline</span>
              <span className="tabular-nums">{formatDateTime(task.deadline, timeZone)}</span>
              {task.status === 'open' && Date.parse(task.deadline) < Date.now() ? (
                <Badge tone="danger" icon={<TriangleAlert />}>
                  Missed
                </Badge>
              ) : null}
            </p>
          ) : null}

          {/* ---- staffing request ---- */}
          {task.staffingRequest ? (
            <Section title="Staffing request" icon={<ClipboardList />}>
              <div className="rounded-md border border-line bg-paper px-3 py-2.5">
                <Facts
                  rows={[
                    ['Role', task.staffingRequest.role],
                    ['Category', ROLE_CATEGORIES.find((r) => r.id === task.staffingRequest!.roleCategory)?.label],
                    [
                      'Headcount',
                      task.staffingRequest.headcount !== null ? (
                        <span className="tabular-nums">{task.staffingRequest.headcount}</span>
                      ) : task.staffingRequest.headcountText ? (
                        `“${task.staffingRequest.headcountText}” (not exact)`
                      ) : (
                        'Not stated'
                      ),
                    ],
                    ['Shift', task.staffingRequest.shift],
                    ['Days', task.staffingRequest.days],
                    ['Hours', task.staffingRequest.hours],
                    ['Pay', task.staffingRequest.payRate !== null ? payText(task.staffingRequest.payRate) : ''],
                    ['Start', task.staffingRequest.startDate ? shortDay(task.staffingRequest.startDate) : ''],
                    ['Site', task.staffingRequest.site],
                    ['Notes', task.staffingRequest.notes ? <span className="whitespace-pre-line font-normal">{task.staffingRequest.notes}</span> : ''],
                  ]}
                />
                {task.staffingRequest.blockedReason && !task.orderId ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-sm bg-warning-soft px-2 py-1.5 text-sm text-warning">
                    <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <span className="font-semibold">No order yet:</span> {task.staffingRequest.blockedReason}
                    </span>
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {staffing?.kind === 'order' ? (
                    <Link to={boardOrderHref(staffing.orderId)} className={buttonClasses('secondary', 'sm')}>
                      {staffingChipLabel(staffing)}: view on board
                    </Link>
                  ) : manager && !env.readOnly && task.status === 'open' ? (
                    <Button size="sm" variant="primary" icon={<ClipboardList aria-hidden="true" className="size-4" />} onClick={() => setOrderOpen(true)}>
                      Create order
                    </Button>
                  ) : isBranch && !manager ? (
                    <p className="text-xs text-muted">A manager turns this request into an order.</p>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}

          {/* ---- email ---- */}
          {task.email ? (
            <Section title="Email" icon={<Mail />}>
              <Facts
                rows={[
                  ['From', task.email.fromName ? `${task.email.fromName} <${task.email.fromAddress}>` : task.email.fromAddress],
                  ['Subject', task.email.subject],
                  ['Received', <span className="tabular-nums">{formatDateTime(task.email.receivedAt, timeZone)}</span>],
                  ['Messages', <span className="tabular-nums">{task.email.messageCount}</span>],
                ]}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {webLink ? (
                  <a href={webLink} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'sm')}>
                    <ExternalLink aria-hidden="true" className="size-4" />
                    Open in Outlook
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : null}
                <Button size="sm" variant="ghost" icon={<MessagesSquare aria-hidden="true" className="size-4" />} aria-expanded={showThread} onClick={() => setShowThread((v) => !v)}>
                  {showThread ? 'Hide messages' : `Show messages (${task.email.messageCount})`}
                </Button>
              </div>
              {showThread ? (
                <div className="mt-3">
                  <TaskMessages scopeId={task.scopeId} taskId={task.id} timeZone={timeZone} />
                </div>
              ) : null}
            </Section>
          ) : (
            <Section title="Source" icon={<History />}>
              <p className="text-sm text-muted">Added by hand{task.createdBy && env.peopleById.get(task.createdBy) ? ` by ${env.peopleById.get(task.createdBy)!.name}` : ''}.</p>
            </Section>
          )}
        </div>
      </Drawer>
      {orderOpen ? (
        <CreateOrderDialog task={task} accounts={accounts} shiftOptions={branch?.settings.shiftOptions} onClose={() => setOrderOpen(false)} />
      ) : null}
    </>
  );
}
