import { accountLabel, type Account, type Routing } from '@branchsuite/shared';
import { CircleCheck, CircleHelp, CircleSlash, Hand, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAccounts, useRoutingTest } from '../../lib/queries.js';
import { Badge, type BadgeTone } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { TextField, Textarea } from '../../ui/Field.js';
import { WallGlyph } from '../../ui/WallGlyph.js';
import { useSetupBranch } from './SetupBranchContext.js';
import { ErrorNote, Panel, SectionHeader } from './setupUi.js';

export const ROUTING_STATUS: Record<Routing['status'], { label: string; tone: BadgeTone; icon: typeof CircleCheck; meaning: string }> = {
  matched: { label: 'Matched', tone: 'success', icon: CircleCheck, meaning: 'The task goes straight to this account. An order can be drafted automatically.' },
  ambiguous: { label: 'Needs review', tone: 'warning', icon: CircleHelp, meaning: 'More than one account fits. A person picks the account on the task.' },
  unmatched: { label: 'Unmatched', tone: 'danger', icon: CircleSlash, meaning: 'No account fits. The task lands without an account.' },
  manual: { label: 'Set by hand', tone: 'neutral', icon: Hand, meaning: 'Someone chose the account manually.' },
};

/** Try how an email would route before turning on a mailbox, or after editing contacts and aliases. */
export function RoutingTesterSection() {
  const { branchId } = useSetupBranch();
  const accounts = useAccounts(branchId);
  const test = useRoutingTest();
  const [fromAddress, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const fromError = submitted && fromAddress.trim().length < 3 ? 'Enter the sender address, e.g. pat@client.example.' : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (fromAddress.trim().length < 3) return;
    test.mutate({ branchId, input: { fromAddress: fromAddress.trim(), subject, body } });
  };

  const byId = new Map((accounts.data ?? []).map((a) => [a.id, a] as const));
  const result = test.data;
  const status = result ? ROUTING_STATUS[result.routing.status] : null;

  return (
    <div>
      <SectionHeader
        title="Routing tester"
        branchScoped
        description="Paste a sender, subject and body to see which account the email would go to and why. Nothing is saved and no task is created."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Test email">
          <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
            <TextField label="From" value={fromAddress} onChange={(e) => setFrom(e.target.value)} required placeholder="Pat Lee <pat@client.example>" error={fromError} autoComplete="off" />
            <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} />
            <Textarea label="Body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={12000} hint="Only the new text matters; routing ignores quoted history." />
            <div>
              <Button type="submit" variant="primary" loading={test.isPending} icon={<Send aria-hidden="true" className="size-4" />}>
                Test routing
              </Button>
            </div>
          </form>
        </Panel>

        <Panel title="Result">
          <ErrorNote error={test.error} />
          {!result || !status ? (
            <p className="py-6 text-center text-sm text-muted">Run a test to see the routing decision.</p>
          ) : (
            <div className="flex flex-col gap-4" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={status.tone} icon={<status.icon />} className="px-2 py-1 text-sm">
                  {status.label}
                </Badge>
                <p className="text-sm text-muted">{status.meaning}</p>
              </div>
              {result.routing.candidates.length > 0 ? (
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">{result.routing.candidates.length === 1 ? 'Account' : 'Candidates'}</h4>
                  <ul className="flex flex-col gap-1.5">
                    {result.routing.candidates.map((c) => {
                      const account: Account | undefined = byId.get(c.accountId);
                      return (
                        <li key={`${c.accountId}|${c.unitId ?? ''}`} className="flex items-start gap-2.5 rounded-md border border-line px-2.5 py-2">
                          {account ? <WallGlyph glyph={account.wall.glyph} color={account.wall.color} code={account.wall.code} size={28} label={null} /> : null}
                          <span className="min-w-0">
                            <span className="block font-semibold">{account ? accountLabel(account, c.unitId) : 'Unknown account'}</span>
                            <span className="block text-sm text-muted">{c.reason}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">How it decided</h4>
                <ol aria-label="Routing steps" className="flex flex-col gap-1.5">
                  {result.explanation.map((step, i) => (
                    <li key={i} className="flex gap-2.5 text-sm">
                      <span aria-hidden="true" className="mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold tabular-nums text-muted">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
