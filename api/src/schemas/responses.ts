import { z } from 'zod';
import { GeoPointSchema, IsoDate, ObjectIdHex } from './common.js';

const Demographic = z.object({
  gender: z.enum(['M', 'F', 'U']),
  age_bucket: z.enum(['child', 'young', 'adult', 'senior']),
});

const ResponseTypeEnum = z.enum([
  'named_voter',
  'inferred_voter',
  'demographic_only',
  'refused',
  'undecided',
  'will_not_vote',
  'not_home',
]);

export const CreateResponseBody = z
  .object({
    session_id: ObjectIdHex,
    tier: z.enum(['T1', 'T2', 'T3']),
    voter_id: ObjectIdHex.nullable().optional(),
    // Address keys are pipe-separated structural identifiers built by
    // etl/lib/address.ts buildAddressKey(): currently 4 segments
    //   <settlement>|<street>|<street_modifier>|<house>
    // (street_modifier may be empty for main-street entries). Reject any
    // string that doesn't have at least 2 separators — guards against
    // garbage values like "a" or "test" that have slipped through during
    // E2E harness debugging. The first segment must be non-empty (every
    // real address belongs to a normalised settlement).
    address_key: z
      .string()
      .min(1)
      .max(500)
      .regex(/^[^|]+(\|[^|]*){2,}$/, 'invalid_address_key'),
    candidate_id: ObjectIdHex.nullable().optional(),
    response_type: ResponseTypeEnum,
    demographic: Demographic.nullable().optional(),
    notes: z.string().max(2000).default(''),
    client_geo: GeoPointSchema.nullable().optional(),
    client_accuracy_m: z.number().nonnegative().nullable().optional(),
    client_ts: IsoDate,
    client_request_id: z.string().uuid().max(64).optional(),
  })
  .refine((d) => (d.tier === 'T3' ? d.demographic != null : true), {
    message: 'demographic_required_for_T3',
    path: ['demographic'],
  })
  .refine((d) => (d.tier === 'T3' ? !d.voter_id : !!d.voter_id), {
    message: 'tier_voter_id_mismatch',
    path: ['voter_id'],
  })
  .refine((d) => (d.tier === 'T3' ? !d.candidate_id : !!d.candidate_id), {
    message: 'tier_candidate_id_mismatch',
    path: ['candidate_id'],
  });
