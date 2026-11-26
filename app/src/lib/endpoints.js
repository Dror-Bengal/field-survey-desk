// Typed wrappers around the backend routes (Hono, all under /api/v1).
//
// Most backend responses come wrapped in an envelope (`{ results: [...] }`,
// `{ candidates: [...] }`, `{ streets: [...] }`); these helpers unwrap so
// callers always see the natural shape.
//
// Each helper accepts an `opts` object with a `signal` so callers (useApi)
// can cancel in-flight requests on unmount.

import { request } from './api.js';

// ── Helpers ──────────────────────────────────────────────────────────

function buildQueryString(filters) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

// Convert a browser GeolocationPosition (or {lat,lng,accuracy}) into the
// GeoJSON Point the backend expects, plus the separate accuracy field.
// Returns { geo, accuracy } where geo is `{type:'Point',coordinates:[lng,lat]}`.
export function toGeoPoint(input) {
  if (!input) return { geo: null, accuracy: null };
  const lat = input.latitude ?? input.lat;
  const lng = input.longitude ?? input.lng;
  const accuracy = input.accuracy ?? null;
  if (typeof lat !== 'number' || typeof lng !== 'number') return { geo: null, accuracy: null };
  return {
    geo: { type: 'Point', coordinates: [lng, lat] },
    accuracy,
  };
}

// ── Surveyor: sessions ───────────────────────────────────────────────

/**
 * @param {{
 *   settlement_id: string,
 *   login_geo?: { type: 'Point', coordinates: [number, number] } | null,
 *   login_accuracy_m?: number | null,
 *   consent: { gps: boolean, granted_at: string },
 *   user_agent?: string,
 * }} body
 * @returns {Promise<{ session_id: string, started_at: string }>}
 */
export const sessionsCreate = (body, opts) =>
  request('/sessions', { method: 'POST', body, ...opts });

/**
 * @param {string} id
 * @param {{ ended_at?: string }} body
 * @returns {Promise<{ session_id: string, ended_at: string }>}
 */
export const sessionsEnd = (id, body = {}, opts) =>
  request(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body, ...opts });

// ── Surveyor: settlements / streets / addresses / voters ─────────────

/**
 * Backend requires q.length >= 3 OR a `near` (lat,lng) string.
 * @param {{ q?: string, near?: string, limit?: number }} [args]
 * @returns {Promise<Array<{
 *   id: string, name_local: string, name_en: string|null,
 *   community: string, region: string,
 *   geo: { lat: number, lng: number } | null,
 *   voter_count: number,
 * }>>}
 */
export const settlementsSearch = async (args = {}, opts) => {
  const env = await request(`/settlements${buildQueryString(args)}`, opts);
  return env?.results || [];
};

/**
 * @param {string} id
 * @returns {Promise<Array<{ street: string|null, houses: Array<{ house: string, address_key: string }> }>>}
 */
export const settlementGetStreets = async (id, opts) => {
  const env = await request(`/settlements/${encodeURIComponent(id)}/streets`, opts);
  return env?.streets || [];
};

/**
 * @param {string} addressKey
 * @returns {Promise<{
 *   address_key: string,
 *   voters: Array<{
 *     id: string, full_name: string, first_name: string, last_name: string,
 *     patronymic: string, age_bucket: string, inferred_gender: string,
 *     polling_station_code: string,
 *     last_response: { latest: string, response_type: string } | null
 *   }>
 * }>}
 */
export const addressVoters = (addressKey, opts) =>
  request(`/addresses/${encodeURIComponent(addressKey)}/voters`, opts);

/**
 * @param {string} id
 * @returns {Promise<Record<string, any>>}
 */
export const voterGet = (id, opts) =>
  request(`/voters/${encodeURIComponent(id)}`, opts);

/**
 * Scope-aware voter name search (BE-VOTER-SEARCH). Requires an active
 * session — the BE filters results to the surveyor's polling-station
 * scope frozen at session start.
 *
 * @param {{ q: string, limit?: number }} args
 * @returns {Promise<{
 *   results: Array<{
 *     id: string, full_name: string,
 *     age_bucket: string, gender: string,
 *     polling_station_code: string, address_key: string,
 *     street: string|null, street_modifier: string|null, house: string|null,
 *     last_response: { latest: string, response_type: string } | null,
 *   }>,
 *   total: number,
 *   truncated: boolean,
 * }>}
 */
export const voterSearch = async (args = {}, opts) => {
  const env = await request(`/voters/search${buildQueryString(args)}`, opts);
  return env || { results: [], total: 0, truncated: false };
};

// ── Surveyor: communities / polling stations (for scope self-service) ─

/**
 * Same wire shape as adminCommunitiesSearch; gated on any signed-in user.
 * @returns {Promise<Array<{ name: string, region: string, settlement_count: number }>>}
 */
export const communitiesSearch = async (args = {}, opts) => {
  const env = await request(`/communities${buildQueryString(args)}`, opts);
  return env?.results || [];
};

/**
 * Same wire shape as adminStationsSearch; gated on any signed-in user.
 * @returns {Promise<Array<{ code, settlement_id, settlement_name_local, settlement_name_en, region, district_code }>>}
 */
export const pollingStationsSearch = async (args = {}, opts) => {
  const env = await request(`/polling-stations${buildQueryString(args)}`, opts);
  return env?.results || [];
};

// ── Surveyor: candidates / responses / me ────────────────────────────

/**
 * @returns {Promise<Array<{
 *   id: string, name_local: string, name_en: string,
 *   short_local: string, short_en: string,
 *   type: 'party' | 'non_answer', display_order: number
 * }>>}
 */
export const candidatesList = async (opts) => {
  const env = await request('/candidates', opts);
  return env?.candidates || [];
};

/**
 * Backend response_type enum:
 *   'named_voter' | 'inferred_voter' | 'demographic_only' |
 *   'refused' | 'undecided' | 'will_not_vote' | 'not_home'
 *
 * T1/T2 require voter_id; T3 omits voter_id and requires `demographic`.
 * candidate_id is required for all tiers.
 *
 * @param {{
 *   session_id: string, candidate_id: string,
 *   tier: 'T1'|'T2'|'T3',
 *   voter_id?: string,
 *   address_key: string,
 *   response_type: string,
 *   demographic?: { gender: 'M'|'F'|'U', age_bucket: 'child'|'young'|'adult'|'senior' },
 *   notes?: string,
 *   client_geo?: { type: 'Point', coordinates: [number, number] } | null,
 *   client_accuracy_m?: number | null,
 *   client_ts: string,
 * }} body
 * @returns {Promise<{ response_id: string, server_ts: string, flags: string[] }>}
 */
export const responsesCreate = (body, opts) =>
  request('/responses', { method: 'POST', body, ...opts });

/**
 * Backend may return:
 *   200 { id, full_name, phone, status, stats, active_session }
 *   404 { error: { code: 'not_registered' } } (post BE-AUTH-PIVOT)
 *   403 { error: { code: 'no_role_assigned' | 'surveyor_suspended' } } (current backend)
 * Callers should branch on ApiError.{status, code} to decide register/pending/rejected.
 *
 * @returns {Promise<{
 *   id: string, full_name: string, phone: string, status: string,
 *   stats: { responses_today: number, settlements_today: number },
 *   active_session: { id: string, started_at: string, working_settlement_id: string } | null,
 *   rejection_reason?: string,
 * }>}
 */
// `as` lets a dual-role user (in both `admins` and `surveyors`) ask the BE
// for the surveyor view even though the BE defaults to admin-wins. The
// hint is silently ignored if the user doesn't have that record server-
// side, so a crafted call can't elevate permissions.
export const meGet = ({ as, ...opts } = {}) =>
  request(`/me${as ? `?as=${encodeURIComponent(as)}` : ''}`, opts);

/**
 * Self-serve registration. Backend creates a surveyor record with
 * status='pending' awaiting admin approval.
 *
 * @param {{ full_name: string, email: string }} body
 * @returns {Promise<{ id: string, status: 'pending' | 'active' | 'rejected' | 'suspended' }>}
 */
export const surveyorsRegister = (body, opts) =>
  request('/surveyors/register', { method: 'POST', body, ...opts });

/**
 * Surveyor self-submits a scope-addition request (FE-SCOPE-SELF-SERVICE).
 * Dedupes against current grant server-side; an empty body clears any
 * pending request.
 *
 * @param {{ communities?: string[], settlements?: string[], polling_station_codes?: string[] }} body
 * @returns {Promise<{ ok: true, cleared?: true }>}
 */
export const meScopeRequest = (body, opts) =>
  request('/surveyors/me/scope-request', { method: 'POST', body, ...opts });

/**
 * Surveyor toggles a single grant active/inactive. Key shape:
 * 'community:<name>' | 'settlement:<hex>' | 'station:<code>'.
 *
 * @param {{ key: string, active: boolean }} body
 * @returns {Promise<{ ok: true, key: string, active: boolean }>}
 */
export const meScopeActiveSet = (body, opts) =>
  request('/surveyors/me/scope-active', { method: 'PATCH', body, ...opts });

// ── Admin ────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{
 *   kpi: { total_responses: number, active_surveyors_today: number, settlements_covered: number, coverage_pct: number },
 *   responses_by_hour: Array<{ hour: string, count: number }>,
 *   responses_by_region: Array<{ region: string, count: number }>
 * }>}
 */
export const adminDashboard = (opts) => request('/admin/dashboard', opts);

/**
 * @param {{ candidate_id?: string, settlement_id?: string, region?: string,
 *           surveyor_id?: string, tier?: 'T1'|'T2'|'T3', flag?: string,
 *           from?: string, to?: string, page?: number, limit?: number }} [filters]
 * @returns {Promise<{ page: { page: number, limit: number, total: number, pages: number },
 *                     items: any[] }>}
 */
export const adminResponses = (filters = {}, opts) =>
  request(`/admin/responses${buildQueryString(filters)}`, opts);

/**
 * Returns the CSV body as text. Caller wraps in a Blob to trigger a download.
 * Backend route is /admin/responses/export (not ?format=csv).
 * @returns {Promise<string>}
 */
export const adminResponsesCsv = (filters = {}, opts) =>
  request(`/admin/responses/export${buildQueryString(filters)}`, opts);

/**
 * @param {{ status?: 'pending'|'active'|'suspended'|'rejected', page?: number, limit?: number }} [filters]
 * @returns {Promise<{ page: { page: number, limit: number, total: number, pages: number },
 *                     items: Array<{
 *                       id: string, firebase_uid: string, email: string,
 *                       full_name: string, phone: string|null, status: string,
 *                       settlements: string[],
 *                       response_counts: { total: number, T1: number, T2: number, T3: number },
 *                       notes: string, created_at: string,
 *                       approved_by: string|null, approved_at: string|null,
 *                       rejected_by: string|null, rejected_at: string|null,
 *                       rejection_reason: string|null,
 *                     }> }>}
 */
export const adminSurveyorsList = (filters = {}, opts) =>
  request(`/admin/surveyors${buildQueryString(filters)}`, opts);

/**
 * @returns {Promise<Array<{ id: string, firebase_uid: string, email: string, full_name: string, created_at: string }>>}
 */
export const adminSurveyorsPending = async (opts) => {
  const env = await request('/admin/surveyors/pending', opts);
  return env?.items || [];
};

export const adminSurveyorsCreate = (body, opts) =>
  request('/admin/surveyors', { method: 'POST', body, ...opts });

export const adminSurveyorsPatch = (id, body, opts) =>
  request(`/admin/surveyors/${encodeURIComponent(id)}`, { method: 'PATCH', body, ...opts });

/**
 * @param {string} id
 * @param {{ scope: { communities?: string[], settlements?: string[], polling_station_codes?: string[] } }} body
 *   At least one of the three arrays must be non-empty (BE refines as scope_required).
 */
export const adminSurveyorsApprove = (id, body, opts) =>
  request(`/admin/surveyors/${encodeURIComponent(id)}/approve`, { method: 'POST', body, ...opts });

/**
 * @param {string} id
 * @param {{ reason?: string }} body
 */
export const adminSurveyorsReject = (id, body = {}, opts) =>
  request(`/admin/surveyors/${encodeURIComponent(id)}/reject`, { method: 'POST', body, ...opts });

/**
 * Admin queue of surveyors with a pending self-service scope request.
 * @returns {Promise<{ items: any[] }>}
 */
export const adminScopeRequestsList = (opts) =>
  request('/admin/surveyors/scope-requests', opts);

export const adminScopeRequestApprove = (id, opts) =>
  request(`/admin/surveyors/${encodeURIComponent(id)}/scope-request/approve`,
          { method: 'POST', body: {}, ...opts });

export const adminScopeRequestReject = (id, opts) =>
  request(`/admin/surveyors/${encodeURIComponent(id)}/scope-request/reject`,
          { method: 'POST', body: {}, ...opts });

/**
 * Admin-side settlement search. Mirrors the surveyor /settlements shape.
 * @returns {Promise<Array<{ id, name_local, name_en, community, region, geo, voter_count }>>}
 */
export const adminSettlementsSearch = async (args = {}, opts) => {
  const env = await request(`/admin/settlements${buildQueryString(args)}`, opts);
  return env?.results || [];
};

/**
 * Hydrate the full settlement records for a known set of ids. Used by the
 * "Edit assigned settlements" modal to seed the chip list from the surveyor's
 * existing assignments. Backend supports comma-joined `?ids=` (BE-SETTLEMENTS-BY-IDS).
 * Returns [] when called with an empty array (skips the network round trip).
 *
 * @param {string[]} ids
 * @returns {Promise<Array<{ id, name_local, name_en, community, region, geo, voter_count }>>}
 */
export const adminSettlementsByIds = async (ids, opts) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const env = await request(`/admin/settlements${buildQueryString({ ids: ids.join(',') })}`, opts);
  return env?.results || [];
};

/**
 * Community search for the scope picker. Communities aren't a separate
 * collection — they're a denormalized field on settlements — so the BE
 * aggregates distinct names with a settlement count attached.
 *
 * @returns {Promise<Array<{ name: string, region: string, settlement_count: number }>>}
 */
export const adminCommunitiesSearch = async (args = {}, opts) => {
  const env = await request(`/admin/communities${buildQueryString(args)}`, opts);
  return env?.results || [];
};

/**
 * Hydrate community records by exact names. Used to restore chips when an
 * admin reopens an Edit modal whose surveyor has scope.communities set.
 *
 * @param {string[]} names
 * @returns {Promise<Array<{ name, region, settlement_count }>>}
 */
export const adminCommunitiesByNames = async (names, opts) => {
  if (!Array.isArray(names) || names.length === 0) return [];
  const env = await request(`/admin/communities${buildQueryString({ names: names.join(',') })}`, opts);
  return env?.results || [];
};

/**
 * Polling-station search. Returns enough context (settlement name, region)
 * for the admin to disambiguate stations that share a code prefix across
 * different settlements.
 *
 * @returns {Promise<Array<{ code, settlement_id, settlement_name_local, settlement_name_en, region, district_code }>>}
 */
export const adminStationsSearch = async (args = {}, opts) => {
  const env = await request(`/admin/polling-stations${buildQueryString(args)}`, opts);
  return env?.results || [];
};

/**
 * Hydrate polling-station records by exact codes. Mirror of byNames for the
 * stations tab of the scope picker.
 *
 * @param {string[]} codes
 * @returns {Promise<Array<{ code, settlement_id, settlement_name_local, settlement_name_en, region, district_code }>>}
 */
export const adminStationsByCodes = async (codes, opts) => {
  if (!Array.isArray(codes) || codes.length === 0) return [];
  const env = await request(`/admin/polling-stations${buildQueryString({ codes: codes.join(',') })}`, opts);
  return env?.results || [];
};

export const adminCandidatesList = (opts) => request('/admin/candidates', opts);
export const adminCandidatesCreate = (body, opts) =>
  request('/admin/candidates', { method: 'POST', body, ...opts });
export const adminCandidatesPatch = (id, body, opts) =>
  request(`/admin/candidates/${encodeURIComponent(id)}`, { method: 'PATCH', body, ...opts });
export const adminCandidatesDelete = (id, confirm, opts) =>
  request(
    `/admin/candidates/${encodeURIComponent(id)}${buildQueryString({ confirm })}`,
    { method: 'DELETE', ...opts },
  );

/** @returns {Promise<{ page: PageMeta, items: any[] }>} */
export const adminSessionsList = (filters = {}, opts) =>
  request(`/admin/sessions${buildQueryString(filters)}`, opts);
