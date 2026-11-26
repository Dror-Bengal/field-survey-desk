import { z } from 'zod';
import { ObjectIdHex } from './common.js';

export const ResponseFilters = z.object({
  candidate_id: ObjectIdHex.optional(),
  settlement_id: ObjectIdHex.optional(),
  region: z.string().optional(),
  surveyor_id: ObjectIdHex.optional(),
  tier: z.enum(['T1', 'T2', 'T3']).optional(),
  flag: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const SurveyorStatusEnum = z.enum(['pending', 'active', 'suspended', 'rejected']);

// Hierarchical scope: at least one of the three arrays must be non-empty.
// The refine kicks in *after* parsing, so the inner shape is permissive
// (each field optional) and the cross-field rule is the actual constraint.
export const SurveyorScopeSchema = z
  .object({
    communities: z.array(z.string().min(1).max(200)).optional(),
    settlements: z.array(ObjectIdHex).optional(),
    polling_station_codes: z.array(z.string().min(1).max(64)).optional(),
  })
  .refine(
    (s) =>
      (s.communities?.length ?? 0) > 0 ||
      (s.settlements?.length ?? 0) > 0 ||
      (s.polling_station_codes?.length ?? 0) > 0,
    { message: 'scope_required' },
  );

export const CreateSurveyorBody = z.object({
  firebase_uid: z.string().min(1),
  email: z.string().email().max(254),
  full_name: z.string().min(1).max(200),
  phone: z
    .string()
    .regex(/^\+\d{6,15}$/, 'expected_E164')
    .optional(),
  status: SurveyorStatusEnum.default('active'),
  scope: SurveyorScopeSchema,
  notes: z.string().max(2000).default(''),
});

// Update is partial — `scope` is the only way to change assignments now.
// status / full_name / notes can be tweaked without touching scope.
export const UpdateSurveyorBody = z.object({
  status: SurveyorStatusEnum.optional(),
  full_name: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
  scope: SurveyorScopeSchema.optional(),
});

export const ApproveSurveyorBody = z.object({
  scope: SurveyorScopeSchema,
});

export const RejectSurveyorBody = z.object({
  reason: z.string().max(500).optional(),
});

export const SurveyorListQuery = z.object({
  status: SurveyorStatusEnum.optional(),
});

const NonAnswerResponseTypeEnum = z.enum(['undecided', 'will_not_vote', 'refused', 'not_home']);

export const CandidateBody = z
  .object({
    name_local: z.string().min(1).max(200),
    name_en: z.string().min(1).max(200),
    short_local: z.string().max(16).default(''),
    short_en: z.string().max(16).default(''),
    type: z.enum(['party', 'non_answer']),
    display_order: z.number().int(),
    active: z.boolean().default(true),
    response_type: NonAnswerResponseTypeEnum.optional(),
  })
  .refine((d) => (d.type === 'party' ? d.short_local.length > 0 && d.short_en.length > 0 : true), {
    message: 'short_local_and_short_en_required_for_parties',
    path: ['short_local'],
  })
  .refine(
    (d) =>
      d.type === 'non_answer' ? d.response_type !== undefined : d.response_type === undefined,
    {
      message: 'response_type_required_for_non_answer_only',
      path: ['response_type'],
    },
  );

export const UpdateCandidateBody = z
  .object({
    name_local: z.string().min(1).max(200).optional(),
    name_en: z.string().min(1).max(200).optional(),
    short_local: z.string().max(16).optional(),
    short_en: z.string().max(16).optional(),
    type: z.enum(['party', 'non_answer']).optional(),
    display_order: z.number().int().optional(),
    active: z.boolean().optional(),
    response_type: NonAnswerResponseTypeEnum.optional(),
  })
  .refine(
    (d) =>
      d.type !== 'party' ||
      ((d.short_local === undefined || d.short_local.length > 0) &&
        (d.short_en === undefined || d.short_en.length > 0)),
    { message: 'short_local_and_short_en_required_for_parties', path: ['short_local'] },
  );

export const DeleteAllConfirm = z.object({
  confirm: z.literal('DELETE_ALL_RESPONSES'),
});
