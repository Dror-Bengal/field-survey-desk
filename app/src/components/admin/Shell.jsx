import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { LangToggle } from '../ui/LangToggle.jsx';
import { AdminContext } from '../../contexts/AdminContext.jsx';
import { adminScopeRequestsList, adminSurveyorsPending } from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

const NAV_ITEMS = [
  { id: 'overview',   icon: 'chart',    key: 'overview' },
  { id: 'responses',  icon: 'list',     key: 'responses_admin' },
  { id: 'surveyors',  icon: 'users',    key: 'surveyors',       hasPendingBadge: true },
];

const PENDING_POLL_MS = 30_000;

function userInitials(user) {
  const name = user?.displayName || user?.email || '';
  if (!name) return 'AD';
  const parts = name.split(/[@\s.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function AdminShell({
  lang, setLang, page, setPage, onLogout, currentUser, children,
  // Dual-role switcher (FE-DUAL-ROLE). Hidden when the user only
  // qualifies as an admin.
  canSwitchToSurveyor = false, onSwitchToSurveyor,
}) {
  const activeKey = NAV_ITEMS.find(i => i.id === page)?.key || 'overview';

  // Pending-applicant + pending-scope-request counts — polled every 60s so
  // sidebar + tab badges stay fresh without the user navigating away. The
  // two counts are independent (an existing active surveyor can submit a
  // scope-request without touching the applicants queue).
  const [pendingCount, setPendingCount] = useState(0);
  const [scopeRequestsCount, setScopeRequestsCount] = useState(0);

  const refetchPending = useCallback(async () => {
    try {
      const items = await adminSurveyorsPending();
      setPendingCount(Array.isArray(items) ? items.length : 0);
    } catch {
      // Silent — keep last known count when the poll fails.
    }
  }, []);
  const refetchScopeRequests = useCallback(async () => {
    try {
      const env = await adminScopeRequestsList();
      const items = env?.items;
      setScopeRequestsCount(Array.isArray(items) ? items.length : 0);
    } catch {
      // Silent.
    }
  }, []);

  useEffect(() => {
    refetchPending();
    refetchScopeRequests();
    const id1 = setInterval(refetchPending, PENDING_POLL_MS);
    const id2 = setInterval(refetchScopeRequests, PENDING_POLL_MS);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, [refetchPending, refetchScopeRequests]);

  const adminCtx = useMemo(
    () => ({ pendingCount, refetchPending, scopeRequestsCount, refetchScopeRequests }),
    [pendingCount, refetchPending, scopeRequestsCount, refetchScopeRequests],
  );

  // Sidebar "Surveyors" badge — sum of both queues so admin sees one total.
  const surveyorsBadgeCount = pendingCount + scopeRequestsCount;

  return (
    <AdminContext.Provider value={adminCtx}>
      <div className="admin-shell">
        <aside className="admin-sidebar">
          {/* Brand. Plain anchor so it feels like a logo (and gives a "go home"
              affordance even though we're already at /admin). */}
          <a href="/admin" style={{
            padding: '16px 16px 12px',
            display: 'flex', alignItems: 'center', gap: 10,
            textDecoration: 'none', color: 'inherit',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: 'var(--accent)',
              color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 13, flexShrink: 0,
            }}>VS</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                {T(lang, 'admin_console')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {T(lang, 'elections_2026')}
              </div>
            </div>
          </a>

          <nav className="admin-sidebar-nav">
            {NAV_ITEMS.map(it => (
              <button key={it.id} onClick={() => setPage(it.id)}
                className="btn btn-ghost"
                style={{
                  justifyContent: 'flex-start', padding: '8px 12px',
                  background: page === it.id ? 'var(--surface-2)' : 'transparent',
                  color: page === it.id ? 'var(--text)' : 'var(--text-2)',
                  fontSize: 13, fontWeight: page === it.id ? 600 : 500,
                  gap: 10,
                }}>
                <Icon name={it.icon} size={16} />
                <span style={{ flex: 1, textAlign: 'left' }}>{T(lang, it.key)}</span>
                {it.hasPendingBadge && surveyorsBadgeCount > 0 && (
                  <span style={{
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                    background: 'var(--accent)', color: 'var(--accent-fg)',
                    fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>{surveyorsBadgeCount}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="admin-sidebar-footer">
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'var(--accent-tint)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600, flexShrink: 0,
            }}>{userInitials(currentUser)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{currentUser?.email || '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Admin</div>
            </div>
            {onLogout && (
              <button onClick={onLogout} className="btn btn-ghost"
                      aria-label={T(lang, 'sign_out')}
                      title={T(lang, 'sign_out')}
                      style={{ padding: 6, color: 'var(--text-3)', flexShrink: 0 }}>
                <Icon name="logout" size={16} />
              </button>
            )}
          </div>
        </aside>

        <main className="admin-main">
          <header className="admin-header">
            <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600 }}>
              {T(lang, activeKey)}
            </div>
            {canSwitchToSurveyor && (
              <button onClick={onSwitchToSurveyor} className="btn btn-ghost"
                      title={T(lang, 'role.switch_to_surveyor')}
                      aria-label={T(lang, 'role.switch_to_surveyor')}
                      style={{
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                        color: 'var(--accent-strong)', background: 'var(--accent-tint)',
                        borderRadius: 6, marginRight: 8,
                      }}>
                {T(lang, 'role.surveyor_short')}
              </button>
            )}
            <LangToggle lang={lang} setLang={setLang} />
          </header>
          <div className="admin-content">
            <div className="admin-content-inner">{children}</div>
          </div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}
