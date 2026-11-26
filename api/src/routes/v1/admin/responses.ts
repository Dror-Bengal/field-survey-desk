import { Hono } from 'hono';
import type { Filter, ObjectId } from 'mongodb';
import { c } from '../../../db/collections.js';
import type { ResponseDoc } from '../../../db/types.js';
import { toCsv } from '../../../lib/csv.js';
import { parseObjectId } from '../../../lib/objectid.js';
import { PageQuery, pageMeta, pageSkip } from '../../../lib/pagination.js';
import { requireAdmin, requireFirebaseUser } from '../../../middleware/auth.js';
import { DeleteAllConfirm, ResponseFilters } from '../../../schemas/admin.js';
import type { App } from '../../../types.js';

// Per-page join data so the admin Responses table can render human-readable
// surveyor / voter / party / address columns instead of raw IDs. One $in
// query per kind, scoped to the IDs we actually need; total per-page cost
// is 4 indexed lookups.
type EnrichMaps = {
  surveyors: Map<string, { id: string; full_name: string; email: string }>;
  voters: Map<string, { id: string; full_name: string }>;
  candidates: Map<
    string,
    { id: string; name_local: string; name_en: string; short_local: string; short_en: string; type: string }
  >;
  addresses: Map<
    string,
    { street: string | null; street_modifier: string | null; house: string }
  >;
};

async function buildEnrichMaps(items: ResponseDoc[]): Promise<EnrichMaps> {
  const surveyorIds = new Set<string>();
  const voterIds = new Set<string>();
  const candidateIds = new Set<string>();
  const addressKeys = new Set<string>();
  for (const r of items) {
    surveyorIds.add(r.surveyor_id.toHexString());
    if (r.voter_id) voterIds.add(r.voter_id.toHexString());
    if (r.candidate_id) candidateIds.add(r.candidate_id.toHexString());
    addressKeys.add(r.address_key);
  }

  const toObjectIds = (ids: Set<string>): ObjectId[] =>
    [...ids].map((id) => parseObjectId(id, 'enrich_id'));

  const [surveyorDocs, voterDocs, candidateDocs, addressDocs] = await Promise.all([
    surveyorIds.size === 0
      ? []
      : c
          .surveyors()
          .find(
            { _id: { $in: toObjectIds(surveyorIds) } },
            { projection: { full_name: 1, email: 1 } },
          )
          .toArray(),
    voterIds.size === 0
      ? []
      : c
          .voters()
          .find(
            { _id: { $in: toObjectIds(voterIds) } },
            { projection: { full_name: 1 } },
          )
          .toArray(),
    candidateIds.size === 0
      ? []
      : c
          .candidates()
          .find(
            { _id: { $in: toObjectIds(candidateIds) } },
            { projection: { name_local: 1, name_en: 1, short_local: 1, short_en: 1, type: 1 } },
          )
          .toArray(),
    addressKeys.size === 0
      ? []
      : c
          .voters()
          .aggregate<{ _id: string; parsed: { street: string | null; street_modifier: string | null; house: string } }>([
            { $match: { 'parsed.address_key': { $in: [...addressKeys] } } },
            { $group: { _id: '$parsed.address_key', parsed: { $first: '$parsed' } } },
          ])
          .toArray(),
  ]);

  const surveyors = new Map(
    surveyorDocs.map((s) => [
      s._id!.toHexString(),
      { id: s._id!.toHexString(), full_name: s.full_name, email: s.email },
    ]),
  );
  const voters = new Map(
    voterDocs.map((v) => [
      v._id!.toHexString(),
      { id: v._id!.toHexString(), full_name: v.full_name },
    ]),
  );
  const candidates = new Map(
    candidateDocs.map((c2) => [
      c2._id!.toHexString(),
      {
        id: c2._id!.toHexString(),
        name_local: c2.name_local,
        name_en: c2.name_en,
        short_local: c2.short_local ?? '',
        short_en: c2.short_en ?? '',
        type: c2.type,
      },
    ]),
  );
  const addresses = new Map(
    addressDocs.map((a) => [
      a._id,
      {
        street: a.parsed?.street ?? null,
        street_modifier: a.parsed?.street_modifier ?? null,
        house: a.parsed?.house ?? '',
      },
    ]),
  );

  return { surveyors, voters, candidates, addresses };
}

export const adminResponsesRoutes = new Hono<App>();

adminResponsesRoutes.use('*', requireFirebaseUser, requireAdmin);

function buildFilter(q: Record<string, string | undefined>): Filter<ResponseDoc> {
  const f = ResponseFilters.parse(q);
  const filter: Filter<ResponseDoc> = {};
  if (f.candidate_id) filter.candidate_id = parseObjectId(f.candidate_id, 'candidate_id');
  if (f.settlement_id) filter.settlement_id = parseObjectId(f.settlement_id, 'settlement_id');
  if (f.surveyor_id) filter.surveyor_id = parseObjectId(f.surveyor_id, 'surveyor_id');
  if (f.tier) filter.tier = f.tier;
  if (f.flag) filter.flags = f.flag;
  if (f.from || f.to) {
    filter.server_ts = {};
    if (f.from) filter.server_ts.$gte = new Date(f.from);
    if (f.to) filter.server_ts.$lte = new Date(f.to);
  }
  return filter;
}

adminResponsesRoutes.get('/', async (ctx) => {
  const filter = buildFilter(ctx.req.query());
  const page = PageQuery.parse(ctx.req.query());

  const [total, items] = await Promise.all([
    c.responses().countDocuments(filter),
    c
      .responses()
      .find(filter)
      .sort({ server_ts: -1 })
      .skip(pageSkip(page))
      .limit(page.limit)
      .toArray(),
  ]);

  const enriched = await buildEnrichMaps(items);

  return ctx.json({
    page: pageMeta(page, total),
    items: items.map((r) => {
      const surveyorHex = r.surveyor_id.toHexString();
      const voterHex = r.voter_id?.toHexString() ?? null;
      const candidateHex = r.candidate_id?.toHexString() ?? null;
      return {
        id: r._id!.toHexString(),
        session_id: r.session_id.toHexString(),
        surveyor_id: surveyorHex,
        // BE-RESPONSES-LIST-ENRICH: denormalized join data so the admin
        // table can show names instead of hex IDs. Falls back to null so
        // the FE can guard cleanly when an FK target was deleted.
        surveyor: enriched.surveyors.get(surveyorHex) ?? null,
        tier: r.tier,
        voter_id: voterHex,
        voter: voterHex ? enriched.voters.get(voterHex) ?? null : null,
        candidate_id: candidateHex,
        candidate: candidateHex ? enriched.candidates.get(candidateHex) ?? null : null,
        settlement_id: r.settlement_id.toHexString(),
        response_type: r.response_type,
        demographic: r.demographic,
        address_key: r.address_key,
        // Parsed display-form address (street + modifier + house) so the
        // FE doesn't have to render raw "settlement|street||7" strings.
        parsed: enriched.addresses.get(r.address_key) ?? null,
        voter_polling_station_code: r.voter_polling_station_code,
        notes: r.notes,
        client_geo: r.client_geo,
        client_accuracy_m: r.client_accuracy_m,
        client_ts: r.client_ts,
        server_ts: r.server_ts,
        flags: r.flags,
      };
    }),
  });
});

adminResponsesRoutes.get('/export', async (ctx) => {
  const filter = buildFilter(ctx.req.query());
  const cursor = c.responses().find(filter).sort({ server_ts: -1 }).limit(50_000);
  const rows: Record<string, unknown>[] = [];
  for await (const r of cursor) {
    rows.push({
      id: r._id!.toHexString(),
      tier: r.tier,
      response_type: r.response_type,
      surveyor_id: r.surveyor_id.toHexString(),
      voter_id: r.voter_id?.toHexString() ?? '',
      candidate_id: r.candidate_id?.toHexString() ?? '',
      settlement_id: r.settlement_id.toHexString(),
      address_key: r.address_key,
      voter_polling_station_code: r.voter_polling_station_code ?? '',
      demographic_gender: r.demographic?.gender ?? '',
      demographic_age_bucket: r.demographic?.age_bucket ?? '',
      client_lat: r.client_geo?.coordinates[1] ?? '',
      client_lng: r.client_geo?.coordinates[0] ?? '',
      client_accuracy_m: r.client_accuracy_m ?? '',
      client_ts: r.client_ts,
      server_ts: r.server_ts,
      flags: r.flags.join('|'),
      notes: r.notes,
    });
  }

  const csv = toCsv(rows, [
    'id',
    'tier',
    'response_type',
    'surveyor_id',
    'voter_id',
    'candidate_id',
    'settlement_id',
    'address_key',
    'voter_polling_station_code',
    'demographic_gender',
    'demographic_age_bucket',
    'client_lat',
    'client_lng',
    'client_accuracy_m',
    'client_ts',
    'server_ts',
    'flags',
    'notes',
  ]);

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="responses-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

adminResponsesRoutes.delete('/all', async (ctx) => {
  DeleteAllConfirm.parse(ctx.req.query());
  const res = await c.responses().deleteMany({});
  return ctx.json({ deleted: res.deletedCount });
});
