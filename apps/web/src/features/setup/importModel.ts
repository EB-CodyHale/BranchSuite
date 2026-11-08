/** Parse pasted account lists (JSON or CSV) into AccountImportInput rows, with line-level errors. */
import { zAccountImportInput, type AccountImportInput } from '@branchsuite/shared';

export type ImportRow = AccountImportInput['accounts'][number];
export type ImportFormat = 'csv' | 'json';

export interface ParsedImport {
  rows: ImportRow[];
  errors: string[];
}

/** RFC 4180-style line split: commas, double-quoted fields, "" escapes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const COLUMNS = ['name', 'accountNumber', 'sourceId'] as const;

function cleanRow(raw: { name?: unknown; accountNumber?: unknown; sourceId?: unknown }): ImportRow {
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
  const row: ImportRow = { name: str(raw.name) };
  const accountNumber = str(raw.accountNumber);
  const sourceId = str(raw.sourceId);
  if (accountNumber) row.accountNumber = accountNumber;
  if (sourceId) row.sourceId = sourceId;
  return row;
}

export function parseCsv(text: string): ParsedImport {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l, i) => ({ text: l, no: i + 1 })).filter((l) => l.text.trim() !== '');
  if (lines.length === 0) return { rows: [], errors: ['Paste at least one line.'] };
  let order: readonly string[] = COLUMNS;
  const header = splitCsvLine(lines[0]!.text).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  if (header.includes('name')) {
    order = header.map((h) => COLUMNS.find((c) => c.toLowerCase() === h) ?? h);
    lines.shift();
  }
  const rows: ImportRow[] = [];
  for (const line of lines) {
    const cells = splitCsvLine(line.text);
    const raw: Record<string, string> = {};
    order.forEach((col, i) => (raw[col] = cells[i] ?? ''));
    const row = cleanRow(raw);
    if (!row.name) errors.push(`Line ${line.no}: the name is empty.`);
    else rows.push(row);
  }
  return { rows, errors };
}

export function parseJson(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { rows: [], errors: ['This is not valid JSON. Check for a missing comma or quote.'] };
  }
  const list = Array.isArray(data) ? data : typeof data === 'object' && data !== null && Array.isArray((data as { accounts?: unknown }).accounts) ? (data as { accounts: unknown[] }).accounts : null;
  if (!list) return { rows: [], errors: ['Use an array of objects: [{"name": "…", "accountNumber": "…", "sourceId": "…"}].'] };
  const errors: string[] = [];
  const rows: ImportRow[] = [];
  list.forEach((item, i) => {
    if (typeof item !== 'object' || item === null) {
      errors.push(`Item ${i + 1}: not an object.`);
      return;
    }
    const row = cleanRow(item as Record<string, unknown>);
    if (!row.name) errors.push(`Item ${i + 1}: the name is empty.`);
    else rows.push(row);
  });
  return { rows, errors };
}

/** Parse, then check against the shared schema (lengths, 1-1000 rows). */
export function parseImport(text: string, format: ImportFormat): ParsedImport {
  const parsed = format === 'csv' ? parseCsv(text) : parseJson(text);
  if (parsed.errors.length > 0 || parsed.rows.length === 0) return parsed.rows.length === 0 && parsed.errors.length === 0 ? { rows: [], errors: ['Nothing to import.'] } : parsed;
  const check = zAccountImportInput.safeParse({ apply: false, accounts: parsed.rows });
  if (!check.success) {
    const errors = check.error.issues.slice(0, 10).map((issue) => {
      const [, index, field] = issue.path;
      return typeof index === 'number' ? `Row ${index + 1}${field ? ` (${String(field)})` : ''}: ${issue.message}` : issue.message;
    });
    return { rows: parsed.rows, errors };
  }
  return parsed;
}
