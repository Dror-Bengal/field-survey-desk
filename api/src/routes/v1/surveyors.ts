import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { c } from '../../db/collections.js';
import type { SurveyorDoc, SurveyorScope } from '../../db/types.js';
import { parseObjectId } from '../../lib/objectid.js';
import { requireFirebaseUser, requireSurveyor } from '../../middleware/auth.js';
import {
  RegisterSurveyorBody,
  ScopeActiveToggleBody,
  ScopeRequestBody,
} from '../../schemas/surveyors.js';
import {
  communityKey,
  dedupeAgainst,
  scopeIsNonEmpty,
  settlementKey,
  stationKey,
  validateScope,
} from '../../services/scope.js';
import type { App } from '../../types.js';

export const surveyorsRoutes = new Hono<App>();

surveyorsRoutes.use('*', requireFirebaseUser);

surveyorsRoutes.post('/register', async (ctx) => {
  const principal = ctx.get('principal');
  const body = RegisterSurveyorBody.parse(await ctx.req.json());

  if (!principal.email || body.email.toLowerCase() !== principal.email.toLowerCase()) {
    throw new HTTPException(400, { message: 'email_token_mismatch' });
  }

  const existing = await c.surveyors().findOne({ firebase_uid: principal.uid });
  if (existing) {
    return ctx.json(
      {
        error: {
          code: 'already_registered',
          message_en: 'already_registered',
          status: existing.status,
          ...(existing.rejection_reason && { rejection_reason: existing.rejection_reason }),
        },
      },
      409,
    );
  }

  // Self-register starts with an empty scope. The admin assigns one (and
  // populates the resolved `settlements` field) at /approve time.
  const doc: Omit<SurveyorDoc, '_id'> = {
    firebase_uid: principal.uid,
    email: principal.email,
    full_name: body.full_name,
    status: 'pending',
    scope: {},
    settlements: [],
    response_counts: { total: 0, T1: 0, T2: 0, T3: 0 },
    notes: '',
    created_at: new Date(),
  };
  const res = await c.surveyors().insertOne(doc as SurveyorDoc);
  return ctx.json({ id: res.insertedId.toHexString(), status: 'pending' }, 201);
});

// ── Self-service scope management (FE-SCOPE-SELF-SERVICE) ────────────
// Active surveyors can:
//   1. Submit a scope-addition request (POST /me/scope-request).
//   2. Toggle a granted scope item active/inactive (PATCH /me/scope-active).
// Both routes require an active surveyor record. They live under the
// surveyors router (not /me) so the auth middleware can use requireSurveyor
// for the active-status gate.

const meScopeRoutes = new Hono<App>();
meScopeRoutes.use('*', requireSurveyor());

// POST /surveyors/me/scope-request
// Body shape mirrors the admin scope (communities + settlements + stations).
// Dedupes against the surveyor's already-granted scope so the pending
// request only contains net-new entries. An empty post (or post that
// dedupes to empty) clears any existing request.
meScopeRoutes.post('/scope-request', async (ctx) => {
  const principal = ctx.get('principal');
  const body = ScopeRequestBody.parse(await ctx.req.json().catch(() => ({})));

  // The request body is permissive; convert to DB shape (ObjectId for
  // settlements) before dedupe / validate.
  const requested: SurveyorScope = {};
  if (body.communities && body.communities.length > 0) requested.communities = body.communities;
  if (body.settlements && body.settlements.length > 0) {
    requested.settlements = body.settlements.map((s) => parseObjectId(s, 'settlement_id'));
  }
  if (body.polling_station_codes && body.polling_station_codes.length > 0) {
    requested.polling_station_codes = body.polling_station_codes;
  }

  const surveyor = await c.surveyors().findOne({ firebase_uid: principal.uid });
  if (!surveyor) throw new HTTPException(404, { message: 'surveyor_not_found' });

  const deduped = dedupeAgainst(requested, surveyor.scope ?? {});

  if (!scopeIsNonEmpty(deduped)) {
    await c
      .surveyors()
      .updateOne(
        { _id: surveyor._id },
        { $unset: { requested_scope: '', requested_scope_at: '' } },
      );
    return ctx.json({ ok: true, cleared: true });
  }

  // Validate the deduped request against the DB — the surveyor can't
  // request entries that don't exist (catches typos / stale FE data).
  const validation = await validateScope(deduped);
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

  await c
    .surveyors()
    .updateOne(
      { _id: surveyor._id },
      { $set: { requested_scope: deduped, requested_scope_at: new Date() } },
    );
  return ctx.json({ ok: true });
});

// PATCH /surveyors/me/scope-active
// Toggle a single grant on/off. The key must point to an item actually in
// the surveyor's CURRENT scope (not requested_scope) — otherwise an
// attacker could pre-poison the map with keys that later get granted.
meScopeRoutes.patch('/scope-active', async (ctx) => {
  const principal = ctx.get('principal');
  const body = ScopeActiveToggleBody.parse(await ctx.req.json());

  const surveyor = await c.surveyors().findOne({ firebase_uid: principal.uid });
  if (!surveyor) throw new HTTPException(404, { message: 'surveyor_not_found' });

  const scope: SurveyorScope = surveyor.scope ?? {};
  const validKeys = new Set<string>();
  for (const com of scope.communities ?? []) validKeys.add(communityKey(com));
  for (const s of scope.settlements ?? []) validKeys.add(settlementKey(s));
  for (const code of scope.polling_station_codes ?? []) validKeys.add(stationKey(code));

  if (!validKeys.has(body.key)) {
    return ctx.json(
      {
        error: {
          code: 'scope_key_not_granted',
          message_en: 'That scope item is not in your current grant',
        },
      },
      400,
    );
  }

  // Store at scope_active_map.<key>. Mongo dot-path update so we don't
  // overwrite sibling toggles.
  await c
    .surveyors()
    .updateOne({ _id: surveyor._id }, { $set: { [`scope_active_map.${body.key}`]: body.active } });

  return ctx.json({ ok: true, key: body.key, active: body.active });
});

surveyorsRoutes.route('/me', meScopeRoutes);
