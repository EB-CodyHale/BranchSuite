import type { AccountImportPlan, AccountImportPlanRow } from '@branchsuite/shared';
import { useState } from 'react';
import { useMeContext } from '../../app/MeContext.js';
import { useImportAccounts } from '../../lib/queries.js';
import { Badge, type BadgeTone } from '../../ui/Badge.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Textarea } from '../../ui/Field.js';
import { Segmented } from '../../ui/Segmented.js';
import { useToast } from '../../ui/Toast.js';
import { parseImport, type ImportFormat } from './importModel.js';
import { useSetupBranch } from './SetupBranchContext.js';
import { ErrorNote, Notice, Panel, SectionHeader } from './setupUi.js';

const ACTION: Record<AccountImportPlanRow['action'], { label: string; tone: BadgeTone }> = {
  create: { label: 'Create', tone: 'accent' },
  update: { label: 'Update', tone: 'warning' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
};

const EXAMPLES: Record<ImportFormat, string> = {
  csv: 'name,accountNumber,sourceId\nLakeside Foods,10442,SRC-881\n"Orbit Plastics, Plant 2",10518,SRC-902',
  json: '[\n  { "name": "Lakeside Foods", "accountNumber": "10442", "sourceId": "SRC-881" }\n]',
};

/** Admin only: bulk-create or update accounts from an export. Always a dry run first. */
export function AccountImportSection() {
  const { isAdmin } = useMeContext();
  const { branchId, branch } = useSetupBranch();
  const importer = useImportAccounts();
  const { toast } = useToast();
  const [format, setFormat] = useState<ImportFormat>('csv');
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<{ plan: AccountImportPlan; text: string; branchId: string } | null>(null);
  const [localErrors, setLocalErrors] = useState<string[]>([]);

  if (!isAdmin) return <EmptyState title="Admins only" description="Ask an admin to import accounts for your branch." />;

  const run = (apply: boolean) => {
    const parsed = parseImport(text, format);
    setLocalErrors(parsed.errors);
    if (parsed.errors.length > 0) {
      setPlan(null);
      return;
    }
    importer.mutate(
      { branchId, input: { apply, accounts: parsed.rows } },
      {
        onSuccess: (result) => {
          setPlan({ plan: result, text, branchId });
          if (result.applied) toast({ tone: 'success', title: 'Import applied', description: `${result.counts.create} created, ${result.counts.update} updated.` });
        },
      },
    );
  };

  const current = plan && plan.text === text && plan.branchId === branchId ? plan.plan : null;
  const canApply = current !== null && !current.applied && current.counts.error === 0 && current.counts.create + current.counts.update > 0;

  return (
    <div>
      <SectionHeader
        title="Import accounts"
        branchScoped
        description="Paste an account export to add new accounts and update names and numbers on existing ones. Nothing changes until you apply."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel title="1. Paste the list">
          <div className="flex flex-col gap-3">
            <Segmented
              label="Format"
              value={format}
              onChange={(f) => {
                setFormat(f);
                setLocalErrors([]);
              }}
              options={[
                { value: 'csv', label: 'CSV' },
                { value: 'json', label: 'JSON' },
              ]}
            />
            <Textarea
              label={format === 'csv' ? 'CSV rows' : 'JSON array'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              spellCheck={false}
              placeholder={EXAMPLES[format]}
              hint={format === 'csv' ? 'Columns: name, accountNumber, sourceId. A header row is optional. Quote names that contain commas.' : 'An array of objects with name, and optionally accountNumber and sourceId.'}
            />
            <Notice tone="info" title="How rows match">
              Each row matches an existing account by source id, then account number, then exact name. A match updates that account; otherwise a new account is created with its own wall code. Accounts are never deleted.
            </Notice>
            {localErrors.length > 0 ? (
              <Notice tone="danger" role="alert" title="Fix these lines first">
                <ul className="list-disc pl-4">
                  {localErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => run(false)} loading={importer.isPending && !importer.variables?.input.apply} disabled={!text.trim()}>
                Dry run
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="2. Check the plan, then apply" description={branch ? `Into ${branch.name}` : undefined}>
          <ErrorNote error={importer.error} className="mb-3" />
          {!current ? (
            <p className="py-8 text-center text-sm text-muted">{plan ? 'The text changed since the last dry run. Run it again.' : 'Run a dry run to see what would change.'}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(['create', 'update', 'unchanged', 'error'] as const).map((k) => (
                  <div key={k} className="rounded-md border border-line px-3 py-2">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-subtle">{ACTION[k].label}</dt>
                    <dd className={`font-display text-2xl font-bold tabular-nums ${k === 'error' && current.counts.error > 0 ? 'text-danger' : ''}`}>{current.counts[k]}</dd>
                  </div>
                ))}
              </dl>
              {current.applied ? <Notice tone="info" title="Applied">These changes are saved. Paste a new list to import more.</Notice> : null}
              {current.counts.error > 0 ? <Notice tone="danger" title="Errors block the import">Fix or remove the rows marked Error, then run the dry run again.</Notice> : null}
              <div className="max-h-[28rem] overflow-auto rounded-md border border-line">
                <table className="w-full min-w-[28rem] text-sm">
                  <caption className="sr-only">Import plan</caption>
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wider text-subtle">
                      <th scope="col" className="px-3 py-2">Account</th>
                      <th scope="col" className="px-3 py-2">Action</th>
                      <th scope="col" className="px-3 py-2">What happens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.rows.map((r, i) => (
                      <tr key={i} className="border-b border-line last:border-b-0">
                        <th scope="row" className="px-3 py-1.5 text-left font-semibold">{r.name}</th>
                        <td className="px-3 py-1.5">
                          <Badge tone={ACTION[r.action].tone}>{ACTION[r.action].label}</Badge>
                        </td>
                        <td className="px-3 py-1.5 text-muted">{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {current.applied ? null : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" onClick={() => run(true)} disabled={!canApply} loading={importer.isPending && importer.variables?.input.apply === true}>
                    Apply import
                  </Button>
                  <span className="text-sm text-muted">
                    {canApply ? `${current.counts.create} new, ${current.counts.update} updated.` : current.counts.error > 0 ? 'Errors must be fixed first.' : 'Nothing to change.'}
                  </span>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
