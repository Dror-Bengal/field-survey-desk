import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { normalize } from '../../lib/normalize.js';
import { c } from '../../db/collections.js';
import { parseObjectId } from '../../lib/objectid.js';
import { requireFirebaseUser, requireSurveyor } from '../../middleware/auth.js';
import type { App } from '../../types.js';

export const votersRoutes = new Hono<App>();

votersRoutes.use('*', requireFirebaseUser, requireSurveyor());

// BE-VOTER-SEARCH: scope-aware name search. q is normalized through the
// same `normalize()` ETL pipeline used to populate full_name_normalized,
// 100 protects against catastrophic regex backtracking on extremely long
// inputs and bounds the FE's render cost.
const VoterSearchQuery = z.object({
  q: z.string().trim().min(2, 'q_too_short').max(100, 'q_too_long'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// /search must come BEFORE /:id so the literal route wins. Hono matches
// routes in registration order — flipping these would route "search" to
// the :id handler and produce 400 invalid_voter_id.
votersRoutes.get('/search', async (ctx) => {
  const principal = ctx.get('principal');
  const params = VoterSearchQuery.parse(ctx.req.query());

  // The surveyor's polling-station scope lives on the active session
  // (frozen at session-start by BE-SCOPE-ENFORCEMENT). No active session
  // → 403, mirroring /addresses + /streets. The polling_station_codes
  // filter is the security gate; never relax it.
  const session = await c
    .surveySessions()
    .findOne({ surveyor_id: principal.surveyor_id, ended_at: null });
  if (!session) {
    return ctx.json(
      {
        error: { code: 'no_active_session', message_en: 'Start a session first to search voters' },
      },
      403,
    );
  }
  const stationCodes = session.polling_station_codes;
  // Legacy session without the field is a session opened before
  // BE-SCOPE-ENFORCEMENT shipped. We refuse to search without an explicit
  // station list rather than fall back to "all stations in working
  // settlement" — for search this would be more permissive than the FE
  // expects, and the surveyor can simply re-open their session.
  if (stationCodes === undefined) {
    return ctx.json(
      {
        error: {
          code: 'session_missing_station_scope',
          message_en: 'Session predates scope enforcement; please re-open it',
        },
      },
      409,
    );
  }
  if (stationCodes.length === 0) {
    // Surveyor opened a session at a settlement they're scoped to but
    // the resolver returned an empty station list (shouldn't happen post
    // BE-SCOPE-DATA-MODEL — kept as a defensive empty-result path).
    return ctx.json({ results: [], total: 0, truncated: false });
  }

  const qNorm = normalize(params.q);
  const filter = {
    polling_station_code: { $in: stationCodes },
    full_name_normalized: { $regex: `^${escapeRegex(qNorm)}` },
  };

  // Two parallel queries: count for `total`, find for `items`. Both hit
  // the (full_name_normalized) IXSCAN. Doing them in parallel keeps the
  // p50 close to a single roundtrip even with the count.
  const [total, voters] = await Promise.all([
    c.voters().countDocuments(filter),
    c
      .voters()
      .find(filter)
      .sort({ full_name_normalized: 1 })
      .limit(params.limit)
      .project({
        _id: 1,
        full_name: 1,
        age_bucket: 1,
        inferred_gender: 1,
        polling_station_code: 1,
        // Surface the display-form parsed fields so the FE can route
        // straight to the Address screen with a populated header. The
        // address_key alone is normalized + lowercased and would render
        parsed: 1,
      })
      .toArray(),
  ]);

  // last_response join: same pattern as /addresses. Filter responses by
  // voter_id $in the (already-scoped) match set, then group to pull the
  // latest server_ts + response_type per voter. The voter list is
  // station-scoped, so any joined response inherits that scope by
  // construction.
  const voterIds = voters.map((v) => v._id);
  const latestByVoter =
    voterIds.length === 0
      ? []
      : await c
          .responses()
          .aggregate<{ _id: { toHexString(): string }; latest: Date; response_type: string }>([
            { $match: { voter_id: { $in: voterIds } } },
            { $sort: { server_ts: -1 } },
            {
              $group: {
                _id: '$voter_id',
                latest: { $first: '$server_ts' },
                response_type: { $first: '$response_type' },
              },
            },
          ])
          .toArray();
  const lastByVoter = new Map(
    latestByVoter.map((r) => [
      r._id.toHexString(),
      { latest: r.latest, response_type: r.response_type },
    ]),
  );

  return ctx.json({
    results: voters.map((v) => {
      const lr = lastByVoter.get(v._id.toHexString()) ?? null;
      return {
        id: v._id.toHexString(),
        full_name: v.full_name,
        age_bucket: v.age_bucket,
        gender: v.inferred_gender,
        polling_station_code: v.polling_station_code,
        address_key: v.parsed?.address_key ?? null,
        // Display-form address bits so the FE can populate the Address
        // screen header (street + modifier + house) without a second
        // round trip.
        street: v.parsed?.street ?? null,
        street_modifier: v.parsed?.street_modifier ?? null,
        house: v.parsed?.house ?? null,
        last_response: lr,
      };
    }),
    total,
    truncated: total > params.limit,
  });
});

votersRoutes.get('/:id', async (ctx) => {
  const id = parseObjectId(ctx.req.param('id'), 'voter_id');
  const voter = await c.voters().findOne({ _id: id });
  if (!voter) throw new HTTPException(404, { message: 'voter_not_found' });

  const history = await c
    .responses()
    .find({ voter_id: id })
    .sort({ server_ts: -1 })
    .limit(20)
    .toArray();

  return ctx.json({
    id: voter._id!.toHexString(),
    full_name: voter.full_name,
    first_name: voter.first_name,
    last_name: voter.last_name,
    patronymic: voter.patronymic,
    age_bucket: voter.age_bucket,
    inferred_gender: voter.inferred_gender,
    raw_address: voter.raw_address,
    parsed_address: voter.parsed,
    polling_station_code: voter.polling_station_code,
    settlement_id: voter.settlement_id.toHexString(),
    community: voter.community,
    region: voter.region,
    history: history.map((h) => ({
      id: h._id!.toHexString(),
      tier: h.tier,
      response_type: h.response_type,
      candidate_id: h.candidate_id?.toHexString() ?? null,
      server_ts: h.server_ts,
      flags: h.flags,
    })),
  });
});
