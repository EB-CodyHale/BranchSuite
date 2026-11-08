import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Validate input with a zod schema; failures become 400 bad_request with the zod issues as details. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      'Invalid request.',
      result.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message, code: i.code })),
    );
  }
  return result.data;
}

/**
 * Validate a PATCH body and keep only the keys the client actually sent.
 * zod 4 applies `.default()` values even inside `.partial()` objects, so a plain parse would
 * silently reset omitted fields to their defaults on merge. Nested plain objects are filtered
 * the same way (e.g. `wall`, `settings`, `preferences`).
 */
export function parsePatch<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = parse(schema, value ?? {});
  return onlyPresent(parsed, value) as z.output<S>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function onlyPresent(parsed: unknown, raw: unknown): unknown {
  if (!isPlainObject(parsed) || !isPlainObject(raw)) return parsed;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    out[key] = onlyPresent(val, raw[key]);
  }
  return out;
}

/** Comma-separated id list from a query parameter; empty entries dropped, duplicates removed. */
export function idList(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
}
