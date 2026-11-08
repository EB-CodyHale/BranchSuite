/**
 * Typed configuration from environment variables. Parsed once at startup; invalid
 * configuration throws so a misconfigured deployment fails fast instead of serving requests.
 */
import { z } from 'zod';

export interface Config {
  version: string;
  dataMode: 'memory' | 'cosmos';
  cosmosEndpoint: string | null;
  cosmosDatabase: string;
  /** MemoryRepo JSON persistence file (dev only). */
  devDataFile: string | null;
  authMode: 'swa' | 'dev';
  aiMode: 'azure' | 'mock';
  azureOpenAiEndpoint: string | null;
  azureOpenAiDeployment: string | null;
  webPubSubEndpoint: string | null;
  webPubSubHub: string;
  /** Exactly one source for the wall HMAC secret. */
  wallSecret: { kind: 'env'; value: string } | { kind: 'keyvault'; vaultUri: string; secretName: string };
  bootstrapAdminEmails: string[];
  /** Tenant email domains, treated as internal senders by mail intake. */
  tenantDomains: string[];
  features: { pipeline: boolean; personalMail: boolean };
  mailAccessHelp: string;
}

export const WALL_SECRET_NAME = 'wall-hmac-secret';
const DEFAULT_MAIL_ACCESS_HELP =
  'Your mailbox is not approved for BranchSuite mail intake yet. Ask a BranchSuite admin to add it to the mailbox access group.';

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().url().nullable());
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));
const commaList = z
  .string()
  .optional()
  .transform((v) => [...new Set((v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))]);
const bool = (fallback: boolean) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return fallback;
      if (['true', '1', 'yes', 'on'].includes(v)) return true;
      if (['false', '0', 'no', 'off'].includes(v)) return false;
      ctx.addIssue({ code: 'custom', message: `Expected a boolean, got "${v}"` });
      return z.NEVER;
    });

const zEnv = z.object({
  DATA_MODE: z.enum(['memory', 'cosmos']).default('cosmos'),
  COSMOS_ENDPOINT: optionalUrl,
  COSMOS_DATABASE: z.string().trim().min(1).default('branchsuite'),
  DEV_DATA_FILE: optionalText,
  AUTH_MODE: z.enum(['swa', 'dev']).default('swa'),
  AI_MODE: z.enum(['azure', 'mock']).default('azure'),
  AZURE_OPENAI_ENDPOINT: optionalUrl,
  AZURE_OPENAI_DEPLOYMENT: optionalText,
  WEB_PUBSUB_ENDPOINT: optionalUrl,
  WEB_PUBSUB_HUB: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/).default('branchsuite'),
  WALL_HMAC_SECRET: optionalText,
  KEY_VAULT_URI: optionalUrl,
  BOOTSTRAP_ADMIN_EMAILS: commaList,
  TENANT_DOMAINS: commaList,
  FEATURE_PIPELINE: bool(true),
  FEATURE_PERSONAL_MAIL: bool(true),
  MAIL_ACCESS_HELP: optionalText,
  APP_VERSION: optionalText,
  BUNDLED_APP_VERSION: optionalText,
  WEBSITE_SITE_NAME: optionalText,
  WEBSITE_INSTANCE_ID: optionalText,
});

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** True when the process runs on Azure App Service / Functions infrastructure. */
export function isRunningInAzure(env: Record<string, string | undefined>): boolean {
  return Boolean(env.WEBSITE_SITE_NAME?.trim() || env.WEBSITE_INSTANCE_ID?.trim());
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = zEnv.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;

  if (e.AUTH_MODE === 'dev' && isRunningInAzure(env)) {
    throw new ConfigError('AUTH_MODE=dev is refused when running in Azure (WEBSITE_SITE_NAME or WEBSITE_INSTANCE_ID is set).');
  }
  if (e.DATA_MODE === 'cosmos' && !e.COSMOS_ENDPOINT) {
    throw new ConfigError('DATA_MODE=cosmos requires COSMOS_ENDPOINT.');
  }
  if (e.AI_MODE === 'azure' && (!e.AZURE_OPENAI_ENDPOINT || !e.AZURE_OPENAI_DEPLOYMENT)) {
    throw new ConfigError('AI_MODE=azure requires AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT.');
  }
  if (e.WALL_HMAC_SECRET && e.KEY_VAULT_URI) {
    throw new ConfigError('Set either WALL_HMAC_SECRET or KEY_VAULT_URI, not both.');
  }
  if (e.WALL_HMAC_SECRET && e.WALL_HMAC_SECRET.length < 32) {
    throw new ConfigError('WALL_HMAC_SECRET must be at least 32 characters.');
  }
  let wallSecret: Config['wallSecret'];
  if (e.WALL_HMAC_SECRET) wallSecret = { kind: 'env', value: e.WALL_HMAC_SECRET };
  else if (e.KEY_VAULT_URI) wallSecret = { kind: 'keyvault', vaultUri: e.KEY_VAULT_URI, secretName: WALL_SECRET_NAME };
  else throw new ConfigError('Set WALL_HMAC_SECRET or KEY_VAULT_URI for wall keys and display pairing.');

  return {
    version: e.APP_VERSION ?? e.BUNDLED_APP_VERSION ?? '2.0.0',
    dataMode: e.DATA_MODE,
    cosmosEndpoint: e.COSMOS_ENDPOINT,
    cosmosDatabase: e.COSMOS_DATABASE,
    devDataFile: e.DEV_DATA_FILE,
    authMode: e.AUTH_MODE,
    aiMode: e.AI_MODE,
    azureOpenAiEndpoint: e.AZURE_OPENAI_ENDPOINT,
    azureOpenAiDeployment: e.AZURE_OPENAI_DEPLOYMENT,
    webPubSubEndpoint: e.WEB_PUBSUB_ENDPOINT,
    webPubSubHub: e.WEB_PUBSUB_HUB,
    wallSecret,
    bootstrapAdminEmails: e.BOOTSTRAP_ADMIN_EMAILS,
    tenantDomains: e.TENANT_DOMAINS,
    features: { pipeline: e.FEATURE_PIPELINE, personalMail: e.FEATURE_PERSONAL_MAIL },
    mailAccessHelp: e.MAIL_ACCESS_HELP ?? DEFAULT_MAIL_ACCESS_HELP,
  };
}
