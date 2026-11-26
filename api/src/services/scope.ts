import type { ObjectId } from 'mongodb';
import { c } from '../db/collections.js';
import type { SurveyorScope } from '../db/types.js';

export interface ResolvedScope {
  // Deduped union of settlement ObjectIds from the three scope arrays.
  // /sessions and /me read this.
  settlement_ids: ObjectId[];
}

export interface ScopeValidationFailure {
  missing_communities: string[];
  missing_settlements: string[];
  missing_polling_station_codes: string[];
}

export type ScopeValidationResult = { ok: true } | { ok: false; missing: ScopeValidationFailure };

// Verify every entry in the scope exists in the DB. Returns per-field
// missing arrays so the admin UI can highlight the offending fields. We
// don't short-circuit — admins want to see *all* invalid entries on one
// trip rather than fix-and-retry.
export async function validateScope(scope: SurveyorScope): Promise<ScopeValidationResult> {
  const missing_communities: string[] = [];
  const missing_settlements: string[] = [];
  const missing_polling_station_codes: string[] = [];

  if (scope.communities && scope.communities.length > 0) {
    const found = await c.settlements().distinct('community', {
      community: { $in: scope.communities },
    });
    const foundSet = new Set(found);
    for (const com of scope.communities) {
      if (!foundSet.has(com)) missing_communities.push(com);
    }
  }

  if (scope.settlements && scope.settlements.length > 0) {
    const docs = await c
      .settlements()
      .find({ _id: { $in: scope.settlements } }, { projection: { _id: 1 } })
      .toArray();
    const foundSet = new Set(docs.map((d) => d._id.toHexString()));
    for (const s of scope.settlements) {
      if (!foundSet.has(s.toHexString())) missing_settlements.push(s.toHexString());
    }
  }

  if (scope.polling_station_codes && scope.polling_station_codes.length > 0) {
    const docs = await c
      .pollingStations()
      .find({ code: { $in: scope.polling_station_codes } }, { projection: { code: 1 } })
      .toArray();
    const foundSet = new Set(docs.map((d) => d.code));
    for (const code of scope.polling_station_codes) {
      if (!foundSet.has(code)) missing_polling_station_codes.push(code);
    }
  }

  if (
    missing_communities.length === 0 &&
    missing_settlements.length === 0 &&
    missing_polling_station_codes.length === 0
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    missing: { missing_communities, missing_settlements, missing_polling_station_codes },
  };
}

// Resolve the scope into the union of settlement ObjectIds the surveyor
// can access. Used:
//   - at write time (approve/patch) to populate the legacy `settlements`
//     field for /sessions enforcement
//   - at /me read time to surface accessible_settlements
// Order: dedupe by hex string.
export async function resolveAccessibleSettlements(scope: SurveyorScope): Promise<ResolvedScope> {
  const ids = new Map<string, ObjectId>();

  if (scope.settlements && scope.settlements.length > 0) {
    for (const s of scope.settlements) ids.set(s.toHexString(), s);
  }

  if (scope.communities && scope.communities.length > 0) {
    const docs = await c
      .settlements()
      .find({ community: { $in: scope.communities } }, { projection: { _id: 1 } })
      .toArray();
    for (const d of docs) ids.set(d._id.toHexString(), d._id);
  }

  if (scope.polling_station_codes && scope.polling_station_codes.length > 0) {
    const docs = await c
      .pollingStations()
      .find({ code: { $in: scope.polling_station_codes } }, { projection: { settlement_id: 1 } })
      .toArray();
    for (const d of docs) ids.set(d.settlement_id.toHexString(), d.settlement_id);
  }

  return { settlement_ids: Array.from(ids.values()) };
}

// Compute the list of polling station codes a surveyor can see at a
// specific settlement, given their scope. This is what /sessions snapshots
// onto the session doc — once frozen, /addresses and /streets filter by it.
//
// Three grant paths, by precedence:
//   1. scope.settlements contains the settlement → all stations in it
//   2. scope.communities contains the settlement's community → all stations in it
//   3. scope.polling_station_codes intersected with this settlement's stations
//
// Path (1) and (2) preserve backward compat with pre-BE-SCOPE-ENFORCEMENT
// behavior: a surveyor approved for the whole settlement keeps seeing
// every voter in it. Path (3) is the new fine-grained mode — a surveyor
// granted only "1/3" sees no voters at "1/4" even though both stations
// share the same settlement_id.
//
// Returns [] if the settlement isn't covered by the scope at all (caller
// should already have rejected the session start in that case).
export async function resolveSessionStations(
  scope: SurveyorScope,
  settlementId: ObjectId,
): Promise<string[]> {
  const settlement = await c
    .settlements()
    .findOne({ _id: settlementId }, { projection: { community: 1, polling_station_codes: 1 } });
  if (!settlement) return [];
  const allStationsHere = settlement.polling_station_codes ?? [];

  if (scope.settlements?.some((s) => s.equals(settlementId))) {
    return allStationsHere;
  }
  if (scope.communities?.includes(settlement.community)) {
    return allStationsHere;
  }
  if (scope.polling_station_codes && scope.polling_station_codes.length > 0) {
    const grantedSet = new Set(scope.polling_station_codes);
    return allStationsHere.filter((c) => grantedSet.has(c));
  }
  return [];
}

// True iff scope has at least one non-empty array. Schema-layer refine
// uses this to enforce the "scope_required" invariant.
export function scopeIsNonEmpty(scope: SurveyorScope): boolean {
  return (
    (scope.communities?.length ?? 0) > 0 ||
    (scope.settlements?.length ?? 0) > 0 ||
    (scope.polling_station_codes?.length ?? 0) > 0
  );
}

// Namespaced flat keys for scope_active_map. Three kinds of items share one
// map, and the namespace prefix tells them apart.
export function communityKey(name: string): string {
  return `community:${name}`;
}
export function settlementKey(id: ObjectId): string {
  return `settlement:${id.toHexString()}`;
}
export function stationKey(code: string): string {
  return `station:${code}`;
}

// Enumerate every key in a scope. Order is fixed (communities → settlements →
// stations) so callers iterating with side effects get a stable sequence.
export function scopeKeys(scope: SurveyorScope): string[] {
  const out: string[] = [];
  for (const c of scope.communities ?? []) out.push(communityKey(c));
  for (const s of scope.settlements ?? []) out.push(settlementKey(s));
  for (const code of scope.polling_station_codes ?? []) out.push(stationKey(code));
  return out;
}

// Merge `incoming` into `base`, dropping any incoming entry that's already
// present in base. Used when an admin approves a surveyor's scope request:
// items the admin already granted shouldn't surface as "new approvals."
export function dedupeAgainst(incoming: SurveyorScope, base: SurveyorScope): SurveyorScope {
  const baseCommunities = new Set(base.communities ?? []);
  const baseSettlements = new Set((base.settlements ?? []).map((s) => s.toHexString()));
  const baseStations = new Set(base.polling_station_codes ?? []);

  const out: SurveyorScope = {};
  const c2 = (incoming.communities ?? []).filter((c) => !baseCommunities.has(c));
  if (c2.length > 0) out.communities = c2;
  const s2 = (incoming.settlements ?? []).filter((s) => !baseSettlements.has(s.toHexString()));
  if (s2.length > 0) out.settlements = s2;
  const p2 = (incoming.polling_station_codes ?? []).filter((p) => !baseStations.has(p));
  if (p2.length > 0) out.polling_station_codes = p2;
  return out;
}

// Filter a scope down to only items the surveyor has marked active. Items
// missing from the map default to true (active), so a brand-new surveyor
// with no map sees their full grant. Used at /me read time so the
// "today's picker" only shows settlements from grants the surveyor wants
// visible right now.
export function effectiveScope(
  scope: SurveyorScope,
  activeMap: Record<string, boolean> | undefined,
): SurveyorScope {
  const map = activeMap ?? {};
  const isActive = (k: string) => map[k] !== false;
  const out: SurveyorScope = {};
  const c2 = (scope.communities ?? []).filter((c) => isActive(communityKey(c)));
  if (c2.length > 0) out.communities = c2;
  const s2 = (scope.settlements ?? []).filter((s) => isActive(settlementKey(s)));
  if (s2.length > 0) out.settlements = s2;
  const p2 = (scope.polling_station_codes ?? []).filter((p) => isActive(stationKey(p)));
  if (p2.length > 0) out.polling_station_codes = p2;
  return out;
}

// Concatenate two scopes (no dedupe assumed — callers normally dedupeAgainst
// first). Useful when admin approves a request and we want the post-merge
// scope to store back.
export function mergeScopes(a: SurveyorScope, b: SurveyorScope): SurveyorScope {
  const communities = [...new Set([...(a.communities ?? []), ...(b.communities ?? [])])];
  const settlementsMap = new Map<string, ObjectId>();
  for (const s of a.settlements ?? []) settlementsMap.set(s.toHexString(), s);
  for (const s of b.settlements ?? []) settlementsMap.set(s.toHexString(), s);
  const polling_station_codes = [
    ...new Set([...(a.polling_station_codes ?? []), ...(b.polling_station_codes ?? [])]),
  ];

  const out: SurveyorScope = {};
  if (communities.length > 0) out.communities = communities;
  if (settlementsMap.size > 0) out.settlements = Array.from(settlementsMap.values());
  if (polling_station_codes.length > 0) out.polling_station_codes = polling_station_codes;
  return out;
}
