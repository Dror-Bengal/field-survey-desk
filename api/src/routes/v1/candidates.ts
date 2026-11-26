import { Hono } from 'hono';
import { c } from '../../db/collections.js';
import { requireFirebaseUser, requireSurveyor } from '../../middleware/auth.js';
import type { App } from '../../types.js';

export const candidatesRoutes = new Hono<App>();

candidatesRoutes.use('*', requireFirebaseUser, requireSurveyor());

candidatesRoutes.get('/', async (ctx) => {
  const candidates = await c
    .candidates()
    .find({ active: true })
    .sort({ display_order: 1 })
    .toArray();
  return ctx.json({
    candidates: candidates.map((c) => ({
      id: c._id!.toHexString(),
      name_local: c.name_local,
      name_en: c.name_en,
      short_local: c.short_local,
      short_en: c.short_en,
      type: c.type,
      display_order: c.display_order,
      ...(c.response_type !== undefined && { response_type: c.response_type }),
    })),
  });
});
