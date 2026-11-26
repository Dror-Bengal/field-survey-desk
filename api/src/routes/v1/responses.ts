import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ObjectId } from 'mongodb';
import { c } from '../../db/collections.js';
import type { ResponseDoc } from '../../db/types.js';
import { computeFlags } from '../../lib/flags.js';
import { parseObjectId } from '../../lib/objectid.js';
import { requireFirebaseUser, requireSurveyor } from '../../middleware/auth.js';
import { CreateResponseBody } from '../../schemas/responses.js';
import type { App } from '../../types.js';

export const responsesRoutes = new Hono<App>();

responsesRoutes.use('*', requireFirebaseUser, requireSurveyor());

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

async function findIdempotentReplay(
  surveyorId: ObjectId,
  clientRequestId: string,
): Promise<ResponseDoc | null> {
  return c.responses().findOne({ surveyor_id: surveyorId, client_request_id: clientRequestId });
}

responsesRoutes.post('/', async (ctx) => {
  const principal = ctx.get('principal');
  if (!principal.surveyor_id) throw new HTTPException(403, { message: 'no_surveyor_id' });

  const body = CreateResponseBody.parse(await ctx.req.json());

  // Idempotent replay: if the client supplied a request id and we already
  // have a matching response, return it without re-validating session etc.
  if (body.client_request_id) {
    const replay = await findIdempotentReplay(principal.surveyor_id, body.client_request_id);
    if (replay) {
      return ctx.json(
        {
          response_id: replay._id!.toHexString(),
          server_ts: replay.server_ts,
          flags: replay.flags,
          idempotent_replay: true,
        },
        201,
      );
    }
  }

  const sessionId = parseObjectId(body.session_id, 'session_id');
  const candidateId = body.candidate_id ? parseObjectId(body.candidate_id, 'candidate_id') : null;
  const voterId = body.voter_id ? parseObjectId(body.voter_id, 'voter_id') : null;

  const session = await c.surveySessions().findOne({
    _id: sessionId,
    surveyor_id: principal.surveyor_id,
  });
  if (!session) throw new HTTPException(404, { message: 'session_not_found' });
  if (session.ended_at) throw new HTTPException(409, { message: 'session_ended' });

  const settlement = await c.settlements().findOne({ _id: session.working_settlement_id });
  if (!settlement) throw new HTTPException(404, { message: 'settlement_not_found' });

  if (candidateId) {
    const candidate = await c.candidates().findOne({ _id: candidateId, active: true });
    if (!candidate) throw new HTTPException(404, { message: 'candidate_not_found' });
    if (
      candidate.type === 'non_answer' &&
      candidate.response_type !== undefined &&
      candidate.response_type !== body.response_type
    ) {
      throw new HTTPException(400, { message: 'mismatched_response_type' });
    }
  }

  // Use the same frozen assignment as the household list for all visit types.
  const household = {
    settlement_id: session.working_settlement_id,
    'parsed.address_key': body.address_key,
    ...(session.polling_station_codes ? { polling_station_code: { $in: session.polling_station_codes } } : {}),
  };
  const resident = await c.voters().findOne(
    { ...household, ...(voterId ? { _id: voterId } : {}) },
    { projection: { polling_station_code: 1 } },
  );
  if (!resident) throw new HTTPException(404, { message: 'household_or_resident_not_found' });
  const voterPollingCode = voterId ? resident.polling_station_code : null;

  const serverTs = new Date();
  const flags = computeFlags({
    clientGeo: body.client_geo ?? null,
    clientAccuracyM: body.client_accuracy_m ?? null,
    clientTs: body.client_ts,
    serverTs,
    workingSettlementGeo: settlement.geo,
    workingSettlementCodes: settlement.polling_station_codes,
    voterPollingCode,
  });

  const doc: Omit<ResponseDoc, '_id'> = {
    session_id: sessionId,
    surveyor_id: principal.surveyor_id,
    tier: body.tier,
    voter_id: voterId,
    voter_polling_station_code: voterPollingCode,
    address_key: body.address_key,
    settlement_id: session.working_settlement_id,
    candidate_id: candidateId,
    response_type: body.response_type,
    demographic: body.demographic ?? null,
    notes: body.notes,
    client_geo: body.client_geo ?? null,
    client_accuracy_m: body.client_accuracy_m ?? null,
    client_ts: body.client_ts,
    server_ts: serverTs,
    flags,
    ...(body.client_request_id && { client_request_id: body.client_request_id }),
  };

  try {
    const res = await c.responses().insertOne(doc as ResponseDoc);
    return ctx.json({ response_id: res.insertedId.toHexString(), server_ts: serverTs, flags }, 201);
  } catch (err) {
    // Race: another concurrent request with the same client_request_id won the
    // insert between our findOne above and our insert here. The unique partial
    // index throws 11000; resolve by returning the now-existing doc.
    if (isDuplicateKeyError(err) && body.client_request_id) {
      const replay = await findIdempotentReplay(principal.surveyor_id, body.client_request_id);
      if (replay) {
        return ctx.json(
          {
            response_id: replay._id!.toHexString(),
            server_ts: replay.server_ts,
            flags: replay.flags,
            idempotent_replay: true,
          },
          201,
        );
      }
    }
    throw err;
  }
});
