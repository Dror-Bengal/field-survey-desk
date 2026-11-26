// Surveyor's session-start screen — the entry point for an active surveyor.
// Three vertically stacked sections, all driven by the /me payload:
//
//   1) Today's picker: tap a settlement to start a session there. Lists
//      `accessible_settlements` (server-filtered to only those in active
//      grants), so toggling a grant off below removes its settlements here.
//
//   2) My places: one card per granted scope item (community / settlement /
//      station) with an inline active/inactive toggle. The toggle does
//      NOT un-grant — it just hides items from section (1) without an
//      admin trip. Mutations go to PATCH /surveyors/me/scope-active.
//
//   3) Pending approval: items the surveyor self-requested but admin
//      hasn't acted on yet (read-only).
//
// Below all three: "Request more places" opens the same picker the admin
// uses (different endpoint set under the hood). Submits to POST
// /surveyors/me/scope-request, then refetches /me to surface the new
// pending items.

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { AppHeader } from '../ui/AppHeader.jsx';
import { Modal } from '../ui/Modal.jsx';
import { GpsConsentModal } from '../GpsConsent.jsx';
import { ScopePicker, emptyScope, scopeIsEmpty } from '../admin/ScopePicker.jsx';
import { useMutation } from '../../hooks/useMutation.js';
import {
  communitiesSearch,
  meScopeActiveSet,
  meScopeRequest,
  pollingStationsSearch,
  sessionsCreate,
  settlementsSearch,
  toGeoPoint,
} from '../../lib/endpoints.js';
import { tryCaptureLocation } from '../../lib/geo.js';
import { T } from '../../i18n.js';

const GEO_TIMEOUT_MS = 3000;
// How often we re-fetch /me while the surveyor is on this screen. Keeps
// the "Pending approval" banner and "My places" cards in sync when an
// admin approves a scope-request — without this, the surveyor sits on a
// stale snapshot until they manually reload (which is what we saw users
// doing in early testing).
const ME_POLL_INTERVAL_MS = 30_000;

// Public mirrors of the admin search endpoints — same wire shape but with
// the FE-side requireFirebaseUser gate (not requireAdmin). Plumbed into
// ScopePicker via `searchFns` so the surveyor request modal doesn't need
// admin permissions to populate the search results.
const SURVEYOR_SEARCH_FNS = {
  communities: communitiesSearch,
  settlements: settlementsSearch,
  stations: pollingStationsSearch,
};

function settlementName(s, lang) {
  if (lang === 'en' && s.name_en) return s.name_en;
  return s.name_local || s.name_en || '';
}

function SettlementRow({ s, onClick, lang, busy }) {
  return (
    <button onClick={onClick} disabled={busy} className="btn btn-ghost"
      style={{
        width: '100%', justifyContent: 'space-between',
        padding: '12px 14px', borderRadius: 10, background: 'transparent',
        opacity: busy ? 0.6 : 1,
        lineHeight: 1.35,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, background: 'var(--accent-tint)',
          color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}><Icon name="building" size={18} /></div>
        <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 15, fontWeight: 500, color: 'var(--text)', lineHeight: 1.35,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{settlementName(s, lang)}</div>
          <div style={{
            fontSize: 12, color: 'var(--text-3)', lineHeight: 1.35,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            marginTop: 2,
          }}>
            {s.region}{s.community ? ` · ${s.community}` : ''}
          </div>
        </div>
      </div>
      <Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
    </button>
  );
}

// Native-ish iOS-style toggle, but driven by simple CSS — no extra deps.
// Disabled state freezes the knob while a PATCH is in flight so the
// surveyor can't rapid-tap and create a flurry of conflicting updates.
function Toggle({ on, onChange, disabled, ariaLabel }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={ariaLabel}
            onClick={() => !disabled && onChange(!on)}
            disabled={disabled}
            style={{
              position: 'relative', width: 36, height: 20,
              border: 'none', borderRadius: 999, padding: 0,
              background: on ? 'var(--accent)' : 'var(--surface-3, #ccc)',
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              transition: 'background .15s',
              flexShrink: 0,
            }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transition: 'left .15s',
      }} />
    </button>
  );
}

// One card per granted scope item. Pure presentational — the parent owns
// the active-map and decides whether each toggle is on.
function ScopeCard({ icon, label, sublabel, active, onToggle, busy, ariaLabel }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px', borderRadius: 10,
      background: 'var(--surface)', border: '1px solid var(--border)',
      opacity: active ? 1 : 0.6,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 7,
        background: 'var(--accent-tint)', color: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}><Icon name={icon} size={16} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</div>
        {sublabel && (
          <div style={{
            fontSize: 11, color: 'var(--text-3)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{sublabel}</div>
        )}
      </div>
      <Toggle on={active} onChange={onToggle} disabled={busy} ariaLabel={ariaLabel} />
    </div>
  );
}

// Modal that wraps the shared ScopePicker for surveyor's "request more"
// flow. Internal scope state is local; submit collapses it back into the
// /me payload via the parent's refetch.
function RequestMoreModal({ open, lang, onClose, onSubmit, submitting }) {
  const [scope, setScope] = useState(emptyScope);
  const reset = () => setScope(emptyScope());
  const submit = async () => {
    if (scopeIsEmpty(scope)) return;
    await onSubmit(scope);
    reset();
  };
  const close = () => { reset(); onClose?.(); };

  return (
    <Modal open={open} onClose={close} width={480}
           title={T(lang, 'session.request_more_title')}
           footer={(
             <>
               <button type="button" className="btn" onClick={close} disabled={submitting}>
                 {T(lang, 'gps.cancel')}
               </button>
               <button type="button" className="btn btn-primary"
                       disabled={submitting || scopeIsEmpty(scope)}
                       onClick={submit}>
                 {T(lang, 'session.send_request')}
               </button>
             </>
           )}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5 }}>
        {T(lang, 'session.request_more_help')}
      </div>
      <ScopePicker scope={scope} onChange={setScope} lang={lang}
                   searchFns={SURVEYOR_SEARCH_FNS} />
    </Modal>
  );
}

export function ScreenSessionStart({
  onPick, onError, onGpsStatus, lang, gpsConsent,
  me, refetchMe,
  accessibleSettlements = [], accessibleSettlementsCapped = false, accessibleSettlementsTotal = 0,
}) {
  const [q, setQ] = useState('');

  // Show a search box only once the list gets long enough that scanning is
  // painful. Below ~12 items, the bare list is faster than typing.
  const showSearch = accessibleSettlements.length > 12;

  const filtered = useMemo(() => {
    const trimmed = q.trim().toLowerCase();
    if (!trimmed) return accessibleSettlements;
    return accessibleSettlements.filter((s) => {
      const hay = `${s.name_local || ''} ${s.name_en || ''} ${s.community || ''} ${s.region || ''}`.toLowerCase();
      return hay.includes(trimmed);
    });
  }, [accessibleSettlements, q]);

  const { mutate: createSession, loading: creating } = useMutation(sessionsCreate);

  // Background /me poll. Pauses while the tab is hidden so a backgrounded
  // PWA on the surveyor's phone isn't waking up to make pointless requests.
  // refetchMe is memoized at the App level (depends only on the URL-derived
  // role hint), so it's safe to include in deps without restarting the
  // interval each render.
  useEffect(() => {
    if (!refetchMe) return undefined;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      refetchMe();
    };
    const id = setInterval(tick, ME_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [refetchMe]);

  // Optimistic active-map: holds the in-flight toggle state so the switch
  // doesn't flicker between "tap" and "/me refetch returns." Cleared back
  // to whatever /me reports after the refetch resolves.
  const [pendingActive, setPendingActive] = useState({});
  const [toggleBusy, setToggleBusy] = useState({});

  const activeMap = me?.scope_active_map ?? {};
  const isActive = (key) => {
    if (key in pendingActive) return pendingActive[key];
    return activeMap[key] !== false;
  };

  const onToggle = async (key, next) => {
    setPendingActive((p) => ({ ...p, [key]: next }));
    setToggleBusy((b) => ({ ...b, [key]: true }));
    try {
      await meScopeActiveSet({ key, active: next });
      await refetchMe?.();
      // Clear local override after refetch so subsequent reads come from
      // /me data, not the optimistic cache.
      setPendingActive((p) => {
        const cp = { ...p };
        delete cp[key];
        return cp;
      });
    } catch (err) {
      // Roll back the optimistic write on error.
      setPendingActive((p) => {
        const cp = { ...p };
        delete cp[key];
        return cp;
      });
      onError?.(err?.message || (('Could not update')));
    } finally {
      setToggleBusy((b) => {
        const cb = { ...b };
        delete cb[key];
        return cb;
      });
    }
  };

  // When location is denied/unavailable at session start, we hold the picked
  // settlement here and pop the consent modal so the surveyor can retry or
  // explicitly continue without GPS.
  const [pendingPick, setPendingPick] = useState(null);

  const submitSession = async (s, coords) => {
    const { geo, accuracy } = toGeoPoint(coords);
    const consent = gpsConsent || { gps: !!geo, granted_at: new Date().toISOString() };
    const body = {
      settlement_id: s.id,
      consent,
      user_agent: typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '',
      ...(geo ? { login_geo: geo, login_accuracy_m: accuracy } : {}),
    };
    const result = await createSession(body);
    onPick(s, result.session_id);
  };

  const handlePick = async (s) => {
    if (creating) return;
    try {
      const { status, coords } = await tryCaptureLocation(GEO_TIMEOUT_MS);
      onGpsStatus?.(status);
      if (status === 'granted') {
        await submitSession(s, coords);
      } else {
        setPendingPick({ s, status });
      }
    } catch (err) {
      onError?.(err?.message || (('Could not start session')));
    }
  };

  const onConsentResult = async ({ status, coords }) => {
    onGpsStatus?.(status);
    if (status === 'granted' && pendingPick) {
      const s = pendingPick.s;
      setPendingPick(null);
      try { await submitSession(s, coords); }
      catch (err) { onError?.(err?.message || (('Could not start session'))); }
      return;
    }
    if (pendingPick) {
      const s = pendingPick.s;
      setPendingPick(null);
      try { await submitSession(s, null); }
      catch (err) { onError?.(err?.message || (('Could not start session'))); }
    }
  };

  // ── Request-more-places state ────────────────────────────────────
  const [requestOpen, setRequestOpen] = useState(false);
  const { mutate: submitScopeRequest, loading: submittingRequest } = useMutation(meScopeRequest);
  const onSubmitRequest = async (scope) => {
    try {
      await submitScopeRequest({
        communities: scope.communities,
        settlements: scope.settlements,
        polling_station_codes: scope.polling_station_codes,
      });
      await refetchMe?.();
      setRequestOpen(false);
    } catch (err) {
      onError?.(err?.message || (('Could not send request')));
    }
  };

  // ── Card data for the "My places" section ────────────────────────
  const scopeCards = me?.scope_cards ?? { communities: [], settlements: [], polling_stations: [] };
  const requestedCards = me?.requested_scope_cards ?? { communities: [], settlements: [], polling_stations: [] };

  const hasScope =
    scopeCards.communities.length > 0 ||
    scopeCards.settlements.length > 0 ||
    scopeCards.polling_stations.length > 0;

  const hasRequest =
    requestedCards.communities.length > 0 ||
    requestedCards.settlements.length > 0 ||
    requestedCards.polling_stations.length > 0;

  const empty = accessibleSettlements.length === 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
      <AppHeader title={T(lang, 'where_working')} subtitle={T(lang, 'sign_in')} />
      <div className="scroll-y" style={{ flex: 1, padding: 14 }}>
        {/* Section 1 — today's picker. Always rendered first so the surveyor's
            primary "start work" action stays above the management UI. */}
        <SectionHeader label={T(lang, 'where_working')} />

        {showSearch && (
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <Icon name="search" size={16}
              style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
            <input className="input" placeholder={T(lang, 'search_settlement')}
                   value={q} onChange={e => setQ(e.target.value)}
                   style={{ paddingLeft: 38 }} />
          </div>
        )}

        {empty && !hasScope && (
          <div style={{
            padding: '32px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13,
            background: 'var(--surface-2)', borderRadius: 10,
          }}>
            {('No accessible settlements. You can request some below.')}
          </div>
        )}

        {empty && hasScope && (
          <div style={{
            padding: '16px', color: 'var(--text-3)', fontSize: 13,
            background: 'var(--surface-2)', borderRadius: 10, marginBottom: 12,
          }}>
            {('All your places are switched off. Toggle at least one on to start.')}
          </div>
        )}

        {!empty && filtered.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
            {T(lang, 'no_results')}
          </div>
        )}

        {!empty && filtered.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="divide">
              {filtered.map((s) => (
                <SettlementRow key={s.id} s={s} lang={lang} busy={creating}
                               onClick={() => handlePick(s)} />
              ))}
            </div>
          </div>
        )}

        {accessibleSettlementsCapped && (
          <div style={{
            marginTop: 10, fontSize: 11, color: 'var(--text-3)', textAlign: 'center',
          }}>
            {(`Showing first ${filtered.length} of ${accessibleSettlementsTotal}`)}
          </div>
        )}

        {/* ── My places (manage active/inactive) ─────────────────── */}
        {hasScope && (
          <div style={{ marginTop: 22 }}>
            <SectionHeader label={T(lang, 'session.my_places')} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {scopeCards.communities.map((com) => {
                const key = `community:${com.name}`;
                return (
                  <ScopeCard key={key} icon="map"
                    label={com.name} sublabel={T(lang, 'scope.communities')}
                    active={isActive(key)} busy={!!toggleBusy[key]}
                    onToggle={(v) => onToggle(key, v)}
                    ariaLabel={`Toggle ${com.name}`} />
                );
              })}
              {scopeCards.settlements.map((s) => {
                const key = `settlement:${s.id}`;
                const name = settlementName(s, lang);
                return (
                  <ScopeCard key={key} icon="building"
                    label={name} sublabel={`${s.region}${s.community ? ` · ${s.community}` : ''}`}
                    active={isActive(key)} busy={!!toggleBusy[key]}
                    onToggle={(v) => onToggle(key, v)}
                    ariaLabel={`Toggle ${name}`} />
                );
              })}
              {scopeCards.polling_stations.map((st) => {
                const key = `station:${st.code}`;
                const settlement = lang === 'en' && st.settlement_name_en
                  ? st.settlement_name_en
                  : st.settlement_name_local;
                return (
                  <ScopeCard key={key} icon="building"
                    label={st.code} sublabel={`${settlement} · ${st.region}`}
                    active={isActive(key)} busy={!!toggleBusy[key]}
                    onToggle={(v) => onToggle(key, v)}
                    ariaLabel={`Toggle ${st.code}`} />
                );
              })}
            </div>
          </div>
        )}

        {/* ── Pending approval ────────────────────────────────── */}
        {hasRequest && (
          <div style={{ marginTop: 22 }}>
            <SectionHeader label={T(lang, 'session.pending_approval')} />
            <div style={{
              padding: 12, borderRadius: 10,
              background: 'var(--accent-tint)', color: 'var(--accent-strong)',
              display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13,
            }}>
              {requestedCards.communities.map((com) => (
                <div key={`req-c-${com.name}`}>
                  <Icon name="clock" size={12} /> {com.name} <em style={{ fontSize: 11, opacity: 0.7 }}>({T(lang, 'scope.communities')})</em>
                </div>
              ))}
              {requestedCards.settlements.map((s) => (
                <div key={`req-s-${s.id}`}>
                  <Icon name="clock" size={12} /> {settlementName(s, lang)} <em style={{ fontSize: 11, opacity: 0.7 }}>({T(lang, 'scope.settlements')})</em>
                </div>
              ))}
              {requestedCards.polling_stations.map((st) => (
                <div key={`req-p-${st.code}`}>
                  <Icon name="clock" size={12} /> {st.code} <em style={{ fontSize: 11, opacity: 0.7 }}>({T(lang, 'scope.stations')})</em>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Request more ─────────────────────────────────────── */}
        <div style={{ marginTop: 22 }}>
          <button type="button" className="btn btn-block"
                  onClick={() => setRequestOpen(true)}
                  style={{ minHeight: 44, justifyContent: 'center' }}>
            <Icon name="search" size={14} />{T(lang, 'session.request_more')}
          </button>
        </div>
      </div>

      <GpsConsentModal
        open={!!pendingPick}
        status={pendingPick?.status || 'unavailable'}
        lang={lang}
        onClose={() => setPendingPick(null)}
        onResult={onConsentResult} />

      <RequestMoreModal open={requestOpen} lang={lang}
                        onClose={() => setRequestOpen(false)}
                        onSubmit={onSubmitRequest}
                        submitting={submittingRequest} />
    </div>
  );
}

function SectionHeader({ label }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--text-3)',
      textTransform: 'uppercase', letterSpacing: '.08em',
      marginBottom: 8,
    }}>{label}</div>
  );
}
