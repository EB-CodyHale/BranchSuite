import { WALL_CODE_DIGITS, WALL_CODE_LETTERS, WALL_COLORS, WALL_GLYPHS, zWallCode, type WallCode } from '@branchsuite/shared';
import { WallGlyph, WALL_COLOR_NAMES, wallCodeLabel } from '../../ui/WallGlyph.js';
import { Notice, RadioGrid } from './setupUi.js';

export interface OtherCode {
  name: string;
  wall: WallCode;
}

/** Blocking problems: bad format, or the code is already used by another account in the branch. */
export function wallCodeErrors(wall: WallCode, others: readonly OtherCode[]): string[] {
  const errors: string[] = [];
  if (!zWallCode.shape.code.safeParse(wall.code).success) errors.push('Codes are one letter + one digit (K7), two letters (KM), or two letters + a digit (KM7).');
  const clash = others.find((o) => o.wall.code === wall.code);
  if (clash) errors.push(`${wall.code} is already used by ${clash.name}. Each code is unique in the branch.`);
  return errors;
}

/** Characters that are hard to read at a distance (I/1, O/0, S/5, Z/2): allowed, but warned. */
export function hardToReadChars(code: string): string[] {
  return [...new Set([...code].filter((ch) => (/[A-Z]/.test(ch) ? !WALL_CODE_LETTERS.includes(ch) : /[0-9]/.test(ch) ? !WALL_CODE_DIGITS.includes(ch) : false)))];
}

export function WallCodeCard({ wall, onChange, others, accountName }: { wall: WallCode; onChange: (w: WallCode) => void; others: readonly OtherCode[]; accountName: string }) {
  const errors = wallCodeErrors(wall, others);
  const confusing = hardToReadChars(wall.code);
  const twin = others.find((o) => o.wall.color === wall.color && o.wall.glyph === wall.glyph);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-4 rounded-lg border border-line bg-paper px-4 py-5 sm:flex-row sm:items-center">
        <WallGlyph glyph={wall.glyph} color={wall.color} code={wall.code} size={112} />
        <div className="min-w-0 text-center sm:text-left">
          <p className="font-display text-5xl font-bold leading-none tracking-wide tabular-nums text-ink">{wall.code || '—'}</p>
          <p className="mt-1 text-sm capitalize text-muted">{wallCodeLabel(wall.glyph, wall.color)}</p>
          <p className="mt-2 max-w-sm text-sm text-muted">
            This is how <strong className="text-fg">{accountName}</strong> appears on the lobby wall. The public sees only the shape, color and code.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="wall-code-input" className="text-sm font-semibold">
          Code
        </label>
        <input
          id="wall-code-input"
          value={wall.code}
          maxLength={3}
          onChange={(e) => onChange({ ...wall, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) })}
          aria-invalid={errors.length > 0 || undefined}
          aria-describedby="wall-code-help"
          className="h-11 w-32 rounded-md border border-line-strong bg-surface px-3 font-display text-2xl font-bold tracking-widest"
        />
        <p id="wall-code-help" className="text-xs text-muted">
          Letters A-Z and digits. Best letters: {WALL_CODE_LETTERS}. Best digits: {WALL_CODE_DIGITS}.
        </p>
      </div>
      {errors.length > 0 ? (
        <Notice tone="danger" role="alert" title="This code cannot be saved">
          <ul className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {confusing.length > 0 ? (
        <Notice tone="warning" title="Hard to read from across the room">
          {confusing.join(', ')} can be mistaken for other characters at a distance.
        </Notice>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Color</span>
        <RadioGrid
          label="Wall color"
          value={wall.color}
          onChange={(color) => onChange({ ...wall, color })}
          className="grid-cols-2 min-[420px]:grid-cols-4"
          options={WALL_COLORS.map((c) => ({
            value: c.id,
            label: WALL_COLOR_NAMES[c.id],
            content: (
              <span className="flex w-full items-center gap-2 capitalize">
                <span aria-hidden="true" className="inline-block size-4 rounded-sm ring-1 ring-black/15" style={{ backgroundColor: c.hex }} />
                {WALL_COLOR_NAMES[c.id]}
              </span>
            ),
          }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Shape</span>
        <RadioGrid
          label="Wall shape"
          value={wall.glyph}
          onChange={(glyph) => onChange({ ...wall, glyph })}
          className="grid-cols-3 sm:grid-cols-6"
          options={WALL_GLYPHS.map((g) => ({
            value: g,
            label: g,
            content: (
              <span className="flex flex-col items-center gap-0.5 py-0.5 capitalize">
                <WallGlyph glyph={g} color={wall.color} size={26} label={null} />
                <span className="text-xs">{g}</span>
              </span>
            ),
          }))}
        />
      </div>
      {twin ? (
        <Notice tone="info" title="Same shape and color as another account">
          {twin.name} is also a {wallCodeLabel(wall.glyph, wall.color)}. The codes still differ, but a distinct pair is easier to spot.
        </Notice>
      ) : null}
    </div>
  );
}
