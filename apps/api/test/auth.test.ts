import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { parseClientPrincipal } from '../src/auth/principal.js';
import { createTestApp, TEST_SECRET } from './helpers.js';

const OID_CLAIM = 'http://schemas.microsoft.com/identity/claims/objectidentifier';

function principal(email: string, oid: string | null, overrides: Record<string, unknown> = {}): Record<string, string> {
  const claims = [{ typ: 'preferred_username', val: email }, ...(oid ? [{ typ: OID_CLAIM, val: oid }] : [])];
  const body = { identityProvider: 'aad', userId: 'swa-user', userDetails: email, userRoles: ['anonymous', 'authenticated'], claims, ...overrides };
  return { 'x-ms-client-principal': Buffer.from(JSON.stringify(body)).toString('base64') };
}

describe('configuration', () => {
  const base = { DATA_MODE: 'memory', AI_MODE: 'mock', WALL_HMAC_SECRET: TEST_SECRET };

  it('refuses dev auth when running in Azure', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'dev', WEBSITE_SITE_NAME: 'func-branchsuite' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, AUTH_MODE: 'dev', WEBSITE_INSTANCE_ID: 'abc123' })).toThrow(ConfigError);
    expect(loadConfig({ ...base, AUTH_MODE: 'swa', WEBSITE_SITE_NAME: 'func-branchsuite' }).authMode).toBe('swa');
  });

  it('defaults to SWA auth and parses lists and flags', () => {
    const config = loadConfig({ ...base, BOOTSTRAP_ADMIN_EMAILS: ' Avery@Example.com, ,b@example.com', FEATURE_PIPELINE: 'off' });
    expect(config.authMode).toBe('swa');
    expect(config.bootstrapAdminEmails).toEqual(['avery@example.com', 'b@example.com']);
    expect(config.features).toEqual({ pipeline: false, personalMail: true });
    expect(config.cosmosDatabase).toBe('branchsuite');
    expect(config.webPubSubHub).toBe('branchsuite');
  });

  it('requires a wall secret source', () => {
    expect(() => loadConfig({ DATA_MODE: 'memory', AI_MODE: 'mock' })).toThrow(/WALL_HMAC_SECRET or KEY_VAULT_URI/);
    expect(loadConfig({ DATA_MODE: 'memory', AI_MODE: 'mock', KEY_VAULT_URI: 'https://kv-test.vault.azure.net/' }).wallSecret).toEqual({
      kind: 'keyvault',
      vaultUri: 'https://kv-test.vault.azure.net/',
      secretName: 'wall-hmac-secret',
    });
  });
});

describe('SWA principal parsing', () => {
  it('requires the aad provider and the authenticated role', () => {
    expect(parseClientPrincipal(undefined)).toBeNull();
    expect(() => parseClientPrincipal(principal('a@example.com', 'o1', { identityProvider: 'github' })['x-ms-client-principal'])).toThrow();
    expect(() => parseClientPrincipal(principal('a@example.com', 'o1', { userRoles: ['anonymous'] })['x-ms-client-principal'])).toThrow();
    expect(() => parseClientPrincipal('not base64 json')).toThrow();
    expect(parseClientPrincipal(principal('A.Person@Example.com', 'o1')['x-ms-client-principal'])).toEqual({ oid: 'o1', email: 'a.person@example.com' });
  });
});

describe('staff sign-in (AUTH_MODE=swa)', () => {
  it('ignores the dev header outside dev mode', async () => {
    const app = await createTestApp({ AUTH_MODE: 'swa' });
    expect((await app.call('GET', '/me', { as: 'usr_casey' })).status).toBe(401);
    expect((await app.call('GET', '/dev/users')).status).toBe(404);
  });

  it('binds the Entra oid on first sign-in and refuses a different oid later', async () => {
    const app = await createTestApp({ AUTH_MODE: 'swa' });
    const email = 'casey@branchsuite.example.com';
    const first = await app.call('GET', '/me', { headers: principal(email, 'oid-casey') });
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({ id: 'usr_casey', entraOid: 'oid-casey' });
    expect(first.body.permissions).toMatchObject({ isAdmin: false, manageBranchIds: [] });

    expect((await app.call('GET', '/me', { headers: principal(email, 'oid-casey') })).status).toBe(200);
    const imposter = await app.call('GET', '/me', { headers: principal(email, 'oid-someone-else') });
    expect(imposter.status).toBe(403);
    expect(imposter.body.error.code).toBe('not_provisioned');
  });

  it('refuses tenant users without a roster record', async () => {
    const app = await createTestApp({ AUTH_MODE: 'swa' });
    const res = await app.call('GET', '/me', { headers: principal('stranger@branchsuite.example.com', 'oid-x') });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_provisioned');
  });

  it('creates a global admin for a bootstrap email on first sign-in', async () => {
    const app = await createTestApp({ AUTH_MODE: 'swa', BOOTSTRAP_ADMIN_EMAILS: 'first.admin@branchsuite.example.com' }, { seed: false });
    const headers = principal('First.Admin@branchsuite.example.com', 'oid-admin');
    const res = await app.call('GET', '/me', { headers });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'admin', email: 'first.admin@branchsuite.example.com', entraOid: 'oid-admin', name: 'First Admin', initials: 'FA' });
    expect(res.body.permissions.isAdmin).toBe(true);

    const again = await app.call('GET', '/me', { headers });
    expect(again.body.user.id).toBe(res.body.user.id);
    expect(await app.repo.listUsers()).toHaveLength(1);

    const branch = await app.call('POST', '/branches', { headers, body: { code: '2001', name: 'Hillcrest, IL' } });
    expect(branch.status).toBe(201);
    expect(branch.body).toMatchObject({ id: 'branch-2001', timeZone: 'America/Chicago', active: true });
    const accounts = await app.repo.listAccounts('branch-2001');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ reserved: 'internal', name: 'Internal' });
  });
});
