import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { c } from '../../db/collections.js';
import type { SurveySessionDoc, SurveyorScope } from '../../db/types.js';
import { parseObjectId } from '../../lib/objectid.js';
import { requireFirebaseUser, requireSurveyor } from '../../middleware/auth.js';
import { EndSessionBody, StartSessionBody } from '../../schemas/sessions.js';
import { resolveAccessibleSettlements, resolveSessionStations } from '../../services/scope.js';
import type { App } from '../../types.js';

export const sessionsRoutes = new Hono<App>();

sessionsRoutes.use('*', requireFirebaseUser, requireSurveyor());

sessionsRoutes.post('/', async (ctx) => {
  const principal = ctx.get('principal');
  if (!principal.surveyor_id) throw new HTTPException(403, { message: 'no_surveyor_id' });

  const body = StartSessionBody.parse(await ctx.req.json());
  const settlementId = parseObjectId(body.settlement_id, 'settlement_id');

  const settlement = await c.settlements().findOne({ _id: settlementId });
  if (!settlement) throw new HTTPException(404, { message: 'settlement_not_found' });

  // Read scope authoritatively. Pre-BE-SCOPE-DATA-MODEL legacy docs (which
  // the migration handles, but we keep the fallback for belt-and-braces)
  // wrap their `settlements` array as `scope.settlements`. We re-fetch the
  // surveyor doc rather than caching on the principal so the scope check
  // sees revocations within a single session lifetime.
  const surveyorDoc = await c.surveyors().findOne({ _id: principal.surveyor_id });
  const scope: SurveyorScope = surveyorDoc?.scope ?? {
    settlements: surveyorDoc?.settlements ?? [],
  };

  const accessible = await resolveAccessibleSettlements(scope);
  const assigned = accessible.settlement_ids.some((s) => s.equals(settlementId));
  if (!assigned) {
    return ctx.json(
      {
        error: {
          code: 'settlement_not_assigned',
          message_en: 'Surveyor is not assigned to this settlement',
          settlement_id: settlementId.toHexString(),
          assigned_settlements: accessible.settlement_ids.map((s) => s.toHexString()),
        },
      },
      403,
    );
  }

  // Freeze the station list at session-start time. A mid-session scope
  // change must NOT silently widen/narrow what voters the surveyor sees —
  // that would defeat the audit trail. Tomorrow's session sees tomorrow's
  // scope.
  const stationCodes = await resolveSessionStations(scope, settlementId);

  const doc: Omit<SurveySessionDoc, '_id'> = {
    surveyor_id: principal.surveyor_id,
    working_settlement_id: settlementId,
    started_at: new Date(),
    ended_at: null,
    login_geo: body.login_geo ?? null,
    login_accuracy_m: body.login_accuracy_m ?? null,
    consent: body.consent,
    user_agent: body.user_agent,
    polling_station_codes: stationCodes,
  };
  const res = await c.surveySessions().insertOne(doc as SurveySessionDoc);
  return ctx.json({
    session_id: res.insertedId.toHexString(),
    started_at: doc.started_at,
    polling_station_codes: stationCodes,
  });
});

sessionsRoutes.patch('/:id', async (ctx) => {
  const principal = ctx.get('principal');
  const sessionId = parseObjectId(ctx.req.param('id'), 'session_id');
  const body = EndSessionBody.parse(await ctx.req.json().catch(() => ({})));

  const result = await c.surveySessions().findOneAndUpdate(
    // ended_at: null filter prevents re-ending an already-closed session.
    // The only path to mutate ended_at is via the open-session match.
    { _id: sessionId, surveyor_id: principal.surveyor_id, ended_at: null },
    { $set: { ended_at: body.ended_at ?? new Date() } },
    { returnDocument: 'after' },
  );
  if (!result) {
    // Disambiguate: is the session already closed (409) or genuinely
    // not found / not ours (404)?
    const existing = await c
      .surveySessions()
      .findOne({ _id: sessionId, surveyor_id: principal.surveyor_id });
    if (existing?.ended_at) {
      return ctx.json(
        {
          error: {
            code: 'session_already_ended',
            message_en: 'Session is already ended',
            ended_at: existing.ended_at,
          },
        },
        409,
      );
    }
    throw new HTTPException(404, { message: 'session_not_found' });
  }
  return ctx.json({ session_id: result._id.toHexString(), ended_at: result.ended_at });
});
