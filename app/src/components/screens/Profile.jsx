import { Icon } from '../ui/Icon.jsx';
import { AppHeader } from '../ui/AppHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { meGet } from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

function StatCard({ value, label, sub }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{
        fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
      }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{sub}</div>
    </div>
  );
}

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2);
}

export function ScreenProfile({ onBack, onSignOut, onEndSession, lang }) {
  const { data, loading, error } = useApi(({ signal }) => meGet({ signal }), []);

  const fullName = data?.full_name || '';
  const phone = data?.phone || '';
  const responsesToday = data?.stats?.responses_today ?? '—';
  const settlementsToday = data?.stats?.settlements_today ?? '—';
  const activeSession = data?.active_session || null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', minHeight: 0 }}>
      <AppHeader onBack={onBack} title={T(lang, 'profile')} />
      <div className="scroll-y" style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'var(--accent-tint)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 600, flexShrink: 0,
          }}>{loading ? '…' : initials(fullName)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 16, fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {loading ? (('Loading…')) : (fullName || '—')}
            </div>
            <div style={{
              fontSize: 13, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {phone}
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
            padding: 12, borderRadius: 10, fontSize: 13,
          }}>{error.message}</div>
        )}

        {activeSession && (
          <div className="card" style={{ padding: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 600, color: 'var(--st-asked-fg)',
                textTransform: 'uppercase', letterSpacing: '.04em',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--st-asked-dot)' }} />
                {T(lang, 'session_active')}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {T(lang, 'session_started')} {new Date(activeSession.started_at).toISOString().slice(11, 16)}
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <StatCard value={String(responsesToday)} label={T(lang, 'today')} sub={T(lang, 'responses')} />
          <StatCard value={String(settlementsToday)} label={T(lang, 'today')} sub={T(lang, 'settlements_visited')} />
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="divide">
            <button className="btn btn-ghost" onClick={onEndSession}
              style={{ width: '100%', justifyContent: 'space-between', padding: '14px', borderRadius: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="x" size={16} style={{ color: 'var(--st-refused-fg)' }} />
                {T(lang, 'end_session')}
              </span>
              <Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} />
            </button>
            <button className="btn btn-ghost" onClick={onSignOut}
              style={{ width: '100%', justifyContent: 'space-between', padding: '14px', borderRadius: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon name="logout" size={16} />{T(lang, 'sign_out')}
              </span>
              <Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)' }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
