import { Hono } from 'hono';
import { requireAdmin, requireFirebaseUser } from '../../../middleware/auth.js';
import { SettlementSearchQuery, searchSettlements } from '../../../services/settlements.js';
import type { App } from '../../../types.js';

export const adminSettlementsRoutes = new Hono<App>();

adminSettlementsRoutes.use('*', requireFirebaseUser, requireAdmin);

adminSettlementsRoutes.get('/', async (ctx) => {
  const q = SettlementSearchQuery.parse(ctx.req.query());
  return ctx.json(await searchSettlements(q));
});
