import type { ObjectId } from 'mongodb';

export type GeoPoint = { type: 'Point'; coordinates: [number, number] };
export type AgeBucket = 'child' | 'young' | 'adult' | 'senior';
export type Gender = 'M' | 'F' | 'U';
export type Tier = 'T1' | 'T2' | 'T3';

export type ResponseType =
  | 'named_voter'
  | 'inferred_voter'
  | 'demographic_only'
  | 'refused'
  | 'undecided'
  | 'will_not_vote'
  | 'not_home';

export interface VoterDoc {
  _id?: ObjectId;
  hh_seq: number;
  last_name: string;
  first_name: string;
  patronymic: string;
  full_name: string;
  full_name_normalized: string;
  dob: Date;
  age_bucket: AgeBucket;
  inferred_gender: Gender;
  gender_confidence: 'high' | 'medium' | 'low';
  raw_address: string;
  parsed: {
    street: string | null;
    street_modifier: string | null;
    house: string;
    apt: string | null;
    address_key: string;
  };
  polling_station_code: string;
  polling_station_id: ObjectId;
  settlement_id: ObjectId;
  community: string;
  region: string;
  source_file: string;
  created_at: Date;
}

export interface PollingStationDoc {
  _id?: ObjectId;
  code: string;
  code_padded: string;
  district_code: number;
  region: string;
  community: string;
  settlement: string;
  settlement_id: ObjectId;
  address_text: string;
  geo: GeoPoint | null;
  geocode_source: 'nominatim' | 'geonames' | 'manual' | null;
  geocode_confidence: number;
}

export interface SettlementDoc {
  _id?: ObjectId;
  name_local: string;
  name_en: string | null;
  name_normalized: string;
  community: string;
  region: string;
  geo: GeoPoint | null;
  polling_station_codes: string[];
  voter_count: number;
}

export type NonAnswerResponseType = 'undecided' | 'will_not_vote' | 'refused' | 'not_home';

export interface CandidateDoc {
  _id?: ObjectId;
  name_local: string;
  name_en: string;
  short_local: string;
  short_en: string;
  type: 'party' | 'non_answer';
  display_order: number;
  active: boolean;
  response_type?: NonAnswerResponseType;
}

export type SurveyorStatus = 'pending' | 'active' | 'suspended' | 'rejected';

export interface SurveyorResponseCounts {
  total: number;
  T1: number;
  T2: number;
  T3: number;
}

// Hierarchical scope for surveyor access. At least one of the three arrays
// must be non-empty (validated at the schema layer). `communities` are the
// string labels stored in SettlementDoc.community / VoterDoc.community —
// not ObjectIds — because that's how the rest of the codebase identifies
// communities. `polling_station_codes` are PollingStationDoc.code values.
// Settlements granted via community or station are resolved into the legacy
// `settlements` field at write time so /sessions enforcement keeps working
// during the BE-SCOPE-ENFORCEMENT transition.
export interface SurveyorScope {
  communities?: string[];
  settlements?: ObjectId[];
  polling_station_codes?: string[];
}

export interface SurveyorDoc {
  _id?: ObjectId;
  firebase_uid: string;
  email: string;
  full_name: string;
  phone?: string;
  status: SurveyorStatus;
  scope: SurveyorScope;
  /**
   * Resolved union of all settlement IDs the surveyor can access, derived
   * from `scope` at write time (approve / patch). Kept as a denormalized
   * field so /sessions enforcement and other read-paths can do a cheap
   * `$in` check without resolving communities and stations every time.
   * Drop this field in BE-SCOPE-ENFORCEMENT once /sessions reads `scope`.
   */
  settlements: ObjectId[];
  response_counts: SurveyorResponseCounts;
  notes: string;
  created_at: Date;
  approved_by?: string;
  approved_at?: Date;
  rejected_by?: string;
  rejected_at?: Date;
  rejection_reason?: string | null;
  /**
   * Audit trail for scope changes. Set whenever an admin runs
   * PATCH /admin/surveyors/:id with body.scope OR
   * POST /admin/surveyors/:id/approve. Field name preserved from the
   * pre-scope era (BE-TRACK-SETTLEMENTS-UPDATE) for backward compat with
   * existing audit scripts; semantics now cover the whole scope object.
   */
  settlements_updated_at?: Date;
  settlements_changed_by?: string;
  /**
   * Surveyor-initiated scope addition request. Empty / absent means no
   * pending request. Admin approves via POST /admin/surveyors/:id/
   * scope-request/approve, which merges into `scope` and clears this.
   * Same shape as `scope`; only items NOT already in `scope` are kept on
   * write (dedupe-on-submit).
   */
  requested_scope?: SurveyorScope;
  requested_scope_at?: Date;
  /**
   * Per-scope-item active flag controlled by the surveyor. Keys are
   * namespaced strings: `community:<name>`, `settlement:<hex>`,
   * `station:<code>`. Missing key = default-active = true. The surveyor
   * uses this to hide items from their own "Where are you working today?"
   * picker without un-assigning. Does not affect admin views.
   */
  scope_active_map?: Record<string, boolean>;
}

export interface AdminDoc {
  _id?: ObjectId;
  firebase_uid: string;
  email: string;
  full_name: string;
  role: 'owner' | 'admin';
  language: 'en';
}

export interface SurveySessionDoc {
  _id?: ObjectId;
  surveyor_id: ObjectId;
  working_settlement_id: ObjectId;
  started_at: Date;
  ended_at: Date | null;
  login_geo: GeoPoint | null;
  login_accuracy_m: number | null;
  consent: { gps: boolean; granted_at: Date };
  user_agent: string;
  /**
   * Snapshot of the polling station codes the surveyor's scope grants for
   * the working settlement, computed at POST /sessions time. Voter and
   * street queries filter by this list — the value is frozen for the
   * session's lifetime so a mid-session scope change does not silently
   * widen or narrow the surveyor's visible voters. Optional only because
   * BE-SCOPE-ENFORCEMENT predates legacy sessions; the addresses/streets
   * handlers fall back to "no station filter" when the field is missing.
   */
  polling_station_codes?: string[];
}

export interface ResponseDoc {
  _id?: ObjectId;
  session_id: ObjectId;
  surveyor_id: ObjectId;
  tier: Tier;
  voter_id: ObjectId | null;
  voter_polling_station_code: string | null;
  address_key: string;
  settlement_id: ObjectId;
  candidate_id: ObjectId | null;
  response_type: ResponseType;
  demographic: { gender: Gender; age_bucket: AgeBucket } | null;
  notes: string;
  client_geo: GeoPoint | null;
  client_accuracy_m: number | null;
  client_ts: Date;
  server_ts: Date;
  flags: string[];
  client_request_id?: string;
}
