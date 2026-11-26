import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Filter, ObjectId, WithId } from 'mongodb';
import { c } from '../../../db/collections.js';
import type { SurveyorDoc, SurveyorScope } from '../../../db/types.js';
import { parseObjectId } from '../../../lib/objectid.js';
import { PageQuery, pageMeta, pageSkip } from '../../../lib/pagination.js';
import { requireAdmin, requireFirebaseUser } from '../../../middleware/auth.js';
import {
  ApproveSurveyorBody,
  CreateSurveyorBody,
  RejectSurveyorBody,
  SurveyorListQuery,
  UpdateSurveyorBody,
} from '../../../schemas/admin.js';
import {
  communityKey,
  mergeScopes,
  resolveAccessibleSettlements,
  scopeKeys,
  settlementKey,
  stationKey,
  validateScope,
} from '../../../services/scope.js';
import type { App } from '../../../types.js';

export const adminSurveyorsRoutes = new Hono<App>();

adminSurveyorsRoutes.use('*', requireFirebaseUser, requireAdmin);

// Compact settlement chip surfaced alongside the resolved settlements list,
// so the admin UI can show actual names rather than just hex IDs.
type SettlementChip = { id: string; name_local: string; name_en: string | null };

// Wire-shape scope (string ObjectIds, never undefined arrays). Keeps the
// admin UI from having to handle three different "missing" states for the
// three scope arrays.
interface ScopeWire {
  communities: string[];
  settlements: string[];
  polling_station_codes: string[];
}

function scopeToWire(scope: SurveyorScope | undefined): ScopeWire {
  return {
    communities: scope?.communities ?? [],
    settlements: (scope?.settlements ?? []).map((s) => s.toHexString()),
    polling_station_codes: scope?.polling_station_codes ?? [],
  };
}

// Convert validated zod input into the DB-shaped scope (ObjectId for
// settlements, plain strings for the other two). Empty arrays are dropped
// so the document doesn't keep stale empty fields after a refine.
function scopeFromWire(input: {
  communities?: string[];
  settlements?: string[];
  polling_station_codes?: string[];
}): SurveyorScope {
  const out: SurveyorScope = {};
  if (input.communities && input.communities.length > 0) out.communities = input.communities;
  if (input.settlements && input.settlements.length > 0) {
    out.settlements = input.settlements.map((s) => parseObjectId(s, 'settlement_id'));
  }
  if (input.polling_station_codes && input.polling_station_codes.length > 0) {
    out.polling_station_codes = input.polling_station_codes;
  }
  return out;
}

function serializeSurveyor(s: WithId<SurveyorDoc>, settlementById?: Map<string, SettlementChip>) {
  const resolvedHexIds = (s.settlements ?? []).map((x) => x.toHexString());
  // Include settlements referenced by the surveyor's PENDING request as
  // well, so the admin scope-requests view can render real names for items
  // that aren't yet in the granted scope. Without this, the FE falls back
  // to `#<hex prefix>…` for every requested settlement.
  const requestedHexIds = (s.requested_scope?.settlements ?? []).map((x) => x.toHexString());
  const allHexIds = Array.from(new Set([...resolvedHexIds, ...requestedHexIds]));
  const settlements_full: SettlementChip[] = settlementById
    ? allHexIds.map((id) => settlementById.get(id)).filter((c): c is SettlementChip => !!c)
    : [];
  const hasRequest =
    !!s.requested_scope &&
    ((s.requested_scope.communities?.length ?? 0) > 0 ||
      (s.requested_scope.settlements?.length ?? 0) > 0 ||
      (s.requested_scope.polling_station_codes?.length ?? 0) > 0);
  return {
    id: s._id.toHexString(),
    firebase_uid: s.firebase_uid,
    email: s.email,
    full_name: s.full_name,
    phone: s.phone ?? null,
    status: s.status,
    scope: scopeToWire(s.scope),
    // Legacy + denormalized: resolved union of settlement IDs that this
    // surveyor can access. /sessions still reads this until
    // BE-SCOPE-ENFORCEMENT lands, and the admin UI uses it for the
    // "X settlements assigned" badge.
    settlements: resolvedHexIds,
    settlements_full,
    response_counts: s.response_counts ?? { total: 0, T1: 0, T2: 0, T3: 0 },
    notes: s.notes,
    created_at: s.created_at,
    approved_by: s.approved_by ?? null,
    approved_at: s.approved_at ?? null,
    rejected_by: s.rejected_by ?? null,
    rejected_at: s.rejected_at ?? null,
    rejection_reason: s.rejection_reason ?? null,
    settlements_updated_at: s.settlements_updated_at ?? null,
    settlements_changed_by: s.settlements_changed_by ?? null,
    // Self-service scope request (FE-SCOPE-SELF-SERVICE). The full wire
    // shape is included so the admin review modal can show what's being
    // asked for without an extra fetch. `has_scope_request` is the cheap
    // boolean the list view uses for the "n pending" badge.
    requested_scope: scopeToWire(s.requested_scope),
    requested_scope_at: s.requested_scope_at ?? null,
    has_scope_request: hasRequest,
    scope_active_map: s.scope_active_map ?? {},
  };
}

// Single-trip lookup for the settlement chips used in the admin views. Pass
// the union of all settlement ObjectIds across the surveyors you're about to
// serialize so we don't re-fetch settlements per row.
async function buildSettlementChipMap(ids: ObjectId[]): Promise<Map<string, SettlementChip>> {
  const map = new Map<string, SettlementChip>();
  if (ids.length === 0) return map;
  const docs = await c
    .settlements()
    .find({ _id: { $in: ids } }, { projection: { name_local: 1, name_en: 1 } })
    .toArray();
  for (const d of docs) {
    map.set(d._id.toHexString(), {
      id: d._id.toHexString(),
      name_local: d.name_local,
      name_en: d.name_en ?? null,
    });
  }
  return map;
}

// Validate scope and resolve it to the legacy settlements field in one
// pass. Returns the JSON 400 response on validation failure so callers can
// short-circuit. On success, returns both the DB-shaped scope and the
// resolved settlement IDs to dual-write atomically.
async function validateAndResolveScope(
  scope: SurveyorScope,
): Promise<
  | { ok: true; scope: SurveyorScope; settlements: ObjectId[] }
  | { ok: false; status: 400; body: unknown }
> {
  const validation = await validateScope(scope);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: 'scope_entries_not_found',
          message_en: 'One or more scope entries do not exist',
          ...validation.missing,
        },
      },
    };
  }
  const resolved = await resolveAccessibleSettlements(scope);
  return { ok: true, scope, settlements: resolved.settlement_ids };
}

// GET /admin/surveyors/pending — listed before /:id-shaped routes so the literal wins.
adminSurveyorsRoutes.get('/pending', async (ctx) => {
  const items = await c.surveyors().find({ status: 'pending' }).sort({ created_at: 1 }).toArray();
  return ctx.json({
    items: items.map((s) => ({
      id: s._id.toHexString(),
      firebase_uid: s.firebase_uid,
      email: s.email,
      full_name: s.full_name,
      created_at: s.created_at,
    })),
  });
});

adminSurveyorsRoutes.get('/', async (ctx) => {
  const page = PageQuery.parse(ctx.req.query());
  const filterParsed = SurveyorListQuery.parse(ctx.req.query());
  const filter: Filter<SurveyorDoc> = {};
  if (filterParsed.status) filter.status = filterParsed.status;

  const [total, items] = await Promise.all([
    c.surveyors().countDocuments(filter),
    c
      .surveyors()
      .find(filter)
      .sort({ created_at: -1 })
      .skip(pageSkip(page))
      .limit(page.limit)
      .toArray(),
  ]);

  // Single batched fetch of settlement names across all rows on this page
  // (most surveyors share a small overlap of settlements anyway). We feed
  // it the resolved `settlements` field — that's the one with the actual
  // ObjectIds, regardless of whether the scope was set via communities,
  // settlements, or polling_station_codes.
  const allSettlementIds: ObjectId[] = [];
  const seen = new Set<string>();
  for (const s of items) {
    for (const sid of s.settlements ?? []) {
      const hex = sid.toHexString();
      if (!seen.has(hex)) {
        seen.add(hex);
        allSettlementIds.push(sid);
      }
    }
  }
  const chipMap = await buildSettlementChipMap(allSettlementIds);

  return ctx.json({
    page: pageMeta(page, total),
    items: items.map((s) => serializeSurveyor(s, chipMap)),
  });
});

adminSurveyorsRoutes.post('/', async (ctx) => {
  const body = CreateSurveyorBody.parse(await ctx.req.json());
  const existing = await c.surveyors().findOne({ firebase_uid: body.firebase_uid });
  if (existing) throw new HTTPException(409, { message: 'firebase_uid_exists' });

  const scope = scopeFromWire(body.scope);
  const resolved = await validateAndResolveScope(scope);
  if (!resolved.ok) return ctx.json(resolved.body, resolved.status);

  const now = new Date();
  const principal = ctx.get('principal');
  const doc: Omit<SurveyorDoc, '_id'> = {
    firebase_uid: body.firebase_uid,
    email: body.email,
    full_name: body.full_name,
    ...(body.phone !== undefined && { phone: body.phone }),
    status: body.status,
    scope: resolved.scope,
    settlements: resolved.settlements,
    response_counts: { total: 0, T1: 0, T2: 0, T3: 0 },
    notes: body.notes,
    created_at: now,
    settlements_updated_at: now,
    settlements_changed_by: principal.uid,
  };
  const res = await c.surveyors().insertOne(doc as SurveyorDoc);
  return ctx.json({ id: res.insertedId.toHexString() }, 201);
});

adminSurveyorsRoutes.patch('/:id', async (ctx) => {
  const principal = ctx.get('principal');
  const id = parseObjectId(ctx.req.param('id'), 'surveyor_id');
  const body = UpdateSurveyorBody.parse(await ctx.req.json());

  const update: Partial<SurveyorDoc> = {};
  if (body.status !== undefined) update.status = body.status;
  if (body.full_name !== undefined) update.full_name = body.full_name;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.scope !== undefined) {
    const scope = scopeFromWire(body.scope);
    const resolved = await validateAndResolveScope(scope);
    if (!resolved.ok) return ctx.json(resolved.body, resolved.status);
    update.scope = resolved.scope;
    update.settlements = resolved.settlements;
    // Audit fields ONLY when scope actually changes. A status-only or
    // notes-only PATCH leaves the assignments alone, so don't bump the
    // audit timestamp — that would defeat the violation classifier.
    update.settlements_updated_at = new Date();
    update.settlements_changed_by = principal.uid;
  }

  const result = await c
    .surveyors()
    .findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: 'after' });
  if (!result) throw new HTTPException(404, { message: 'surveyor_not_found' });
  const chipMap = await buildSettlementChipMap(result.settlements ?? []);
  return ctx.json(serializeSurveyor(result, chipMap));
});

adminSurveyorsRoutes.post('/:id/approve', async (ctx) => {
  const principal = ctx.get('principal');
  const id = parseObjectId(ctx.req.param('id'), 'surveyor_id');
  const body = ApproveSurveyorBody.parse(await ctx.req.json());

  const scope = scopeFromWire(body.scope);
  const resolved = await validateAndResolveScope(scope);
  if (!resolved.ok) return ctx.json(resolved.body, resolved.status);

  // Approval is THE moment a surveyor's scope first becomes meaningful
  // (registration starts with empty scope). Stamp the audit fields so
  // post-launch session-vs-scope timing checks have a definitive baseline.
  // Initial scope_active_map: every key true (default-active). Surveyor
  // can toggle off later, but on first-approval everything they got is on.
  const initialActiveMap: Record<string, boolean> = {};
  for (const k of scopeKeys(resolved.scope)) initialActiveMap[k] = true;

  const now = new Date();
  const result = await c.surveyors().findOneAndUpdate(
    { _id: id },
    {
      $set: {
        status: 'active',
        scope: resolved.scope,
        settlements: resolved.settlements,
        scope_active_map: initialActiveMap,
        approved_by: principal.uid,
        approved_at: now,
        settlements_updated_at: now,
        settlements_changed_by: principal.uid,
      },
      $unset: {
        rejected_by: '',
        rejected_at: '',
        rejection_reason: '',
        requested_scope: '',
        requested_scope_at: '',
      },
    },
    { returnDocument: 'after' },
  );
  if (!result) throw new HTTPException(404, { message: 'surveyor_not_found' });
  const approveChipMap = await buildSettlementChipMap(result.settlements ?? []);
  return ctx.json(serializeSurveyor(result, approveChipMap));
});

// ── Self-service scope-request approval (FE-SCOPE-SELF-SERVICE) ──────
// Distinct from the initial /approve flow above: this acts on an already-
// active surveyor's requested_scope, merging it into their existing scope.
// Approval rule (per UX spec): newly approved items default ACTIVE, and
// every previously granted item is forced INACTIVE in the same trip — the
// surveyor asked to switch focus, so this gives them a clean slate with
// only the new items lit up. Surveyor can toggle anything back on later.

adminSurveyorsRoutes.post('/:id/scope-request/approve', async (ctx) => {
  const principal = ctx.get('principal');
  const id = parseObjectId(ctx.req.param('id'), 'surveyor_id');

  const surveyor = await c.surveyors().findOne({ _id: id });
  if (!surveyor) throw new HTTPException(404, { message: 'surveyor_not_found' });
  const requested = surveyor.requested_scope;
  if (
    !requested ||
    ((requested.communities?.length ?? 0) === 0 &&
      (requested.settlements?.length ?? 0) === 0 &&
      (requested.polling_station_codes?.length ?? 0) === 0)
  ) {
    return ctx.json(
      { error: { code: 'no_pending_request', message_en: 'no_pending_request' } },
      400,
    );
  }

  // Re-validate the request at approval time — DB state may have changed
  // since the surveyor submitted (e.g. an admin renamed / deleted a
  // community).
  const validation = await validateScope(requested);
  if (!validation.ok) {
    return ctx.json(
      {
        error: {
          code: 'scope_entries_not_found',
          message_en: 'One or more scope entries do not exist',
          ...validation.missing,
        },
      },
      400,
    );
  }

  const merged = mergeScopes(surveyor.scope ?? {}, requested);
  const resolved = await resolveAccessibleSettlements(merged);

  // Build the new active map: existing keys → false, newly added → true.
  const newKeys = new Set(scopeKeys(requested));
  const newActiveMap: Record<string, boolean> = {};
  for (const k of scopeKeys(merged)) newActiveMap[k] = newKeys.has(k);

  const now = new Date();
  const result = await c.surveyors().findOneAndUpdate(
    { _id: id },
    {
      $set: {
        scope: merged,
        settlements: resolved.settlement_ids,
        scope_active_map: newActiveMap,
        settlements_updated_at: now,
        settlements_changed_by: principal.uid,
      },
      $unset: { requested_scope: '', requested_scope_at: '' },
    },
    { returnDocument: 'after' },
  );
  if (!result) throw new HTTPException(404, { message: 'surveyor_not_found' });
  const chipMap = await buildSettlementChipMap(result.settlements ?? []);
  return ctx.json(serializeSurveyor(result, chipMap));
});

adminSurveyorsRoutes.post('/:id/scope-request/reject', async (ctx) => {
  const id = parseObjectId(ctx.req.param('id'), 'surveyor_id');
  const result = await c
    .surveyors()
    .findOneAndUpdate(
      { _id: id },
      { $unset: { requested_scope: '', requested_scope_at: '' } },
      { returnDocument: 'after' },
    );
  if (!result) throw new HTTPException(404, { message: 'surveyor_not_found' });
  const chipMap = await buildSettlementChipMap(result.settlements ?? []);
  return ctx.json(serializeSurveyor(result, chipMap));
});

// GET /admin/surveyors/scope-requests — list all surveyors with a pending
// scope request, sorted oldest-first so the admin's review queue is FIFO.
adminSurveyorsRoutes.get('/scope-requests', async (ctx) => {
  const items = await c
    .surveyors()
    .find({ requested_scope_at: { $exists: true } })
    .sort({ requested_scope_at: 1 })
    .toArray();
  // Hydrate settlement chips for ALL involved settlements (existing scope
  // + requested) so the admin UI can show names without per-row fetches.
  const allSettlementIds: ObjectId[] = [];
  const seen = new Set<string>();
  for (const s of items) {
    const ids = [...(s.settlements ?? []), ...(s.requested_scope?.settlements ?? [])];
    for (const sid of ids) {
      const hex = sid.toHexString();
      if (!seen.has(hex)) {
        seen.add(hex);
        allSettlementIds.push(sid);
      }
    }
  }
  const chipMap = await buildSettlementChipMap(allSettlementIds);
  return ctx.json({ items: items.map((s) => serializeSurveyor(s, chipMap)) });
});

adminSurveyorsRoutes.post('/:id/reject', async (ctx) => {
  const principal = ctx.get('principal');
  const id = parseObjectId(ctx.req.param('id'), 'surveyor_id');
  const body = RejectSurveyorBody.parse(await ctx.req.json().catch(() => ({})));

  const result = await c.surveyors().findOneAndUpdate(
    { _id: id },
    {
      $set: {
        status: 'rejected',
        rejected_by: principal.uid,
        rejected_at: new Date(),
        rejection_reason: body.reason ?? null,
      },
    },
    { returnDocument: 'after' },
  );
  if (!result) throw new HTTPException(404, { message: 'surveyor_not_found' });
  const rejectChipMap = await buildSettlementChipMap(result.settlements ?? []);
  return ctx.json(serializeSurveyor(result, rejectChipMap));
});
