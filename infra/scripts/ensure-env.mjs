#!/usr/bin/env node
// azd preprovision hook. Checks the azd environment values that infra/main.parameters.json
// needs, and generates the wall HMAC secret once per environment so that later
// `azd provision` runs keep the same secret instead of rotating it.
//
// azd injects the current environment values as process environment variables.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const required = {
  TENANT_DOMAINS: 'Comma-separated tenant email domains, for example: azd env set TENANT_DOMAINS "contoso.com"',
  BOOTSTRAP_ADMIN_EMAILS: 'Comma-separated first admin emails, for example: azd env set BOOTSTRAP_ADMIN_EMAILS "it.admin@contoso.com"',
};

const missing = Object.entries(required).filter(([name]) => !process.env[name]?.trim());
if (missing.length > 0) {
  for (const [name, help] of missing) console.error(`Missing azd environment value ${name}. ${help}`);
  process.exit(1);
}

const MIN_SECRET_LENGTH = 32; // matches @minLength on wallHmacSecret in infra/main.bicep
const existing = process.env.AZURE_WALL_HMAC_SECRET?.trim() ?? '';

if (existing.length >= MIN_SECRET_LENGTH) {
  console.log('AZURE_WALL_HMAC_SECRET is already set for this environment; keeping it.');
} else if (existing) {
  console.error(`AZURE_WALL_HMAC_SECRET is shorter than ${MIN_SECRET_LENGTH} characters. Remove it (azd env set AZURE_WALL_HMAC_SECRET "") to generate a new one.`);
  process.exit(1);
} else {
  const secret = randomBytes(48).toString('base64url');
  execFileSync('azd', ['env', 'set', 'AZURE_WALL_HMAC_SECRET', secret], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('Generated AZURE_WALL_HMAC_SECRET for this environment (stored in .azure/<env>/.env, which Git ignores).');
}
