import { zTimeZone } from '@branchsuite/shared';
import { useId, useState } from 'react';
import { cx } from '../../ui/cx.js';

/** Common US zones first; anything else is typed as an IANA name and validated. */
export const US_TIME_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'America/New_York', label: 'Eastern (New York)' },
  { id: 'America/Detroit', label: 'Eastern (Detroit)' },
  { id: 'America/Indiana/Indianapolis', label: 'Eastern (Indianapolis)' },
  { id: 'America/Chicago', label: 'Central (Chicago)' },
  { id: 'America/Denver', label: 'Mountain (Denver)' },
  { id: 'America/Phoenix', label: 'Mountain, no DST (Phoenix)' },
  { id: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { id: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { id: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { id: 'America/Puerto_Rico', label: 'Atlantic (Puerto Rico)' },
];

const OTHER = '__other__';

export function timeZoneError(tz: string): string | null {
  if (!tz.trim()) return 'Enter a time zone.';
  return zTimeZone.safeParse(tz.trim()).success ? null : `"${tz}" is not a known IANA time zone (example: America/Chicago).`;
}

export function TimeZoneField({ value, onChange, disabled, error }: { value: string; onChange: (tz: string) => void; disabled?: boolean; error?: string | null }) {
  const id = useId();
  const known = US_TIME_ZONES.some((z) => z.id === value);
  const [other, setOther] = useState(!known);
  const showOther = other || !known;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        Time zone
      </label>
      <select
        id={id}
        value={showOther ? OTHER : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOther(true);
            return;
          }
          setOther(false);
          onChange(e.target.value);
        }}
        className="h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[0.9375rem] disabled:opacity-60"
      >
        {US_TIME_ZONES.map((z) => (
          <option key={z.id} value={z.id}>
            {z.label}
          </option>
        ))}
        <option value={OTHER}>Other (type an IANA name)…</option>
      </select>
      {showOther ? (
        <>
          <label htmlFor={`${id}-iana`} className="sr-only">
            IANA time zone name
          </label>
          <input
            id={`${id}-iana`}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. America/Boise"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-e` : `${id}-h`}
            className={cx('h-9 w-full rounded-md border bg-surface px-2.5 font-mono text-sm', error ? 'border-danger' : 'border-line-strong')}
          />
        </>
      ) : null}
      {error ? (
        <p id={`${id}-e`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : (
        <p id={`${id}-h`} className="text-xs text-muted">
          Sets the branch's business day: "today", start dates and midnight rollover.
        </p>
      )}
    </div>
  );
}
