import { Hono } from 'hono';
import type { Filter } from 'mongodb';
import { c } from '../../../db/collections.js';
import type { SurveySessionDoc } from '../../../db/types.js';
import { parseObjectId } from '../../../lib/objectid.js';
import { PageQuery, pageMeta, pageSkip } from '../../../lib/pagination.js';
import { requireAdmin, requireFirebaseUser } from '../../../middleware/auth.js';
import type { App } from '../../../types.js';

export const adminSessionsRoutes = new Hono<App>();

adminSessionsRoutes.use('*', requireFirebaseUser, requireAdmin);

adminSessionsRoutes.get('/', async (ctx) => {
  const q = ctx.req.query();
  const page = PageQuery.parse(q);
  const filter: Filter<SurveySessionDoc> = {};
  if (q.surveyor_id) filter.surveyor_id = parseObjectId(q.surveyor_id, 'surveyor_id');
  if (q.settlement_id)
    filter.working_settlement_id = parseObjectId(q.settlement_id, 'settlement_id');
  if (q.open === 'true') filter.ended_at = null;

  const [total, items] = await Promise.all([
    c.surveySessions().countDocuments(filter),
    c
      .surveySessions()
      .find(filter)
      .sort({ started_at: -1 })
      .skip(pageSkip(page))
      .limit(page.limit)
      .toArray(),
  ]);

  return ctx.json({
    page: pageMeta(page, total),
    items: items.map((s) => ({
      id: s._id!.toHexString(),
      surveyor_id: s.surveyor_id.toHexString(),
      working_settlement_id: s.working_settlement_id.toHexString(),
      started_at: s.started_at,
      ended_at: s.ended_at,
      login_geo: s.login_geo,
      login_accuracy_m: s.login_accuracy_m,
      user_agent: s.user_agent,
    })),
  });
});
