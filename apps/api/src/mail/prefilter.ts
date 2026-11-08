/**
 * Deterministic prefilter (ARCHITECTURE §7 step 2): drops automatic mail before any model call.
 * Returns the reason a message is filtered, or null when it should continue through the pipeline.
 */

export interface PrefilterInput {
  fromAddress: string;
  subject: string;
  /** Sanitized body text. */
  body: string;
  headers: Array<{ name: string; value: string }>;
}

export interface PrefilterResult {
  reason: string;
}

const AUTO_SUBJECT_PREFIXES = [
  'automatic reply',
  'auto:',
  'autoreply',
  'auto reply',
  'auto-reply',
  'out of office',
  'out of the office',
  'undeliverable',
  'undelivered mail',
  'delivery status notification',
  'delivery has failed',
  'mail delivery failed',
  'mail delivery subsystem',
  'returned mail',
];

/** Local parts of senders that never write to a person. */
const NO_REPLY_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]daemon|postmaster|bounces?)([-_.+].*)?$/i;

function header(headers: PrefilterInput['headers'], name: string): string | null {
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found ? found.value.trim() : null;
}

export function prefilter(input: PrefilterInput): PrefilterResult | null {
  const autoSubmitted = header(input.headers, 'Auto-Submitted');
  if (autoSubmitted !== null && autoSubmitted.toLowerCase() !== 'no') {
    return { reason: `Automatic message (Auto-Submitted: ${autoSubmitted.slice(0, 40)})` };
  }
  const suppress = header(input.headers, 'X-Auto-Response-Suppress');
  if (suppress) return { reason: `Automatic message (X-Auto-Response-Suppress: ${suppress.slice(0, 40)})` };
  const precedence = header(input.headers, 'Precedence');
  if (precedence !== null && /^(bulk|junk|auto_reply)$/i.test(precedence)) {
    return { reason: `Bulk mail (Precedence: ${precedence.slice(0, 20)})` };
  }

  const subject = input.subject.trim().toLowerCase();
  const prefix = AUTO_SUBJECT_PREFIXES.find((p) => subject.startsWith(p));
  if (prefix) return { reason: `Auto-reply or delivery notice (subject starts with "${prefix}")` };

  const address = input.fromAddress.trim().toLowerCase();
  const local = address.includes('@') ? address.slice(0, address.lastIndexOf('@')) : address;
  if (local && NO_REPLY_LOCAL.test(local)) return { reason: 'No-reply or system sender' };

  if (input.subject.trim() === '' && input.body.trim() === '') return { reason: 'Empty message' };
  return null;
}
