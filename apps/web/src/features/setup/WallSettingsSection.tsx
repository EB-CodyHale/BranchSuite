import { DEFAULT_PAY_BANDS, LIMITS, zWallSettings, type Branch, type WallSettings } from '@branchsuite/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateBranch } from '../../lib/queries.js';
import { Button } from '../../ui/Button.js';
import { IconButton } from '../../ui/IconButton.js';
import { TextField } from '../../ui/Field.js';
import { Segmented } from '../../ui/Segmented.js';
import { useToast } from '../../ui/Toast.js';
import { useSetupBranch } from './SetupBranchContext.js';
import { ErrorNote, Notice, SectionHeader, Switch } from './setupUi.js';
import { WallPreviewPanel } from './WallPreviewPanel.js';

type PayBand = NonNullable<WallSettings['payBands']>[number];

/** Stored settings with schema defaults filled in (falls back to the most private defaults). */
export function resolvedWall(branch: Branch): WallSettings {
  const parsed = zWallSettings.safeParse(branch.wall ?? {});
  return parsed.success ? parsed.data : zWallSettings.parse({});
}

/** Problems with a pay band list: empty labels, duplicate or unsorted minimums. */
export function payBandErrors(bands: readonly PayBand[]): string[] {
  const errors: string[] = [];
  if (bands.length === 0) errors.push('Add at least one band.');
  if (bands.some((b) => !b.label.trim())) errors.push('Every band needs a label, like $ or $$.');
  if (bands.some((b) => b.label.length > 8)) errors.push('Band labels are at most 8 characters.');
  if (bands.some((b) => !Number.isFinite(b.min) || b.min < 0 || b.min > LIMITS.maxPayRate)) errors.push(`Band minimums are between $0 and $${LIMITS.maxPayRate}.`);
  for (let i = 1; i < bands.length; i++) if (bands[i]!.min <= bands[i - 1]!.min) errors.push('Each band must start above the one before it.');
  return [...new Set(errors)];
}

const CLIENT_CHOICES = {
  code: 'A colored shape with a short code, like a blue diamond K7. Staff decode it with the legend; visitors cannot tell which client it is.',
  name: 'The client’s real company name.',
  hidden: 'No client mark at all, only the role and its openings.',
} as const;

const PAY_CHOICES = {
  hidden: 'No pay information.',
  band: 'A rough band such as $, $$ or $$$, using the bands below.',
  exact: 'The exact hourly rate, like $19.50/hr.',
} as const;

const CANDIDATE_CHOICES = {
  marks: 'Symbols only: ○ open, ◌ pending, ● filled, ✓ started. No letters.',
  initials: 'Candidate initials inside filled lines.',
  hidden: 'Only the open lines; filled lines are left out.',
} as const;

const OWNER_CHOICES = {
  marker: 'A dot in the recruiter’s marker color.',
  initials: 'The marker dot plus the recruiter’s initials.',
  hidden: 'No recruiter shown.',
} as const;

export function WallSettingsSection() {
  const { branch } = useSetupBranch();
  if (!branch) return null;
  return <WallSettingsForm key={branch.id} branch={branch} />;
}

export function WallSettingsForm({ branch }: { branch: Branch }) {
  const saved = resolvedWall(branch);
  const [draft, setDraft] = useState<WallSettings>(saved);
  const update = useUpdateBranch();
  const { toast } = useToast();
  const set = <K extends keyof WallSettings>(k: K, v: WallSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const bands = draft.payBands ?? DEFAULT_PAY_BANDS.map((b) => ({ ...b }));
  const bandErrors = draft.payDisplay === 'band' ? payBandErrors(bands) : [];
  const pageError = !Number.isInteger(draft.pageSeconds) || draft.pageSeconds < 5 || draft.pageSeconds > 120 ? 'Use 5 to 120 seconds.' : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const valid = bandErrors.length === 0 && !pageError && zWallSettings.safeParse(draft).success;

  const save = () => {
    if (!valid) return;
    const wall: WallSettings = draft.payDisplay === 'band' ? { ...draft, payBands: bands } : draft;
    update.mutate({ branchId: branch.id, input: { wall } }, { onSuccess: () => toast({ tone: 'success', title: 'Wall settings saved', description: 'Lobby displays update within a minute.' }) });
  };

  return (
    <div>
      <SectionHeader
        title="Wall settings"
        branchScoped
        description="What walk-in visitors can read on the lobby TV. The server applies these rules before anything leaves for the display."
        actions={
          <Link to="/setup/displays" className="text-sm font-semibold text-accent underline-offset-2 hover:underline">
            Manage displays
          </Link>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col gap-5">
          <ErrorNote error={update.error} />

          <Group title="Client" choice={CLIENT_CHOICES[draft.clientDisplay]}>
            <Segmented
              label="Client on the wall"
              value={draft.clientDisplay}
              onChange={(v) => set('clientDisplay', v)}
              options={[
                { value: 'code', label: 'Code' },
                { value: 'name', label: 'Name' },
                { value: 'hidden', label: 'Hidden' },
              ]}
            />
            {draft.clientDisplay === 'name' ? (
              <Notice tone="danger" role="alert" title="Client names will be public">
                Anyone in the lobby, including job seekers, competitors and other clients&apos; staff, can read <strong>who you staff for</strong> and how many people each client needs. Use names only on a screen in a staff-only room.
              </Notice>
            ) : null}
          </Group>

          <Group title="Pay" choice={PAY_CHOICES[draft.payDisplay]}>
            <Segmented
              label="Pay on the wall"
              value={draft.payDisplay}
              onChange={(v) => set('payDisplay', v)}
              options={[
                { value: 'hidden', label: 'Hidden' },
                { value: 'band', label: 'Band' },
                { value: 'exact', label: 'Exact' },
              ]}
            />
            {draft.payDisplay === 'exact' ? (
              <Notice tone="warning" title="Exact rates are visible to everyone">
                Visitors can compare rates between orders, and a competitor could note them. Bands give a sense of pay without the numbers.
              </Notice>
            ) : null}
            {draft.payDisplay === 'band' ? <PayBandEditor bands={bands} onChange={(b) => set('payBands', b)} errors={bandErrors} /> : null}
          </Group>

          <Group title="Candidates" choice={CANDIDATE_CHOICES[draft.candidateDisplay]}>
            <Segmented
              label="Candidates on the wall"
              value={draft.candidateDisplay}
              onChange={(v) => set('candidateDisplay', v)}
              options={[
                { value: 'marks', label: 'Symbols' },
                { value: 'initials', label: 'Initials' },
                { value: 'hidden', label: 'Hidden' },
              ]}
            />
            {draft.candidateDisplay === 'initials' ? (
              <Notice tone="warning" title="Initials can identify people">
                A candidate sitting in the lobby may recognise their own or a friend&apos;s initials next to a job. Symbols keep lines anonymous.
              </Notice>
            ) : null}
          </Group>

          <Group title="Role" choice={draft.roleDisplay === 'full' ? 'The role as written on the order, like "Forklift operator – freezer".' : 'Only the general category, like "Forklift". Hides client-specific wording.'}>
            <Segmented
              label="Role on the wall"
              value={draft.roleDisplay}
              onChange={(v) => set('roleDisplay', v)}
              options={[
                { value: 'full', label: 'Full title' },
                { value: 'category', label: 'Category' },
              ]}
            />
          </Group>

          <Group title="Recruiter" choice={OWNER_CHOICES[draft.ownerDisplay]}>
            <Segmented
              label="Recruiter on the wall"
              value={draft.ownerDisplay}
              onChange={(v) => set('ownerDisplay', v)}
              options={[
                { value: 'marker', label: 'Marker' },
                { value: 'initials', label: 'Initials' },
                { value: 'hidden', label: 'Hidden' },
              ]}
            />
          </Group>

          <Group title="Details">
            <div className="flex flex-col gap-3">
              <Switch checked={draft.showSchedule} onChange={(v) => set('showSchedule', v)} label="Show schedule" description="Days and hours, like M-F · 6a-2:30p." />
              <Switch
                checked={draft.showLocation}
                onChange={(v) => set('showLocation', v)}
                label="Show location"
                description={draft.showLocation ? 'Unit and site names are public. A building or street name can reveal the client behind a code.' : 'Unit and site names stay off the wall.'}
              />
              {draft.showLocation && draft.clientDisplay === 'code' ? (
                <Notice tone="warning" title="Location can undo the client code">
                  If a site is named after the client or its street, visitors can work out who a code stands for.
                </Notice>
              ) : null}
              <Switch checked={draft.showPaused} onChange={(v) => set('showPaused', v)} label="Show paused orders" description="Paused orders appear marked Paused. Off hides them until they resume." />
            </div>
          </Group>

          <Group title="Screen">
            <div className="flex flex-col gap-3">
              <TextField
                label="Headline"
                value={draft.headline}
                onChange={(e) => set('headline', e.target.value)}
                maxLength={120}
                placeholder="Now hiring – ask the front desk"
                hint={`${draft.headline.length}/120. A friendly banner across the top. Shown to everyone.`}
              />
              <div className="flex flex-wrap items-end gap-4">
                <TextField
                  label="Seconds per page"
                  type="number"
                  min={5}
                  max={120}
                  step={1}
                  value={Number.isFinite(draft.pageSeconds) ? draft.pageSeconds : ''}
                  onChange={(e) => set('pageSeconds', e.target.valueAsNumber)}
                  error={pageError}
                  className="w-40"
                  inputClassName="tabular-nums"
                  hint="When orders fill more than one screen."
                />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Wall theme</span>
                  <Segmented
                    label="Wall theme"
                    value={draft.theme}
                    onChange={(v) => set('theme', v)}
                    options={[
                      { value: 'dark', label: 'Dark' },
                      { value: 'light', label: 'Light' },
                    ]}
                  />
                </div>
              </div>
            </div>
          </Group>

          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-t border-line bg-bg/95 px-1 py-3 backdrop-blur-sm">
            <p role="status" className="mr-auto text-sm text-muted">
              {!valid ? <span className="font-semibold text-danger">Fix the highlighted settings to save.</span> : dirty ? 'Unsaved changes. The preview already shows them.' : 'Saved. Displays show these settings.'}
            </p>
            <Button onClick={() => setDraft(saved)} disabled={!dirty || update.isPending}>
              Reset
            </Button>
            <Button variant="primary" onClick={save} disabled={!dirty || !valid} loading={update.isPending}>
              Save wall settings
            </Button>
          </div>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <WallPreviewPanel branch={branch} settings={draft.payDisplay === 'band' ? { ...draft, payBands: bands } : draft} />
        </div>
      </div>
    </div>
  );
}

function Group({ title, choice, children }: { title: string; choice?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
      <legend className="sr-only">{title}</legend>
      <div aria-hidden="true" className="font-display text-lg font-semibold leading-tight">
        {title}
      </div>
      {children}
      {choice ? (
        <p className="text-sm text-muted">
          <span className="font-semibold text-fg">The public sees: </span>
          {choice}
        </p>
      ) : null}
    </fieldset>
  );
}

function PayBandEditor({ bands, onChange, errors }: { bands: PayBand[]; onChange: (b: PayBand[]) => void; errors: string[] }) {
  const patch = (i: number, change: Partial<PayBand>) => onChange(bands.map((b, j) => (j === i ? { ...b, ...change } : b)));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2/50 p-3">
      <p className="text-sm text-muted">A rate shows the label of the highest band it reaches.</p>
      <ul className="flex flex-col gap-1.5">
        {bands.map((b, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted">
              From ($/hr)
              <input
                type="number"
                min={0}
                max={LIMITS.maxPayRate}
                step={0.5}
                value={Number.isFinite(b.min) ? b.min : ''}
                onChange={(e) => patch(i, { min: e.target.valueAsNumber })}
                className="h-8 w-28 rounded-md border border-line-strong bg-surface px-2 text-sm font-normal tabular-nums text-fg"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs font-semibold text-muted">
              Label
              <input value={b.label} maxLength={8} onChange={(e) => patch(i, { label: e.target.value })} className="h-8 w-24 rounded-md border border-line-strong bg-surface px-2 font-display text-base font-bold text-fg" />
            </label>
            <IconButton label={`Remove band ${b.label || i + 1}`} size="sm" disabled={bands.length <= 1} onClick={() => onChange(bands.filter((_, j) => j !== i))}>
              <Trash2 />
            </IconButton>
          </li>
        ))}
      </ul>
      {errors.length > 0 ? (
        <ul role="alert" className="list-disc pl-5 text-sm font-medium text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button
          size="sm"
          icon={<Plus aria-hidden="true" className="size-4" />}
          disabled={bands.length >= 6}
          onClick={() => onChange([...bands, { min: (bands[bands.length - 1]?.min ?? 0) + 4, label: '$'.repeat(Math.min(8, bands.length + 1)) }])}
        >
          Add band
        </Button>
      </div>
    </div>
  );
}
