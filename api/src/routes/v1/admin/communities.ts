// Admin-only community search. Communities are not their own collection
// — they're a denormalized field on SettlementDoc. We query distinct
// community names and join settlement counts in a single aggregate so the
// admin scope picker can show "<community> (N settlements)" chips without
// per-row lookups.

import { Hono } from 'hono';
import { z } from 'zod';
import { c } from '../../../db/collections.js';
import { requireAdmin, requireFirebaseUser } from '../../../middleware/auth.js';
import type { App } from '../../../types.js';

export const adminCommunitiesRoutes = new Hono<App>();

adminCommunitiesRoutes.use('*', requireFirebaseUser, requireAdmin);

// q: prefix-match on community name (case-insensitive). names: exact-match
// hydration for chip restoration. Mutually exclusive — names wins.
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

adminCommunitiesRoutes.get('/', async (ctx) => {
  const q = CommunitiesQuery.parse(ctx.req.query());

  const match: Record<string, unknown> = {};
  if (q.names && q.names.length > 0) {
    match.community = { $in: q.names };
  } else if (q.q && q.q.length >= 1) {
    // Anchor to start of community for predictability — a "Yere" search
    // rejected to avoid scanning the whole settlements collection.
    match.community = { $regex: `^${escapeRegex(q.q)}`, $options: 'i' };
  } else {
    return ctx.json({ results: [] });
  }

  // One pipeline: filter, group by community, take the first region we
  // see (region is settlement-attached but practically constant within a
  // community), count members, sort + limit.
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
