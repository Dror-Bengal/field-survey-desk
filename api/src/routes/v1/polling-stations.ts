// Surveyor-accessible polling-station search. Mirror of the admin route's
// shape (code + settlement name + region) so the same FE scope picker can
// pivot endpoints by role. Public-ish: any signed-in user can search.

import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { c } from '../../db/collections.js';
import { requireFirebaseUser } from '../../middleware/auth.js';
import { ObjectIdHex } from '../../schemas/common.js';
import type { App } from '../../types.js';

export const pollingStationsRoutes = new Hono<App>();

pollingStationsRoutes.use('*', requireFirebaseUser);

const StationsQuery = z.object({
  q: z.string().trim().optional(),
  settlement_id: ObjectIdHex.optional(),
  codes: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1).max(64)))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

interface StationResult {
  code: string;
  settlement_id: string;
  settlement_name_local: string;
  settlement_name_en: string | null;
  region: string;
  district_code: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

pollingStationsRoutes.get('/', async (ctx) => {
  const q = StationsQuery.parse(ctx.req.query());

  const match: Record<string, unknown> = {};
  if (q.codes && q.codes.length > 0) {
    match.code = { $in: q.codes };
  } else if (q.q && q.q.length >= 1) {
    match.code = { $regex: `^${escapeRegex(q.q)}`, $options: 'i' };
  } else if (q.settlement_id) {
    match.settlement_id = new ObjectId(q.settlement_id);
  } else {
    return ctx.json({ results: [] });
  }
  if (q.settlement_id && !match.settlement_id) {
    match.settlement_id = new ObjectId(q.settlement_id);
  }

  const docs = await c
    .pollingStations()
    .aggregate<StationResult>([
      { $match: match },
      { $sort: { code: 1 } },
      { $limit: q.limit },
      {
        $lookup: {
          from: 'settlements',
          localField: 'settlement_id',
          foreignField: '_id',
          as: 'settlement',
        },
      },
      { $unwind: { path: '$settlement', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          code: 1,
          settlement_id: { $toString: '$settlement_id' },
          settlement_name_local: '$settlement.name_local',
          settlement_name_en: { $ifNull: ['$settlement.name_en', null] },
          region: '$region',
          district_code: 1,
        },
      },
    ])
    .toArray();

  return ctx.json({ results: docs });
});
