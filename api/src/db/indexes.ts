import { logger } from '../logger.js';
import { c } from './collections.js';

export async function ensureIndexes(): Promise<void> {
  // Phase 1: ensure the new compound exists alongside the old single-field
  // index it will replace. createIndexes is idempotent — re-running is safe.
  await Promise.all([
    c.voters().createIndexes([
      { key: { polling_station_id: 1 }, name: 'voters_polling_station' },
      { key: { settlement_id: 1 }, name: 'voters_settlement' },
      { key: { 'parsed.address_key': 1 }, name: 'voters_address_key' },
      { key: { full_name_normalized: 1 }, name: 'voters_name_normalized' },
      { key: { dob: 1 }, name: 'voters_dob' },
    ]),

    c.pollingStations().createIndexes([
      { key: { code: 1 }, name: 'ps_code', unique: true },
      { key: { code_padded: 1 }, name: 'ps_code_padded' },
      { key: { settlement_id: 1 }, name: 'ps_settlement' },
      { key: { geo: '2dsphere' }, name: 'ps_geo' },
    ]),

    c.settlements().createIndexes([
      { key: { name_normalized: 1 }, name: 'settlement_name' },
      { key: { region: 1, community: 1 }, name: 'settlement_admin' },
      { key: { geo: '2dsphere' }, name: 'settlement_geo' },
    ]),

    c
      .candidates()
      .createIndexes([{ key: { active: 1, display_order: 1 }, name: 'candidate_active_order' }]),

    c.surveyors().createIndexes([
      { key: { firebase_uid: 1 }, name: 'surveyor_uid', unique: true },
      { key: { phone: 1 }, name: 'surveyor_phone' },
      // Covers /admin/surveyors?status= and /admin/surveyors/pending. The
      // sort direction on created_at can be either way; planner walks the
      // index forward or backward as needed.
      { key: { status: 1, created_at: 1 }, name: 'surveyor_status_created' },
    ]),

    c.admins().createIndexes([
      { key: { firebase_uid: 1 }, name: 'admin_uid', unique: true },
      { key: { email: 1 }, name: 'admin_email' },
    ]),

    c.surveySessions().createIndexes([
      { key: { surveyor_id: 1, started_at: -1 }, name: 'session_surveyor_time' },
      { key: { working_settlement_id: 1 }, name: 'session_settlement' },
    ]),

    c.responses().createIndexes([
      { key: { session_id: 1 }, name: 'response_session' },
      // Compound covers both the old { voter_id: 1 }-only lookups (via
      // index prefix) AND the sort-by-server_ts pattern used by /voters/:id
      // history and /addresses/:key/voters response join. The bare
      // response_voter is dropped below.
      { key: { voter_id: 1, server_ts: -1 }, name: 'response_voter_time' },
      { key: { surveyor_id: 1, server_ts: -1 }, name: 'response_surveyor_time' },
      { key: { settlement_id: 1, server_ts: -1 }, name: 'response_settlement_time' },
      { key: { server_ts: -1 }, name: 'response_time' },
      { key: { flags: 1 }, name: 'response_flags' },
      {
        key: { surveyor_id: 1, client_request_id: 1 },
        name: 'response_idempotency',
        unique: true,
        partialFilterExpression: { client_request_id: { $type: 'string' } },
      },
    ]),
  ]);

  // Phase 2: drop indexes that the new compounds make redundant. Tolerate
  // "index not found" so this is idempotent across re-runs and old/new
  // deployments.
  await Promise.all([
    c
      .responses()
      .dropIndex('response_voter')
      .catch(() => {}),
  ]);

  logger.info('indexes ensured');
}
