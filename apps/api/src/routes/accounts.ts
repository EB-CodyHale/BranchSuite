/** Accounts (customers + reserved routing accounts), wall coding, routing test and account import. */
import {
  generateWallCode,
  newId,
  routeEmail,
  validateUnits,
  zAccountCreateInput,
  zAccountImportInput,
  zAccountUpdateInput,
  type Account,
  type AccountImportInput,
  type AccountImportPlan,
  type AccountImportPlanRow,
  type AccountUnit,
  type Branch,
  type WallCode,
  type WallLegend,
} from '@branchsuite/shared';
import { z } from 'zod';
import type { Caller } from '../auth/staff.js';
import type { AppContext } from '../context.js';
import { badRequest, conflict, HttpError } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { created, ok } from '../http/types.js';
import { parse, parsePatch } from '../http/validate.js';
import { secureRandom } from '../security/crypto.js';
import { accountForCaller, audit, managedBranch, notify, readableBranch, requireAdmin, requireBranchUser, staff } from './support.js';
import { buildWallFeed } from './wallFeed.js';

const zRoutingTestInput = z.object({
  fromAddress: z.string().trim().min(3).max(254),
  subject: z.string().max(500).optional(),
  body: z.string().max(12_000).optional(),
});

const normalizeName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** A fresh wall code unique within the branch. */
function nextWallCode(taken: WallCode[]): WallCode {
  return generateWallCode(taken, secureRandom);
}

export function newAccount(branchId: string, fields: Pick<Account, 'name'> & Partial<Account>, taken: WallCode[], actorId: string | null, nowIso: string): Account {
  return {
    id: newId('acc'),
    branchId,
    accountNumber: null,
    sourceId: null,
    aliases: [],
    domains: [],
    ownerId: null,
    isPriority: false,
    reserved: null,
    units: [],
    contacts: [],
    active: true,
    ...fields,
    wall: fields.wall ?? nextWallCode(taken),
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: actorId,
    updatedBy: actorId,
  };
}

async function validateOwners(ctx: AppContext, branchId: string, ownerIds: Array<string | null | undefined>): Promise<void> {
  for (const id of new Set(ownerIds.filter((v): v is string => typeof v === 'string'))) {
    await requireBranchUser(ctx, branchId, id, 'owner');
  }
}

export function registerAccountRoutes(router: Router): void {
  router.get(
    '/branches/:b/accounts',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const accounts = await ctx.repo.listAccounts(branch.id);
      return ok(accounts.map((a) => accountForCaller(caller, a)));
    }),
  );

  router.post(
    '/branches/:b/accounts',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parse(zAccountCreateInput, req.body);
      const existing = await ctx.repo.listAccounts(branch.id);
      if (existing.some((a) => a.active && normalizeName(a.name) === normalizeName(input.name))) {
        throw conflict('An active account with that name already exists.');
      }
      await validateOwners(ctx, branch.id, [input.ownerId]);
      const account = newAccount(
        branch.id,
        {
          name: input.name,
          accountNumber: input.accountNumber ?? null,
          aliases: input.aliases ?? [],
          domains: input.domains ?? [],
          ownerId: input.ownerId ?? null,
          isPriority: input.isPriority ?? false,
        },
        existing.map((a) => a.wall),
        caller.user.id,
        ctx.now().toISOString(),
      );
      await ctx.repo.createAccount(account);
      await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'account', entityId: account.id, action: 'create', summary: `Created account ${account.name}` });
      notify(ctx, branch.id, ['accounts'], { wall: true });
      return created(account);
    }),
  );

  router.patch(
    '/branches/:b/accounts/:id',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parsePatch(zAccountUpdateInput, req.body);
      const units: AccountUnit[] | undefined = input.units?.map((u) => ({ ...u, id: u.id ?? newId('unit') }));
      if (units) {
        const errors = validateUnits(units);
        if (errors.length > 0) throw badRequest('The unit tree is not valid.', errors);
      }
      await validateOwners(ctx, branch.id, [input.ownerId, ...(units ?? []).map((u) => u.ownerId)]);
      if (input.wall) {
        const others = (await ctx.repo.listAccounts(branch.id)).filter((a) => a.id !== req.params.id);
        if (others.some((a) => a.wall.code === input.wall!.code)) throw conflict(`Wall code ${input.wall.code} is already used in this branch.`);
      }
      const account = await ctx.repo.updateAccount(branch.id, req.params.id!, (current) => {
        const nextUnits = units ?? current.units;
        const contacts = input.contacts?.map((c) => ({ ...c, id: c.id ?? newId('con') })) ?? current.contacts ?? [];
        const unitIds = new Set(nextUnits.map((u) => u.id));
        if (contacts.some((c) => c.unitId !== null && !unitIds.has(c.unitId))) throw badRequest('A contact refers to a unit that does not exist.');
        return { ...current, ...input, units: nextUnits, contacts, updatedAt: ctx.now().toISOString(), updatedBy: caller.user.id };
      });
      await audit(ctx, caller.user.id, {
        branchId: branch.id,
        entity: 'account',
        entityId: account.id,
        action: 'update',
        summary: `Edited ${account.name}: ${Object.keys(input).join(', ')}`,
      });
      notify(ctx, branch.id, ['accounts'], { wall: true });
      return ok(account);
    }),
  );

  router.post(
    '/branches/:b/accounts/rotate-wall-codes',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const accounts = await ctx.repo.listAccounts(branch.id);
      const taken: WallCode[] = [];
      const rotated: Account[] = [];
      for (const account of accounts) {
        const wall = nextWallCode(taken);
        taken.push(wall);
        rotated.push(await ctx.repo.updateAccount(branch.id, account.id, (a) => ({ ...a, wall, updatedAt: ctx.now().toISOString(), updatedBy: caller.user.id })));
      }
      await audit(ctx, caller.user.id, { branchId: branch.id, entity: 'branch', entityId: branch.id, action: 'rotate_wall_codes', summary: `Rotated ${rotated.length} wall code(s)` });
      notify(ctx, branch.id, ['accounts', 'wall'], { wall: true });
      return ok(rotated);
    }),
  );

  router.post(
    '/branches/:b/accounts/import',
    staff(async (req, ctx, caller) => {
      requireAdmin(caller);
      const branch = readableBranch(caller, req.params.b!);
      const input = parse(zAccountImportInput, req.body);
      const plan = await importAccounts(ctx, caller, branch, input);
      if (plan.applied) notify(ctx, branch.id, ['accounts'], { wall: true });
      return ok(plan);
    }),
  );

  router.post(
    '/branches/:b/routing/test',
    staff(async (req, ctx, caller) => {
      const branch = managedBranch(caller, req.params.b!);
      const input = parse(zRoutingTestInput, req.body);
      const accounts = await ctx.repo.listAccounts(branch.id);
      return ok(
        routeEmail(
          {
            fromAddress: input.fromAddress,
            subject: input.subject ?? '',
            body: input.body ?? '',
            internalDomains: [...branch.settings.internalDomains, ...ctx.config.tenantDomains],
          },
          accounts,
        ),
      );
    }),
  );

  router.get(
    '/branches/:b/wall/legend',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const accounts = await ctx.repo.listAccounts(branch.id);
      const legend: WallLegend = {
        branchId: branch.id,
        entries: accounts
          .filter((a) => a.active && a.reserved === null)
          .map((a) => ({ accountId: a.id, name: a.name, code: a.wall.code, color: a.wall.color, glyph: a.wall.glyph }))
          .sort((x, y) => x.code.localeCompare(y.code)),
      };
      return ok(legend);
    }),
  );

  router.get(
    '/branches/:b/wall/preview',
    staff(async (req, ctx, caller) => {
      const branch = readableBranch(caller, req.params.b!);
      const mode = req.query.get('mode');
      if (mode !== null && mode !== 'board' && mode !== 'whiteboard') throw badRequest('mode must be board or whiteboard.');
      // ?mode=whiteboard renders today's board even outside its window (staff only; never on /wall/feed).
      return ok(await buildWallFeed(ctx, branch, { preview: { forceWhiteboard: mode === 'whiteboard' } }));
    }),
  );
}

type PlannedRow = AccountImportPlanRow & { apply?: (taken: WallCode[]) => Promise<void> };

/**
 * Dry-run (apply=false) or apply an account import. Matching order per row: existingId,
 * then sourceId, then account number, then exact name (case-insensitive). parentAccountId adds a unit.
 */
async function importAccounts(ctx: AppContext, caller: Caller, branch: Branch, input: AccountImportInput): Promise<AccountImportPlan> {
  const accounts = await ctx.repo.listAccounts(branch.id);
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const seen = new Set<string>();
  const actor = caller.user.id;
  const now = () => ctx.now().toISOString();

  const rows: PlannedRow[] = input.accounts.map((row) => {
    const key = `${row.parentAccountId ?? ''}|${normalizeName(row.name)}`;
    if (seen.has(key)) return { name: row.name, action: 'error', accountId: null, message: 'Duplicate row in this import.' };
    seen.add(key);

    if (row.parentAccountId) {
      const parent = byId.get(row.parentAccountId);
      if (!parent) return { name: row.name, action: 'error', accountId: null, message: 'Parent account not found in this branch.' };
      if (parent.units.some((u) => normalizeName(u.name) === normalizeName(row.name))) {
        return { name: row.name, action: 'unchanged', accountId: parent.id, message: `Unit already exists under ${parent.name}.` };
      }
      return {
        name: row.name,
        action: 'create',
        accountId: parent.id,
        message: `Adds unit under ${parent.name}.`,
        apply: async () => {
          await ctx.repo.updateAccount(branch.id, parent.id, (a) => ({
            ...a,
            units: [...a.units, { id: newId('unit'), name: row.name, parentId: null, ownerId: null, aliases: [], active: true }],
            updatedAt: now(),
            updatedBy: actor,
          }));
        },
      };
    }

    const match = row.existingId
      ? byId.get(row.existingId)
      : accounts.find((a) => row.sourceId !== undefined && a.sourceId === row.sourceId) ??
        accounts.find((a) => row.accountNumber !== undefined && a.accountNumber === row.accountNumber) ??
        accounts.find((a) => normalizeName(a.name) === normalizeName(row.name));
    if (row.existingId && !match) return { name: row.name, action: 'error', accountId: null, message: 'No account with that id in this branch.' };

    if (match) {
      const next = {
        name: row.name,
        accountNumber: row.accountNumber ?? match.accountNumber,
        sourceId: row.sourceId ?? match.sourceId,
      };
      const changed = next.name !== match.name || next.accountNumber !== match.accountNumber || next.sourceId !== match.sourceId;
      if (!changed) return { name: row.name, action: 'unchanged', accountId: match.id, message: 'Already up to date.' };
      return {
        name: row.name,
        action: 'update',
        accountId: match.id,
        message: `Updates ${match.name}.`,
        apply: async () => {
          await ctx.repo.updateAccount(branch.id, match.id, (a) => ({ ...a, ...next, updatedAt: now(), updatedBy: actor }));
        },
      };
    }
    return {
      name: row.name,
      action: 'create',
      accountId: null,
      message: 'Creates a new account.',
      apply: async (taken) => {
        const account = newAccount(branch.id, { name: row.name, accountNumber: row.accountNumber ?? null, sourceId: row.sourceId ?? null }, taken, actor, now());
        taken.push(account.wall);
        await ctx.repo.createAccount(account);
      },
    };
  });

  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) counts[r.action] += 1;
  const applied = input.apply && counts.error === 0;
  if (input.apply && counts.error > 0) {
    throw new HttpError(400, 'bad_request', 'Fix the rows marked as errors before applying the import.', rows.filter((r) => r.action === 'error'));
  }
  if (applied) {
    const taken = accounts.map((a) => a.wall);
    for (const r of rows) await r.apply?.(taken);
    await audit(ctx, actor, {
      branchId: branch.id,
      entity: 'account',
      entityId: branch.id,
      action: 'import',
      summary: `Imported accounts: ${counts.create} created, ${counts.update} updated`,
    });
  }
  return { applied, rows: rows.map(({ apply: _apply, ...row }) => row), counts };
}
