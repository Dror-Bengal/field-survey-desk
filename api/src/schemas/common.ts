import { z } from 'zod';

export const GeoPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
});

export const ObjectIdHex = z.string().regex(/^[a-f0-9]{24}$/i, 'invalid_object_id');

export const IsoDate = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

export const NearQuery = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'expected "lat,lng"')
  .transform((s) => {
    const [lat, lng] = s.split(',').map(Number) as [number, number];
    return { lat, lng };
  })
  .refine((p) => p.lat >= -90 && p.lat <= 90, { message: 'lat_out_of_range' })
  .refine((p) => p.lng >= -180 && p.lng <= 180, { message: 'lng_out_of_range' });
