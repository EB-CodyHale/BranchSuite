import type { AccountLite, PersonLite } from '@branchsuite/shared';
import { Columns3, List, Search, X } from 'lucide-react';
import { Button } from '../../ui/Button.js';
import { Checkbox, Select, TextField } from '../../ui/Field.js';
import { Segmented } from '../../ui/Segmented.js';
import { isFiltered, type PipelineFilters } from './pipelineModel.js';

export type PipelineView = 'board' | 'list';

export interface PipelineToolbarProps {
  filters: PipelineFilters;
  onChange: (patch: Partial<PipelineFilters>) => void;
  onClear: () => void;
  recruiters: PersonLite[];
  accounts: AccountLite[];
  viewerId: string;
  view: PipelineView;
  onView: (view: PipelineView) => void;
}

const VIEW_OPTIONS = [
  { value: 'board' as const, label: 'Board', icon: <Columns3 /> },
  { value: 'list' as const, label: 'List', icon: <List /> },
];

export function PipelineToolbar({ filters, onChange, onClear, recruiters, accounts, viewerId, view, onView }: PipelineToolbarProps) {
  const recruiterOptions = [
    { value: 'mine', label: 'My candidates' },
    { value: 'all', label: 'Everyone' },
    ...recruiters.filter((p) => p.id !== viewerId).map((p) => ({ value: p.id, label: p.name })),
  ];
  if (!recruiterOptions.some((o) => o.value === filters.recruiter)) recruiterOptions.push({ value: filters.recruiter, label: 'Former teammate' });
  const accountOptions = [
    { value: 'all', label: 'All accounts' },
    { value: 'none', label: 'No account yet' },
    ...accounts.map((a) => ({ value: a.id, label: a.name })),
  ];
  if (!accountOptions.some((o) => o.value === filters.account)) accountOptions.push({ value: filters.account, label: 'Inactive account' });

  return (
    <div role="search" aria-label="Filter candidates" className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="relative w-full sm:w-64">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-subtle" />
        <TextField
          label="Search candidates"
          hideLabel
          type="search"
          placeholder="Search name, phone, email"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          inputClassName="pl-8"
        />
      </div>
      <Select label="Recruiter" hideLabel value={filters.recruiter} options={recruiterOptions} onChange={(e) => onChange({ recruiter: e.target.value })} className="min-w-0 flex-1 basis-32 sm:basis-auto sm:w-48 sm:flex-none" />
      <Select label="Account" hideLabel value={filters.account} options={accountOptions} onChange={(e) => onChange({ account: e.target.value })} className="min-w-0 flex-1 basis-32 sm:basis-auto sm:w-52 sm:flex-none" />
      <Checkbox label="Show archived" checked={filters.showArchived} onChange={(e) => onChange({ showArchived: e.target.checked })} className="h-9 items-center" />
      {isFiltered(filters) ? (
        <Button size="sm" variant="ghost" icon={<X aria-hidden="true" className="size-4" />} onClick={onClear} className="h-9">
          Clear filters
        </Button>
      ) : null}
      <Segmented label="View" options={VIEW_OPTIONS} value={view} onChange={onView} className="ml-auto" />
    </div>
  );
}
