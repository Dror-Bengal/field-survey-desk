import { HTTPException } from 'hono/http-exception';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { normalize } from '../lib/normalize.js';
import { c } from '../db/collections.js';
import { NearQuery, ObjectIdHex } from '../schemas/common.js';

const MAX_IDS = 100;

export const SettlementSearchQuery = z.object({
  q: z.string().trim().optional(),
  near: NearQuery.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  /**
   * Comma-separated list of settlement ObjectId hex strings. When present
   * AND non-empty, takes precedence over `q` and `near` — those filters are
   * ignored. Capped at 100 entries; the service throws 400 too_many_ids
   * above the cap. Each entry must be a valid 24-char hex ObjectId; zod
   * rejects malformed entries with 400 validation_error.
   */
  ids: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(ObjectIdHex))
    .optional(),
});

export type SettlementSearchInput = z.infer<typeof SettlementSearchQuery>;

export interface SettlementResult {
  id: string;
  name_local: string;
  name_en: string | null;
  community: string;
  region: string;
  geo: { lat: number; lng: number } | null;
  voter_count: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serialize(s: {
  _id: { toHexString(): string };
  name_local: string;
  name_en: string | null;
  community: string;
  region: string;
  geo: { coordinates: [number, number] } | null;
  voter_count: number;
}): SettlementResult {
  return {
    id: s._id.toHexString(),
    name_local: s.name_local,
    name_en: s.name_en,
    community: s.community,
    region: s.region,
    geo: s.geo ? { lat: s.geo.coordinates[1], lng: s.geo.coordinates[0] } : null,
    voter_count: s.voter_count,
  };
}

export async function searchSettlements(
  input: SettlementSearchInput,
): Promise<{ results: SettlementResult[] }> {
  // ids takes precedence over q/near. No pagination — return every match.
  if (input.ids && input.ids.length > 0) {
    if (input.ids.length > MAX_IDS) {
      throw new HTTPException(400, { message: 'too_many_ids' });
    }
    const objectIds = input.ids.map((s) => new ObjectId(s));
    const docs = await c
      .settlements()
      .find({ _id: { $in: objectIds } })
      .toArray();
    return { results: docs.map(serialize) };
  }

  if (input.near) {
    const docs = await c
      .settlements()
      .find({
        geo: {
          $near: {
            $geometry: { type: 'Point', coordinates: [input.near.lng, input.near.lat] },
            $maxDistance: 50_000,
          },
        },
      })
      .limit(input.limit)
      .toArray();
    return { results: docs.map(serialize) };
  }

  if (input.q && input.q.length >= 3) {
    const norm = normalize(input.q);
    const docs = await c
      .settlements()
      .find({ name_normalized: { $regex: `^${escapeRegex(norm)}` } })
      .limit(input.limit)
      .toArray();
    return { results: docs.map(serialize) };
  }

  return { results: [] };
}
