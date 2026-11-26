// Surveyor-accessible community search. Mirrors the shape of the admin
// equivalent so the same FE ScopePicker can pivot endpoints by role.
// Returns aggregate metadata only (name + region + settlement_count) —
// no PII, safe to expose to any signed-in user.

import { Hono } from 'hono';
import { z } from 'zod';
import { c } from '../../db/collections.js';
import { requireFirebaseUser } from '../../middleware/auth.js';
import type { App } from '../../types.js';

export const communitiesRoutes = new Hono<App>();

communitiesRoutes.use('*', requireFirebaseUser);

const CommunitiesQuery = z.object({
  q: z.string().trim().optional(),
  names: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1).max(200)))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

interface CommunityResult {
  name: string;
  region: string;
  settlement_count: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

communitiesRoutes.get('/', async (ctx) => {
  const q = CommunitiesQuery.parse(ctx.req.query());

  const match: Record<string, unknown> = {};
  if (q.names && q.names.length > 0) {
    match.community = { $in: q.names };
  } else if (q.q && q.q.length >= 1) {
    match.community = { $regex: `^${escapeRegex(q.q)}`, $options: 'i' };
  } else {
    return ctx.json({ results: [] });
  }

  const docs = await c
    .settlements()
    .aggregate<CommunityResult>([
      { $match: match },
      {
        $group: {
          _id: '$community',
          region: { $first: '$region' },
          settlement_count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, name: '$_id', region: 1, settlement_count: 1 } },
      { $sort: { name: 1 } },
      { $limit: q.limit },
    ])
    .toArray();

  return ctx.json({ results: docs });
});
