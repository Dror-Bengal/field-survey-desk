import { Hono } from 'hono';
import type { ObjectId } from 'mongodb';
import { c } from '../../db/collections.js';
import type { SurveyorScope } from '../../db/types.js';
import { requireFirebaseUser } from '../../middleware/auth.js';
import { effectiveScope, resolveAccessibleSettlements } from '../../services/scope.js';
import type { App } from '../../types.js';
// resolves to ~470 settlements; the FE only needs the first page for
// rendering the "your settlements" picker.
const ME_ACCESSIBLE_SETTLEMENTS_CAP = 100;

export const meRoutes = new Hono<App>();

meRoutes.use('*', requireFirebaseUser);

// Lightweight display cards for the surveyor's scope-management UI. The FE
// renders one toggle per item and needs human-readable names; building the
// hydration in /me avoids surveyor-facing lookups against the admin-only
// adminSettlementsByIds / adminStationsByCodes routes.
interface ScopeCards {
  communities: Array<{ name: string }>;
  settlements: Array<{
    id: string;
    name_local: string;
    name_en: string | null;
    community: string;
    region: string;
  }>;
  polling_stations: Array<{
    code: string;
    settlement_id: string;
    settlement_name_local: string;
    settlement_name_en: string | null;
    region: string;
  }>;
}

async function hydrateScopeCards(scope: SurveyorScope): Promise<ScopeCards> {
  const cards: ScopeCards = { communities: [], settlements: [], polling_stations: [] };

  for (const name of scope.communities ?? []) cards.communities.push({ name });

  if (scope.settlements && scope.settlements.length > 0) {
    const docs = await c
      .settlements()
      .find(
        { _id: { $in: scope.settlements } },
        { projection: { name_local: 1, name_en: 1, community: 1, region: 1 } },
      )
      .toArray();
    cards.settlements = docs.map((d) => ({
      id: d._id.toHexString(),
      name_local: d.name_local,
      name_en: d.name_en ?? null,
      community: d.community,
      region: d.region,
    }));
  }

  if (scope.polling_station_codes && scope.polling_station_codes.length > 0) {
    const stations = await c
      .pollingStations()
      .find(
        { code: { $in: scope.polling_station_codes } },
        { projection: { code: 1, settlement_id: 1 } },
      )
      .toArray();
    const settlementIds = stations.map((s) => s.settlement_id);
    const settlementDocs =
      settlementIds.length > 0
        ? await c
            .settlements()
            .find(
              { _id: { $in: settlementIds } },
              { projection: { name_local: 1, name_en: 1, region: 1 } },
            )
            .toArray()
        : [];
    const byId = new Map(settlementDocs.map((s) => [s._id.toHexString(), s]));
    cards.polling_stations = stations.map((st) => {
      const settlement = byId.get(st.settlement_id.toHexString());
      return {
        code: st.code,
        settlement_id: st.settlement_id.toHexString(),
        settlement_name_local: settlement?.name_local ?? '',
        settlement_name_en: settlement?.name_en ?? null,
        region: settlement?.region ?? '',
      };
    });
  }

  return cards;
}

function scopeToWire(scope: SurveyorScope | undefined) {
  return {
    communities: scope?.communities ?? [],
    settlements: (scope?.settlements ?? []).map((s: ObjectId) => s.toHexString()),
    polling_station_codes: scope?.polling_station_codes ?? [],
  };
}

meRoutes.get('/', async (ctx) => {
  const principal = ctx.get('principal');

  // BE-DUAL-ROLE: surface BOTH records in one shot so the response can
  // tell the FE which roles the user qualifies for. Two indexed
  // findOne()s in parallel — the cost is essentially the same as the
  // previous "admin-first then maybe surveyor" path.
  const [admin, surveyor] = await Promise.all([
    c.admins().findOne({ firebase_uid: principal.uid }),
    c.surveyors().findOne({ firebase_uid: principal.uid }),
  ]);

  const availableRoles: Array<'admin' | 'surveyor'> = [];
  if (admin) availableRoles.push('admin');
  if (surveyor) availableRoles.push('surveyor');

  // Role-resolution order:
  //   1. Explicit ?as= hint, but only if the user actually qualifies for it.
  //   2. Admin if available (back-compat default — admin wins when no hint).
  //   3. Surveyor if available.
  //   4. Unregistered.
  // The hint is intentionally ignored when the user lacks that record so a
  // crafted URL (?as=admin) can't elevate a surveyor's permissions.
  const asHint = ctx.req.query('as');
  let activeRole: 'admin' | 'surveyor' | 'unregistered' = 'unregistered';
  if (asHint === 'surveyor' && surveyor) activeRole = 'surveyor';
  else if (asHint === 'admin' && admin) activeRole = 'admin';
  else if (admin) activeRole = 'admin';
  else if (surveyor) activeRole = 'surveyor';

  if (activeRole === 'admin' && admin) {
    return ctx.json({
      role: 'admin' as const,
      id: admin._id!.toHexString(),
      email: admin.email,
      full_name: admin.full_name,
      language: admin.language,
      available_roles: availableRoles,
    });
  }

  if (activeRole === 'unregistered' || !surveyor) {
    // Authenticated Firebase user with no app role. The FE renders the
    // self-register screen for this case. 200 not 404 — this isn't an
    // error, it's a known state.
    return ctx.json({
      role: 'unregistered' as const,
      email: principal.email ?? null,
      available_roles: availableRoles,
    });
  }

  const isActive = surveyor.status === 'active';

  // Stats are zeros for non-active users (they can't have made responses).
  let responsesToday = 0;
  let settlementsTodayCount = 0;
  let openSession: Awaited<ReturnType<typeof c.surveySessions.prototype.findOne>> = null;
  if (isActive) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [rt, st, os] = await Promise.all([
      c.responses().countDocuments({ surveyor_id: surveyor._id, server_ts: { $gte: startOfDay } }),
      c
        .responses()
        .distinct('settlement_id', { surveyor_id: surveyor._id, server_ts: { $gte: startOfDay } }),
      c
        .surveySessions()
        .findOne({ surveyor_id: surveyor._id, ended_at: null }, { sort: { started_at: -1 } }),
    ]);
    responsesToday = rt;
    settlementsTodayCount = st.length;
    openSession = os;
  }

  // Scope vs effective scope: `scope` is the full grant; `effective` is
  // what's left after applying the surveyor's active/inactive toggles.
  // accessible_settlements (the picker list) is built from effective so
  // inactive grants vanish from the surveyor's "today's picker" without
  // un-granting them. The scope_cards (management UI) read from the full
  // grant so the surveyor can toggle inactive items back on.
  const scope: SurveyorScope = surveyor.scope ?? { settlements: surveyor.settlements ?? [] };
  const activeMap = surveyor.scope_active_map ?? {};
  const effective = effectiveScope(scope, activeMap);

  const [scopeCards, requestedScopeCards, resolved] = await Promise.all([
    hydrateScopeCards(scope),
    surveyor.requested_scope
      ? hydrateScopeCards(surveyor.requested_scope)
      : Promise.resolve({ communities: [], settlements: [], polling_stations: [] } as ScopeCards),
    resolveAccessibleSettlements(effective),
  ]);

  const cappedIds = resolved.settlement_ids.slice(0, ME_ACCESSIBLE_SETTLEMENTS_CAP);
  const settlementDocs =
    cappedIds.length > 0
      ? await c
          .settlements()
          .find(
            { _id: { $in: cappedIds } },
            { projection: { name_local: 1, name_en: 1, community: 1, region: 1 } },
          )
          .toArray()
      : [];

  return ctx.json({
    role: 'surveyor' as const,
    id: surveyor._id!.toHexString(),
    full_name: surveyor.full_name,
    email: surveyor.email,
    phone: surveyor.phone ?? null,
    status: surveyor.status,
    available_roles: availableRoles,
    scope: scopeToWire(scope),
    scope_cards: scopeCards,
    scope_active_map: activeMap,
    requested_scope: scopeToWire(surveyor.requested_scope),
    requested_scope_cards: requestedScopeCards,
    requested_scope_at: surveyor.requested_scope_at ?? null,
    accessible_settlements: settlementDocs.map((s) => ({
      id: s._id.toHexString(),
      name_local: s.name_local,
      name_en: s.name_en ?? null,
      community: s.community,
      region: s.region,
    })),
    accessible_settlements_total: resolved.settlement_ids.length,
    accessible_settlements_capped: resolved.settlement_ids.length > ME_ACCESSIBLE_SETTLEMENTS_CAP,
    stats: {
      responses_today: responsesToday,
      settlements_today: settlementsTodayCount,
    },
    active_session: openSession
      ? {
          id: openSession._id!.toHexString(),
          started_at: openSession.started_at,
          working_settlement_id: openSession.working_settlement_id.toHexString(),
        }
      : null,
    ...(surveyor.status === 'rejected' && {
      rejection_reason: surveyor.rejection_reason ?? null,
    }),
  });
});
