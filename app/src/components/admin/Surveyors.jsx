import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useMutation } from '../../hooks/useMutation.js';
import { useAdminContext } from '../../contexts/AdminContext.jsx';
import {
  adminScopeRequestApprove,
  adminScopeRequestReject,
  adminScopeRequestsList,
  adminSurveyorsList,
  adminSurveyorsPatch,
  adminSurveyorsPending,
} from '../../lib/endpoints.js';
import { SurveyorApproveModal } from './SurveyorApproveModal.jsx';
import { SurveyorRejectModal } from './SurveyorRejectModal.jsx';
import { SurveyorEditSettlementsModal } from './SurveyorEditSettlementsModal.jsx';
import { T } from '../../i18n.js';

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2);
}

function relativeTime(iso, lang) {
  if (!iso) return '';
  const dt = new Date(iso);
  const diffMs = Date.now() - dt.getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1)  return ('just now');
  if (m < 60) return (`${m}m ago`);
  const h = Math.floor(m / 60);
  if (h < 24) return (`${h}h ago`);
  const d = Math.floor(h / 24);
  return (`${d}d ago`);
}

function Th({ children, width }) {
  return <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, width }}>{children}</th>;
}

function settlementChipName(s, lang) {
  if (lang === 'en' && s.name_en) return s.name_en;
  return s.name_local || s.name_en || '';
}

// Read the surveyor's scope shape (BE-SCOPE-DATA-MODEL) with tolerance for
// the legacy `settlements: [id]`-only response. Always returns a normalized
// triple of arrays so callers don't have to handle three "missing" states.
function readScope(surveyor) {
  const s = surveyor.scope;
  if (s && (s.communities || s.settlements || s.polling_station_codes)) {
    return {
      communities: s.communities || [],
      settlements: s.settlements || [],
      polling_station_codes: s.polling_station_codes || [],
    };
  }
  return {
    communities: [],
    settlements: surveyor.settlements || [],
    polling_station_codes: [],
  };
}

// Compact summary line for the Access column. Three counts with thin-space
// separators so the row stays one line; tap to expand for actual chips.
function ScopeSummary({ scope, lang }) {
  const c = scope.communities.length;
  const s = scope.settlements.length;
  const p = scope.polling_station_codes.length;
  if (c === 0 && s === 0 && p === 0) {
    return <span style={{ color: 'var(--text-3)' }}>{T(lang, 'admin.no_scope')}</span>;
  }
  return (
    <span style={{ color: 'var(--text-2)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
      {T(lang, 'scope.summary')
        .replace('{c}', c)
        .replace('{s}', s)
        .replace('{p}', p)}
    </span>
  );
}

// Expanded panel: actual chips for every grant in scope. Communities and
// stations are plain identifiers (string / station code); settlements use
// the surveyor row's settlements_full denorm so the chip shows the name.
function ScopeChips({ surveyor, lang }) {
  const scope = readScope(surveyor);
  const settlementsFull = Array.isArray(surveyor.settlements_full) ? surveyor.settlements_full : [];
  const settlementById = new Map(settlementsFull.map((s) => [s.id, s]));

  const Section = ({ title, children, hidden }) => hidden ? null : (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-3)',
        textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4,
      }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{children}</div>
    </div>
  );

  const Pill = ({ label, kind = 'accent' }) => {
    const palette = kind === 'accent'
      ? { bg: 'var(--accent-tint)', fg: 'var(--accent-strong)' }
      : { bg: 'var(--surface-2)', fg: 'var(--text-2)' };
    return (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 999,
        background: palette.bg, color: palette.fg,
        fontSize: 11, fontWeight: 500,
      }}>{label}</span>
    );
  };

  return (
    <div style={{
      padding: 12, background: 'var(--surface-2)',
      borderRadius: 8, fontSize: 12,
    }}>
      <Section title={T(lang, 'scope.communities')}
               hidden={scope.communities.length === 0}>
        {scope.communities.map((name) => <Pill key={`c-${name}`} label={name} />)}
      </Section>
      <Section title={T(lang, 'scope.settlements')}
               hidden={scope.settlements.length === 0}>
        {scope.settlements.map((id) => {
          const s = settlementById.get(id);
          return <Pill key={`s-${id}`} label={s ? settlementChipName(s, lang) : `#${id.slice(0, 6)}…`} />;
        })}
      </Section>
      <Section title={T(lang, 'scope.stations')}
               hidden={scope.polling_station_codes.length === 0}>
        {scope.polling_station_codes.map((code) => (
          <Pill key={`p-${code}`} label={code} kind="muted" />
        ))}
      </Section>
    </div>
  );
}

// ── Pending tab ──────────────────────────────────────────────────────

function PendingList({ lang, onChanged }) {
  const { data, loading, error, refetch } = useApi(
    ({ signal }) => adminSurveyorsPending({ signal }),
    [],
  );

  const [approveTarget, setApproveTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);

  const handleAfterAction = () => {
    refetch();
    onChanged?.();
  };

  if (loading) {
    return <div style={{ padding: 30, color: 'var(--text-3)', textAlign: 'center', fontSize: 13 }}>…</div>;
  }
  if (error) {
    return (
      <div style={{
        background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
        padding: 12, borderRadius: 10, fontSize: 13,
      }}>{error.message}</div>
    );
  }
  const items = data || [];
  if (items.length === 0) {
    return (
      <div style={{ padding: 40, color: 'var(--text-3)', textAlign: 'center', fontSize: 13 }}>
        {T(lang, 'admin.no_pending')}
      </div>
    );
  }

  return (
    <>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="responsive" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: 'var(--surface-2)' }}>
            <tr style={{
              color: 'var(--text-3)', fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              <Th>{T(lang, 'name')}</Th>
              <Th>Email</Th>
              <Th>{T(lang, 'admin.applied')}</Th>
              <Th width={200} />
            </tr>
          </thead>
          <tbody>
            {items.map(s => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%',
                      background: 'var(--accent-tint)', color: 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 600, fontSize: 12,
                    }}>{initials(s.full_name)}</div>
                    <span style={{ fontWeight: 500 }}>{s.full_name}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 14px', color: 'var(--text-2)', fontFamily: 'var(--ff-mono)', fontSize: 12 }}>
                  {s.email}
                </td>
                <td style={{ padding: '12px 14px', color: 'var(--text-3)', fontSize: 12 }}>
                  {relativeTime(s.created_at, lang)}
                </td>
                <td data-mobile-actions style={{ padding: '12px 14px', textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button className="btn btn-primary" onClick={() => setApproveTarget(s)}
                            style={{ padding: '6px 12px', fontSize: 12 }}>
                      <Icon name="check" size={12} />{T(lang, 'admin.approve')}
                    </button>
                    <button className="btn" onClick={() => setRejectTarget(s)}
                            style={{ padding: '6px 12px', fontSize: 12, color: 'var(--st-refused-fg)' }}>
                      <Icon name="x" size={12} />{T(lang, 'admin.reject')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SurveyorApproveModal open={!!approveTarget} surveyor={approveTarget} lang={lang}
                            onClose={() => setApproveTarget(null)}
                            onApproved={handleAfterAction} />
      <SurveyorRejectModal open={!!rejectTarget} surveyor={rejectTarget} lang={lang}
                           onClose={() => setRejectTarget(null)}
                           onRejected={handleAfterAction} />
    </>
  );
}

// ── Active / Suspended / Rejected tabs ───────────────────────────────

function StatusList({ status, lang }) {
  const { data, loading, error, refetch } = useApi(
    ({ signal }) => adminSurveyorsList({ status, limit: 50 }, { signal }),
    [status],
  );

  const { mutate: patch, loading: patching } = useMutation(
    (id, body) => adminSurveyorsPatch(id, body),
  );

  const [editTarget, setEditTarget] = useState(null);
  // Per-row "show details" toggle. Surveyor IDs in this set get the
  // expanded ScopeChips panel below their summary line.
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const items = data?.items || [];
  const meta = data?.page;

  const onSuspend = async (id) => {
    if (patching) return;
    try { await patch(id, { status: 'suspended' }); refetch(); } catch { /* */ }
  };
  const onReactivate = async (id) => {
    if (patching) return;
    try { await patch(id, { status: 'active' }); refetch(); } catch { /* */ }
  };
  const onEditSettlements = (s) => setEditTarget(s);
  const onEditSaved = () => { setEditTarget(null); refetch(); };

  if (loading) {
    return <div style={{ padding: 30, color: 'var(--text-3)', textAlign: 'center', fontSize: 13 }}>…</div>;
  }
  if (error) {
    return (
      <div style={{
        background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
        padding: 12, borderRadius: 10, fontSize: 13,
      }}>{error.message}</div>
    );
  }
  if (items.length === 0) {
    return (
      <div style={{ padding: 40, color: 'var(--text-3)', textAlign: 'center', fontSize: 13 }}>
        {T(lang, 'admin.no_results')}
      </div>
    );
  }

  return (
    <>
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="responsive" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ background: 'var(--surface-2)' }}>
          <tr style={{
            color: 'var(--text-3)', fontSize: 11, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            <Th>{T(lang, 'name')}</Th>
            <Th>Email</Th>
            <Th>{T(lang, 'admin.responses_total')}</Th>
            <Th>{T(lang, 'admin.scope_col')}</Th>
            {status === 'rejected' && <Th>{T(lang, 'rejected.reason_label')}</Th>}
            <Th />
          </tr>
        </thead>
        <tbody>
          {items.map(s => {
            const expanded = expandedIds.has(s.id);
            // The whole row is clickable to toggle expansion; the action
            // column stops propagation so Edit/Suspend buttons don't also
            // expand. colSpan on the detail row matches the column count
            // so the chip panel spans full width.
            const columnCount = 5 + (status === 'rejected' ? 1 : 0);
            return (
              <Fragment key={s.id}>
                <tr onClick={() => toggleExpanded(s.id)}
                    style={{
                      borderTop: '1px solid var(--border)', cursor: 'pointer',
                      background: expanded ? 'var(--surface-2)' : undefined,
                    }}>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12}
                            style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: 'var(--accent-tint)', color: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 600, fontSize: 12,
                      }}>{initials(s.full_name)}</div>
                      <span style={{ fontWeight: 500 }}>{s.full_name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px', color: 'var(--text-2)', fontFamily: 'var(--ff-mono)', fontSize: 12 }}>
                    {s.email}
                  </td>
                  <td style={{ padding: '12px 14px', fontVariantNumeric: 'tabular-nums' }}>
                    {s.response_counts?.total ?? 0}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <ScopeSummary scope={readScope(s)} lang={lang} />
                  </td>
                  {status === 'rejected' && (
                    <td style={{ padding: '12px 14px', color: 'var(--text-2)', fontSize: 12 }}>
                      {s.rejection_reason || '—'}
                    </td>
                  )}
                  <td data-mobile-actions style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}
                      onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {(status === 'active' || status === 'suspended') && (
                        <button onClick={() => onEditSettlements(s)} className="btn"
                                title={T(lang, 'admin.action_edit_settlements')}
                                aria-label={T(lang, 'admin.action_edit_settlements')}
                                style={{ padding: '6px 10px', fontSize: 12 }}>
                          <Icon name="settings" size={12} />
                          {T(lang, 'admin.action_edit_settlements')}
                        </button>
                      )}
                      {status === 'active' && (
                        <button onClick={() => onSuspend(s.id)} disabled={patching}
                                className="btn" style={{ padding: '6px 12px', fontSize: 12, color: 'var(--st-refused-fg)' }}>
                          {T(lang, 'admin.suspend')}
                        </button>
                      )}
                      {status === 'suspended' && (
                        <button onClick={() => onReactivate(s.id)} disabled={patching}
                                className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12 }}>
                          {T(lang, 'admin.reactivate')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <td colSpan={columnCount} style={{ padding: '0 14px 12px' }}>
                      <ScopeChips surveyor={s} lang={lang} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {meta && meta.pages > 1 && (
        <div style={{
          padding: '10px 14px', borderTop: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text-3)', textAlign: 'right',
        }}>
          {meta.total} {('results')}
          <span style={{ marginLeft: 12 }}>{meta.page} / {meta.pages}</span>
        </div>
      )}
    </div>

    <SurveyorEditSettlementsModal
      open={!!editTarget} surveyor={editTarget} lang={lang}
      onClose={() => setEditTarget(null)}
      onUpdated={onEditSaved} />
    </>
  );
}

// ── Scope-requests tab ───────────────────────────────────────────────
// Active surveyors who self-submitted a scope-addition request. Admin
// reviews the requested items (which sit on `requested_scope`, not
// `scope`) and clicks Approve/Reject. Approve merges requested → scope
// AND flips every previously granted item to inactive in the same trip
// (per spec) so the surveyor lands with a clean focus on the new items.

function ScopeRequestRow({ s, lang, onApprove, onReject, busy }) {
  const settlementsFull = Array.isArray(s.settlements_full) ? s.settlements_full : [];
  const byId = new Map(settlementsFull.map((x) => [x.id, x]));
  const req = s.requested_scope || { communities: [], settlements: [], polling_station_codes: [] };

  const Pill = ({ label, kind = 'accent' }) => {
    const palette = kind === 'accent'
      ? { bg: 'var(--accent-tint)', fg: 'var(--accent-strong)' }
      : { bg: 'var(--surface-2)', fg: 'var(--text-2)' };
    return (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 999,
        background: palette.bg, color: palette.fg,
        fontSize: 11, fontWeight: 500, marginRight: 4, marginBottom: 4,
      }}>{label}</span>
    );
  };

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'var(--accent-tint)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 600, fontSize: 12,
          }}>{initials(s.full_name)}</div>
          <div>
            <div style={{ fontWeight: 500 }}>{s.full_name}</div>
            <div style={{
              fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--ff-mono)',
            }}>{s.email}</div>
          </div>
        </div>
      </td>
      <td style={{ padding: '12px 14px' }}>
        {req.communities.map((name) => <Pill key={`c-${name}`} label={name} />)}
        {req.settlements.map((id) => {
          const found = byId.get(id);
          return <Pill key={`s-${id}`} label={found ? settlementChipName(found, lang) : `#${id.slice(0, 6)}…`} />;
        })}
        {req.polling_station_codes.map((code) => (
          <Pill key={`p-${code}`} label={code} kind="muted" />
        ))}
      </td>
      <td style={{ padding: '12px 14px', color: 'var(--text-3)', fontSize: 12 }}>
        {relativeTime(s.requested_scope_at, lang)}
      </td>
      <td data-mobile-actions style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button className="btn btn-primary" onClick={() => onApprove(s.id)} disabled={busy}
                  style={{ padding: '6px 12px', fontSize: 12 }}>
            <Icon name="check" size={12} />{T(lang, 'admin.approve')}
          </button>
          <button className="btn" onClick={() => onReject(s.id)} disabled={busy}
                  style={{ padding: '6px 12px', fontSize: 12, color: 'var(--st-refused-fg)' }}>
            <Icon name="x" size={12} />{T(lang, 'admin.reject')}
          </button>
        </div>
      </td>
    </tr>
  );
}

function ScopeRequestsList({ lang, onChanged }) {
  const { data, loading, error, refetch } = useApi(
    ({ signal }) => adminScopeRequestsList({ signal }),
    [],
  );
  const { mutate: approve, loading: approving } = useMutation(adminScopeRequestApprove);
  const { mutate: reject, loading: rejecting } = useMutation(adminScopeRequestReject);
  const busy = approving || rejecting;

  // Periodic poll so new requests appear without the admin having to leave
  // and come back to this tab. Latest refetch lives in a ref so the
  // interval effect doesn't re-arm itself on every render. Paused while
  // the tab is hidden so a backgrounded admin doesn't keep hammering /me.
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refetchRef.current?.();
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const onApprove = async (id) => {
    try { await approve(id); refetch(); onChanged?.(); } catch { /* */ }
  };
  const onReject = async (id) => {
    try { await reject(id); refetch(); onChanged?.(); } catch { /* */ }
  };

  if (loading) {
    return <div style={{ padding: 30, color: 'var(--text-3)', textAlign: 'center', fontSize: 13 }}>…</div>;
  }
  if (error) {
    return (
      <div style={{
        background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
        padding: 12, borderRadius: 10, fontSize: 13,
      }}>{error.message}</div>
    );
  }
  const items = data?.items || [];
  if (items.length === 0) {
    return (
      <div style={{ padding: 40, color: 'var(--text-3)', textAlign: 'center', fontSize: 13 }}>
        {T(lang, 'admin.no_scope_requests')}
      </div>
    );
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="responsive" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ background: 'var(--surface-2)' }}>
          <tr style={{
            color: 'var(--text-3)', fontSize: 11, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            <Th>{T(lang, 'name')}</Th>
            <Th>{T(lang, 'admin.scope_requested')}</Th>
            <Th>{T(lang, 'admin.requested_at')}</Th>
            <Th width={200} />
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <ScopeRequestRow key={s.id} s={s} lang={lang} busy={busy}
                             onApprove={onApprove} onReject={onReject} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Top-level: tabs ──────────────────────────────────────────────────

export function AdminSurveyors({ lang }) {
  const { pendingCount, refetchPending, scopeRequestsCount, refetchScopeRequests } =
    useAdminContext();
  // Default starting tab: Pending applicants if any, else Scope-requests if
  // any, else Active. Auto-switches once on first non-zero count arrival.
  const initialTab = pendingCount > 0
    ? 'pending'
    : scopeRequestsCount > 0
      ? 'scope-requests'
      : 'active';
  const [tab, setTab] = useState(initialTab);

  const [autoSwitched, setAutoSwitched] = useState(false);
  useEffect(() => {
    if (autoSwitched) return;
    if (pendingCount > 0) {
      setTab('pending');
      setAutoSwitched(true);
    } else if (scopeRequestsCount > 0) {
      setTab('scope-requests');
      setAutoSwitched(true);
    }
  }, [pendingCount, scopeRequestsCount, autoSwitched]);

  const tabs = useMemo(() => ([
    { id: 'pending',        label: T(lang, 'admin.tab_pending'),        badge: pendingCount },
    { id: 'scope-requests', label: T(lang, 'admin.tab_scope_requests'), badge: scopeRequestsCount },
    { id: 'active',         label: T(lang, 'admin.tab_active') },
    { id: 'suspended',      label: T(lang, 'admin.tab_suspended') },
    { id: 'rejected',       label: T(lang, 'admin.tab_rejected') },
  ]), [lang, pendingCount, scopeRequestsCount]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="tabs" style={{ alignSelf: 'flex-start' }}>
        {tabs.map(t => (
          <button key={t.id} data-active={tab === t.id} onClick={() => setTab(t.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px' }}>
            {t.label}
            {t.badge > 0 && (
              <span style={{
                minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                background: tab === t.id ? 'var(--accent)' : 'var(--surface-3)',
                color: tab === t.id ? 'var(--accent-fg)' : 'var(--text-2)',
                fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'pending'        && <PendingList lang={lang} onChanged={refetchPending} />}
      {tab === 'scope-requests' && <ScopeRequestsList lang={lang} onChanged={refetchScopeRequests} />}
      {tab === 'active'         && <StatusList status="active"    lang={lang} />}
      {tab === 'suspended'      && <StatusList status="suspended" lang={lang} />}
      {tab === 'rejected'       && <StatusList status="rejected"  lang={lang} />}
    </div>
  );
}
