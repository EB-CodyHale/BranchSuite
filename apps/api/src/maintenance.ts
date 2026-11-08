/**
 * Daily maintenance: resume paused orders whose resumeOn day has arrived (branch-local).
 * Expiry of pairings, filtered mail, receipts and audit events is handled by Cosmos TTL.
 */
import { todayKey } from '@branchsuite/shared';
import type { AppContext } from './context.js';
import { resumeOrder } from './routes/orders.js';
import { audit, notify } from './routes/support.js';

export async function runMaintenance(ctx: AppContext): Promise<{ resumed: number }> {
  let resumed = 0;
  const now = ctx.now();
  for (const branch of (await ctx.repo.listBranches()).filter((b) => b.active)) {
    const today = todayKey(branch.timeZone, now);
    const due = (await ctx.repo.listOrders(branch.id, { status: 'paused' })).filter((o) => o.pause?.resumeOn && o.pause.resumeOn <= today);
    let changed = 0;
    for (const order of due) {
      try {
        let applied = false;
        await ctx.repo.updateOrder(branch.id, order.id, (current) => {
          // Re-check on the current version: someone may have resumed or edited it meanwhile.
          applied = current.status === 'paused' && !!current.pause?.resumeOn && current.pause.resumeOn <= today;
          return applied ? resumeOrder(current, null, ctx.now().toISOString()) : current;
        });
        if (!applied) continue;
        changed += 1;
        await audit(ctx, null, { branchId: branch.id, entity: 'order', entityId: order.id, action: 'resume', summary: `Resumed automatically on ${today}` });
      } catch (err) {
        ctx.log.error('Auto-resume failed', { branchId: branch.id, orderId: order.id, error: String(err) });
      }
    }
    if (changed > 0) notify(ctx, branch.id, ['orders'], { wall: true });
    resumed += changed;
  }
  ctx.log.info('Maintenance finished', { resumed });
  return { resumed };
}
