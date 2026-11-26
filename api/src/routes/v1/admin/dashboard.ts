import { Hono } from 'hono';
import { c } from '../../../db/collections.js';
import { requireAdmin, requireFirebaseUser } from '../../../middleware/auth.js';
import type { App } from '../../../types.js';

export const dashboardRoutes = new Hono<App>();

dashboardRoutes.use('*', requireFirebaseUser, requireAdmin);

dashboardRoutes.get('/', async (ctx) => {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const dayAgo = new Date(Date.now() - 24 * 3600_000);

  const [totalResponses, totalSettlements, activeSurveyors, settlementsCovered, byHour, byRegion] =
    await Promise.all([
      c.responses().countDocuments(),
      c.settlements().countDocuments(),
      c.responses().distinct('surveyor_id', { server_ts: { $gte: startOfDay } }),
      c.responses().distinct('settlement_id'),
      c
        .responses()
        .aggregate<{ hour: string; count: number }>([
          { $match: { server_ts: { $gte: dayAgo } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%dT%H:00:00Z', date: '$server_ts' } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, hour: '$_id', count: 1 } },
        ])
        .toArray(),
      c
        .responses()
        .aggregate<{ region: string; count: number }>([
          {
            $lookup: {
              from: 'settlements',
              localField: 'settlement_id',
              foreignField: '_id',
              as: 'settlement',
            },
          },
          { $unwind: '$settlement' },
          { $group: { _id: '$settlement.region', count: { $sum: 1 } } },
          { $project: { _id: 0, region: '$_id', count: 1 } },
          { $sort: { count: -1 } },
        ])
        .toArray(),
    ]);

  return ctx.json({
    kpi: {
      total_responses: totalResponses,
      active_surveyors_today: activeSurveyors.length,
      settlements_covered: settlementsCovered.length,
      coverage_pct:
        totalSettlements > 0
          ? Number(((settlementsCovered.length / totalSettlements) * 100).toFixed(2))
          : 0,
    },
    responses_by_hour: byHour,
    responses_by_region: byRegion,
  });
});
