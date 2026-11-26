import { Hono } from 'hono';
import { c } from '../../db/collections.js';
import { requireFirebaseUser, requireSurveyor } from '../../middleware/auth.js';
import type { App } from '../../types.js';
import { compareStationCodes } from './settlements.js';

export const addressesRoutes = new Hono<App>();

addressesRoutes.use('*', requireFirebaseUser, requireSurveyor());

addressesRoutes.get('/:key/voters', async (ctx) => {
  const principal = ctx.get('principal');
  const addressKey = decodeURIComponent(ctx.req.param('key'));
  // An address key is unique only within the active settlement.
  const session = await c
    .surveySessions()
    .findOne({ surveyor_id: principal.surveyor_id, ended_at: null });
  if (!session) {
    return ctx.json(
      {
        error: {
          code: 'no_active_session',
          message_en: 'Start a session first to view addresses',
        },
      },
      403,
    );
  }
  const settlementId = session.working_settlement_id;
  // Frozen station scope from session-start time (BE-SCOPE-ENFORCEMENT).
  // Legacy sessions created before the field existed get no station filter
  // — they retain the pre-enforcement behavior of seeing every voter in
  // the working settlement.
  const sessionStations = session.polling_station_codes;

  const voterFilter: Record<string, unknown> = {
    'parsed.address_key': addressKey,
    settlement_id: settlementId,
  };
  if (sessionStations !== undefined) {
    voterFilter.polling_station_code = { $in: sessionStations };
  }

  const voters = await c
    .voters()
    .find(voterFilter)
    .sort({ last_name: 1, first_name: 1 })
    .limit(200)
    .toArray();
  if (voters.length === 0) {
    return ctx.json({ address_key: addressKey, polling_station_codes: [], voters: [] });
  }

  const stationCodes = Array.from(
    new Set(voters.map((v) => v.polling_station_code).filter((x): x is string => !!x)),
  ).sort(compareStationCodes);

  // The voter list is already settlement+station scoped, so filtering
  // responses by voter_id $in voterIds is the authoritative path. We
  // additionally constrain by voter_polling_station_code as defense-in-
  // depth — a stale response with the wrong station tag should not bleed
  // into a station-scoped surveyor's history view (BE-SCOPE-ENFORCEMENT).
  const voterIds = voters.map((v) => v._id!);
  const responseMatch: Record<string, unknown> = { voter_id: { $in: voterIds } };
  if (sessionStations !== undefined) {
    responseMatch.voter_polling_station_code = { $in: sessionStations };
  }
  const latestByVoter = await c
    .responses()
    .aggregate<{ _id: { toHexString(): string }; latest: Date; response_type: string }>([
      { $match: responseMatch },
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
  const status = new Map(
    latestByVoter.map((r) => [
      r._id.toHexString(),
      { latest: r.latest, response_type: r.response_type },
    ]),
  );

  return ctx.json({
    address_key: addressKey,
    polling_station_codes: stationCodes,
    voters: voters.map((v) => {
      const s = status.get(v._id!.toHexString());
      return {
        id: v._id!.toHexString(),
        full_name: v.full_name,
        first_name: v.first_name,
        last_name: v.last_name,
        patronymic: v.patronymic,
        age_bucket: v.age_bucket,
        inferred_gender: v.inferred_gender,
        polling_station_code: v.polling_station_code,
        last_response: s ?? null,
      };
    }),
  });
});
