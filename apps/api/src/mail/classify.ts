/**
 * Message classification (ARCHITECTURE §7 step 7, §8).
 *
 * One model call per message. Output is requested as strict JSON schema structured output, then
 * validated again with zod (and clamped to storage limits) before anything is written. Invalid output
 * or an API failure is retried once; after that a conservative fallback is used so mail is never lost:
 * triage -> actionable task titled with the subject, follow-up -> no change, reply -> does not resolve.
 *
 * AI_MODE=mock uses a deterministic keyword classifier (dev and tests) and never calls the network.
 */
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import {
  LIMITS,
  ROLE_CATEGORY_IDS,
  TASK_CATEGORY_IDS,
  TASK_PRIORITIES,
  inferCategory,
  isDayKey,
  type RoleCategory,
  type StaffingRequest,
  type TaskCategory,
  type TaskPriority,
} from '@branchsuite/shared';
import { AzureOpenAI } from 'openai';
import { z } from 'zod';
import type { Logger } from '../log.js';
import { buildUserPrompt, JSON_SCHEMAS, SYSTEM_PROMPTS, type ClassifyMode, type PromptInput } from './prompts.js';

export const DEFAULT_OPENAI_API_VERSION = '2024-10-21';
export const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';

/** Staffing request as extracted by the model (blockedReason is decided by ingest, not the model). */
export type ExtractedStaffingRequest = Omit<StaffingRequest, 'blockedReason'>;

export interface TriageResult {
  actionable: boolean;
  reason: string;
  title: string;
  summary: string;
  category: TaskCategory;
  priority: TaskPriority;
  deadline: string | null;
  staffingRequest: ExtractedStaffingRequest | null;
  accountHint: string | null;
}

export interface FollowupResult {
  escalate: boolean;
  priority: TaskPriority;
  summaryUpdate: string;
  deadline: string | null;
  resolved: false;
}

export interface ReplyResult {
  resolves: boolean;
  reason: string;
}

export interface Classification<T> {
  result: T;
  /** 'model' (validated output), 'mock' (heuristic) or 'fallback' (model failed twice). */
  source: 'model' | 'mock' | 'fallback';
}

export interface Classifier {
  triage(input: PromptInput): Promise<Classification<TriageResult>>;
  followup(input: PromptInput): Promise<Classification<FollowupResult>>;
  reply(input: PromptInput): Promise<Classification<ReplyResult>>;
}

// ---------- validation (clamps instead of failing on over-long text) ----------
const clampText = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const isoOrNull = z
  .string()
  .nullable()
  .transform((v) => (v && z.iso.datetime({ offset: true }).safeParse(v).success ? v : null));
const dayOrNull = z
  .string()
  .nullable()
  .transform((v) => (v && isDayKey(v) ? v : null));

export const zExtractedStaffingRequest = z.object({
  role: clampText(LIMITS.maxShortText),
  roleCategory: z.enum(ROLE_CATEGORY_IDS).catch('other'),
  headcount: z
    .number()
    .nullable()
    .transform((n) => (n !== null && Number.isInteger(n) && n >= 1 && n <= LIMITS.maxOpeningsPerOrder ? n : null)),
  headcountText: clampText(100),
  shift: clampText(LIMITS.maxShiftText),
  days: clampText(LIMITS.maxShortText),
  hours: clampText(LIMITS.maxShortText),
  payRate: z
    .number()
    .nullable()
    .transform((n) => (n !== null && Number.isFinite(n) && n > 0 && n <= LIMITS.maxPayRate ? n : null)),
  startDate: dayOrNull,
  site: clampText(LIMITS.maxShortText),
  notes: clampText(LIMITS.maxNote),
});

export const zTriageResult = z.object({
  actionable: z.boolean(),
  reason: clampText(300),
  title: clampText(120),
  summary: clampText(600),
  category: z.enum(TASK_CATEGORY_IDS),
  priority: z.enum(TASK_PRIORITIES),
  deadline: isoOrNull,
  staffingRequest: zExtractedStaffingRequest.nullable(),
  accountHint: z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim().slice(0, 120) : null)),
});

export const zFollowupResult = z.object({
  escalate: z.boolean(),
  priority: z.enum(TASK_PRIORITIES),
  summaryUpdate: clampText(600),
  deadline: isoOrNull,
  // Inbound mail never resolves a task, whatever the model says.
  resolved: z.boolean().transform(() => false as const),
});

export const zReplyResult = z.object({ resolves: z.boolean(), reason: clampText(300) });

// ---------- fallbacks ----------
export function fallbackTriage(input: PromptInput): TriageResult {
  const subject = input.email.subject.trim();
  return {
    actionable: true,
    reason: 'Automatic triage was unavailable; kept for review.',
    title: (subject || '(no subject)').slice(0, 120),
    summary: input.email.body.replace(/\s+/g, ' ').trim().slice(0, 600),
    category: inferCategory(`${input.email.subject}\n${input.email.body}`),
    priority: 'normal',
    deadline: null,
    staffingRequest: null,
    accountHint: null,
  };
}

export function fallbackFollowup(input: PromptInput): FollowupResult {
  const current = input.task?.priority;
  const priority: TaskPriority = current === 'hot' || current === 'low' ? current : 'normal';
  return { escalate: false, priority, summaryUpdate: '', deadline: null, resolved: false };
}

export function fallbackReply(): ReplyResult {
  return { resolves: false, reason: 'Automatic review was unavailable; task left open.' };
}

// ---------- model-backed classifier ----------
/** One structured-output completion. Returns the raw JSON text. */
export interface ModelCaller {
  complete(request: { system: string; user: string; schemaName: string; schema: Record<string, unknown> }): Promise<string>;
}

export class ModelClassifier implements Classifier {
  constructor(
    private readonly model: ModelCaller,
    private readonly log: Logger,
  ) {}

  triage(input: PromptInput) {
    return this.run('triage', input, zTriageResult, () => fallbackTriage(input));
  }
  followup(input: PromptInput) {
    return this.run('followup', input, zFollowupResult, () => fallbackFollowup(input));
  }
  reply(input: PromptInput) {
    return this.run('reply', input, zReplyResult, () => fallbackReply());
  }

  private async run<T>(mode: ClassifyMode, input: PromptInput, schema: z.ZodType<T>, fallback: () => T): Promise<Classification<T>> {
    const { name, schema: jsonSchema } = JSON_SCHEMAS[mode];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await this.model.complete({ system: SYSTEM_PROMPTS[mode], user: buildUserPrompt(mode, input), schemaName: name, schema: jsonSchema });
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) return { result: parsed.data, source: 'model' };
        // Never log the content: only which fields failed.
        this.log.warn('Mail classifier returned invalid output', { mode, attempt, fields: parsed.error.issues.map((i) => i.path.join('.')).slice(0, 10) });
      } catch (err) {
        this.log.warn('Mail classifier call failed', { mode, attempt, error: err instanceof Error ? err.name : 'unknown' });
      }
    }
    this.log.error('Mail classifier fell back to the conservative result', { mode });
    return { result: fallback(), source: 'fallback' };
  }
}

export interface AzureModelOptions {
  endpoint: string;
  deployment: string;
  apiVersion?: string;
}

/** Azure OpenAI with managed identity (no keys). */
export class AzureOpenAiCaller implements ModelCaller {
  private readonly client: AzureOpenAI;

  constructor(private readonly options: AzureModelOptions) {
    this.client = new AzureOpenAI({
      endpoint: options.endpoint,
      deployment: options.deployment,
      apiVersion: options.apiVersion ?? DEFAULT_OPENAI_API_VERSION,
      azureADTokenProvider: getBearerTokenProvider(new DefaultAzureCredential(), COGNITIVE_SCOPE),
      maxRetries: 2,
      timeout: 60_000,
    });
  }

  async complete(request: { system: string; user: string; schemaName: string; schema: Record<string, unknown> }): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.options.deployment,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
      max_completion_tokens: 1200,
    });
    const choice = res.choices[0];
    if (!choice?.message?.content) throw new Error(`Empty completion (${choice?.finish_reason ?? 'no choice'})`);
    return choice.message.content;
  }
}

// ---------- deterministic mock (AI_MODE=mock) ----------
const NOT_ACTIONABLE = /\b(newsletter|unsubscribe|no action (is )?(needed|required)|just fyi|for your information only|webinar)\b/i;
const THANKS_ONLY = /^\s*(thanks|thank you|thx|much appreciated|appreciate it)[\s!.,]*([a-z]+[\s!.,]*)?$/i;
const HOT = /\b(urgent|asap|immediately|right away|emergency|today|tonight|no[- ]shows?|call(ed)?[- ]?offs?|short (tonight|today)|safety|injur(y|ed))\b/i;
const LOW = /\b(fyi|no rush|when you get a chance|whenever you can|low priority)\b/i;
const RESOLVES = /\b(confirmed|all set|taken care of|done|filled|covered|scheduled|sent (it|them|the)|attached|resolved|fixed|will be there|corrected)\b/i;
const NOT_RESOLVED = /\b(will (check|look|get back)|looking into|on it|checking|working on)\b|\?\s*$/i;

const ROLE_KEYWORDS: Array<[RegExp, RoleCategory]> = [
  [/\breach\b|stand[- ]?up/i, 'reach'],
  [/forklift|fork lift|sit[- ]?down/i, 'forklift'],
  [/order pick|picker|selector/i, 'order_picker'],
  [/machine op|operator/i, 'machine_operator'],
  [/production|assembl|line (worker|lead)/i, 'production'],
  [/clerical|office|receptionist|admin(istrative)? assistant|data entry/i, 'clerical'],
  [/driver|cdl/i, 'driver'],
  [/maintenance|mechanic|electrician|welder/i, 'maintenance'],
  [/general lab|laborer|packer|loader|warehouse associate|sanitation/i, 'general_labor'],
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const WORKER = String.raw`(?:more\s+|additional\s+|extra\s+)?([a-z][a-z/ -]{1,40}?)(?:s)?\b`;
const COUNT_RE = new RegExp(String.raw`\b(?:need|needs|needing|request(?:ing)?|looking for|send(?: us)?|add)\s+(\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})\s+${WORKER}`, 'i');
const RANGE_RE = /\b(\d{1,3})\s*(?:-|–|to|or)\s*(\d{1,3})\s+(?:more\s+)?[a-z]/i;
const VAGUE_RE = /\b(a few|several|some|a couple( of)?|a handful of)\s+(more\s+)?(people|workers|associates|pickers|drivers|operators|temps|laborers|hands)\b/i;
const PAY_RE = /\$\s?(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/\s*h(?:ou)?r|per\s+hour|an\s+hour|\/hr|hr)\b/i;
const SHIFT_RE = /\b(1st|2nd|3rd|first|second|third|weekend|night|day)\s+shift\b/i;

function roleCategoryOf(text: string): RoleCategory {
  return ROLE_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? 'other';
}

/** Keyword extraction of a staffing request. Exact headcount only when a single number is stated. */
export function mockStaffingRequest(text: string): ExtractedStaffingRequest | null {
  const count = COUNT_RE.exec(text);
  const range = RANGE_RE.exec(text);
  const vague = VAGUE_RE.exec(text);
  if (!count && !range && !vague) return null;
  let headcount: number | null = null;
  let headcountText = '';
  let role = '';
  if (range) {
    headcountText = range[0].replace(/\s+[a-z]$/i, '').trim();
  } else if (count) {
    const raw = (count[1] ?? '').toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? null);
    const distinctNumbers = new Set([...text.matchAll(/\b(?:need|needs|request(?:ing)?|looking for)\s+(\d{1,3})\b/gi)].map((m) => m[1]));
    headcount = n !== null && n >= 1 && n <= LIMITS.maxOpeningsPerOrder && distinctNumbers.size <= 1 ? n : null;
    headcountText = raw;
    role = (count[2] ?? '').trim();
  } else if (vague) {
    headcountText = vague[0];
  }
  const shift = SHIFT_RE.exec(text);
  const pay = PAY_RE.exec(text);
  return {
    role: role ? role.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, LIMITS.maxShortText) : '',
    roleCategory: roleCategoryOf(text),
    headcount,
    headcountText: headcountText.slice(0, 100),
    shift: shift ? (shift[1] ?? '').replace(/^first$/i, '1st').replace(/^second$/i, '2nd').replace(/^third$/i, '3rd') : '',
    days: '',
    hours: '',
    payRate: pay ? Number(pay[1]) : null,
    startDate: null,
    site: '',
    notes: '',
  };
}

export class MockClassifier implements Classifier {
  async triage(input: PromptInput): Promise<Classification<TriageResult>> {
    const { subject, body } = input.email;
    const text = `${subject}\n${body}`;
    const actionable = !(NOT_ACTIONABLE.test(text) || (THANKS_ONLY.test(body.trim()) && !/\?/.test(text)));
    const staffingRequest = actionable ? mockStaffingRequest(text) : null;
    return {
      source: 'mock',
      result: {
        actionable,
        reason: actionable ? 'Request or question for the branch' : 'No request in the message',
        title: (subject.trim() || body.trim().split('\n')[0] || '(no subject)').slice(0, 120),
        summary: body.replace(/\s+/g, ' ').trim().slice(0, 600),
        category: staffingRequest ? 'client' : inferCategory(text),
        priority: HOT.test(text) ? 'hot' : LOW.test(text) ? 'low' : 'normal',
        deadline: null,
        staffingRequest,
        accountHint: null,
      },
    };
  }

  async followup(input: PromptInput): Promise<Classification<FollowupResult>> {
    const text = `${input.email.subject}\n${input.email.body}`;
    const escalate = HOT.test(text);
    const base = fallbackFollowup(input);
    return {
      source: 'mock',
      result: {
        escalate,
        priority: escalate ? 'hot' : base.priority,
        summaryUpdate: escalate ? `Follow-up: ${input.email.body.replace(/\s+/g, ' ').trim()}`.slice(0, 600) : '',
        deadline: null,
        resolved: false,
      },
    };
  }

  async reply(input: PromptInput): Promise<Classification<ReplyResult>> {
    const body = input.email.body.trim();
    const resolves = RESOLVES.test(body) && !NOT_RESOLVED.test(body);
    return { source: 'mock', result: { resolves, reason: resolves ? 'Team reply confirms the request is handled' : 'Team reply does not complete the request' } };
  }
}
