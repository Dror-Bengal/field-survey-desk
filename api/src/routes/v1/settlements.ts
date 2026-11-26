import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { c } from '../../db/collections.js';
import { parseObjectId } from '../../lib/objectid.js';
import { requireFirebaseUser, requireSurveyor } from '../../middleware/auth.js';
import { SettlementSearchQuery, searchSettlements } from '../../services/settlements.js';
import type { App } from '../../types.js';

export const settlementsRoutes = new Hono<App>();

settlementsRoutes.use('*', requireFirebaseUser, requireSurveyor());

settlementsRoutes.get('/', async (ctx) => {
  const q = SettlementSearchQuery.parse(ctx.req.query());
  return ctx.json(await searchSettlements(q));
});

settlementsRoutes.get('/:id/streets', async (ctx) => {
  const principal = ctx.get('principal');
  const id = parseObjectId(ctx.req.param('id'), 'settlement_id');
  const settlement = await c.settlements().findOne({ _id: id });
  if (!settlement) throw new HTTPException(404, { message: 'settlement_not_found' });

  // BE-SCOPE-ENFORCEMENT: streets must be filtered by the session's
  // frozen station list, otherwise a station-scoped surveyor querying
  // /settlements/X/streets would see streets that contain only out-of-
  // scope voters. Require an active session and use its polling codes.
  const session = await c
    .surveySessions()
    .findOne({ surveyor_id: principal.surveyor_id, ended_at: null });
  if (!session) {
    return ctx.json(
      { error: { code: 'no_active_session', message_en: 'Start a session first to view streets' } },
      403,
    );
  }
  const stationCodes = session.polling_station_codes;
  const voterMatch: Record<string, unknown> = { settlement_id: id };
  if (stationCodes !== undefined) {
    voterMatch.polling_station_code = { $in: stationCodes };
  }

  // BE-ASKED-COUNT-TEAM: per-house "any surveyor on the team has at
  // least one response for this voter" counts. The FE renders the same
  // visited / done chip and un-visited-first sort uses the same field,
  // so flipping this from per-surveyor to team-wide automatically gives
  // every surveyor visibility into work their colleagues already did —
  // no more two surveyors knocking on the same door.
  //
  // (The previous per-surveyor scoping caused real-world double-coverage
  // — see FE-VISIT-STATUS for the original UX and this commit's parent
  // ticket for the team-coordination decision.)
  //
  // Implementation: pre-fetch the (small) set of voter_ids ANYONE has
  // responded to within this settlement, then use $in in a single
  // $addFields. The query is now backed by the response_settlement_time
  // index (settlement_id, server_ts) instead of response_surveyor_time —
  // same shape, same latency profile.
  const respondedVoterIds = await c.responses().distinct('voter_id', {
    settlement_id: id,
    voter_id: { $ne: null },
  });

  const streets = await c
    .voters()
    .aggregate<{ street: string | null; houses: HouseEntry[] }>([
      { $match: voterMatch },
      { $addFields: { has_response: { $in: ['$_id', respondedVoterIds] } } },
      {
        $group: {
          _id: {
            street: '$parsed.street',
            modifier: '$parsed.street_modifier',
            house: '$parsed.house',
          },
          address_key: { $first: '$parsed.address_key' },
          polling_station_codes: { $addToSet: '$polling_station_code' },
          voter_count: { $sum: 1 },
          asked_count: { $sum: { $cond: ['$has_response', 1, 0] } },
        },
      },
      {
        $group: {
          _id: '$_id.street',
          houses: {
            $addToSet: {
              house: '$_id.house',
              street_modifier: '$_id.modifier',
              address_key: '$address_key',
              polling_station_codes: '$polling_station_codes',
              voter_count: '$voter_count',
              asked_count: '$asked_count',
            },
          },
        },
      },
      { $project: { _id: 0, street: '$_id', houses: 1 } },
      { $sort: { street: 1 } },
    ])
    .toArray();

  for (const s of streets) {
    for (const h of s.houses) {
      h.polling_station_codes = (h.polling_station_codes ?? [])
        .filter((c): c is string => typeof c === 'string' && c.length > 0)
        .sort(compareStationCodes);
    }
    s.houses.sort(houseCompare);
  }
  return ctx.json({ settlement_id: id.toHexString(), streets });
});

interface HouseEntry {
  house: string;
  street_modifier: string | null;
  address_key: string;
  polling_station_codes: string[];
  voter_count: number;
  // Voters at this address that the current surveyor has at least one
  // response for. 0 ≤ asked_count ≤ voter_count by construction.
  asked_count: number;
}

function houseCompare(a: HouseEntry, b: HouseEntry): number {
  // Sort by street_modifier first (null first → main-street entries before
  // lane/microdistrict entries), then numerically by house, then locale.
  const am = a.street_modifier ?? '';
  const bm = b.street_modifier ?? '';
  if (am !== bm) return am.localeCompare(bm);
  const ai = Number.parseInt(a.house, 10);
  const bi = Number.parseInt(b.house, 10);
  if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai - bi;
  return a.house.localeCompare(b.house);
}

// Polling station codes are "<district>/<station>" — sort numerically by
// district then station so "1/6" < "1/7" < "10/3".
export function compareStationCodes(a: string, b: string): number {
  const [aDist = 0, aSta = 0] = a.split('/').map((s) => Number.parseInt(s, 10));
  const [bDist = 0, bSta = 0] = b.split('/').map((s) => Number.parseInt(s, 10));
  if (aDist !== bDist) return aDist - bDist;
  return aSta - bSta;
}
