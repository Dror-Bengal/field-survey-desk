import { z } from 'zod';
import { ObjectIdHex } from './common.js';

export const RegisterSurveyorBody = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
});

// Surveyor self-submits a scope-addition request. Same triple-array shape
// as the admin's scope schema but without the "scope_required" refine —
// an empty body clears any pending request. Hard cap on per-array length
// keeps a misbehaving FE from posting thousands of entries.
export const ScopeRequestBody = z.object({
  communities: z.array(z.string().min(1).max(200)).max(500).optional(),
  settlements: z.array(ObjectIdHex).max(500).optional(),
  polling_station_codes: z.array(z.string().min(1).max(64)).max(500).optional(),
});

// Surveyor toggles a single grant active/inactive. Key shape is enforced
// here (community:<name> | settlement:<hex> | station:<code>) so the
// route handler doesn't have to re-validate.
export const ScopeActiveToggleBody = z.object({
  key: z
    .string()
    .min(3)
    .max(256)
    .regex(/^(community:|settlement:|station:).+/, 'invalid_scope_key'),
  active: z.boolean(),
});
