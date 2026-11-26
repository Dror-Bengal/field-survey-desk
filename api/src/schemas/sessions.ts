import { z } from 'zod';
import { GeoPointSchema, IsoDate, ObjectIdHex } from './common.js';

export const StartSessionBody = z.object({
  settlement_id: ObjectIdHex,
  login_geo: GeoPointSchema.nullable().optional(),
  login_accuracy_m: z.number().nonnegative().nullable().optional(),
  consent: z.object({
    gps: z.boolean(),
    granted_at: IsoDate,
  }),
  user_agent: z.string().max(500).default(''),
});

export const EndSessionBody = z.object({
  ended_at: IsoDate.optional(),
});
