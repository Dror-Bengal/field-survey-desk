import { useMemo } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { useApi } from '../../hooks/useApi.js';
import { adminDashboard } from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

function KpiCard({ label, value, loading }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{
        fontSize: 11, color: 'var(--text-3)', fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '.04em',
      }}>{label}</div>
      <div style={{
        fontSize: 30, fontWeight: 600, marginTop: 4,
        fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
        minHeight: 36,
      }}>
        {loading ? <span style={{
          display: 'inline-block', width: 80, height: 24, marginTop: 4,
          background: 'var(--surface-2)', borderRadius: 4,
        }} /> : value}
      </div>
    </div>
  );
}

// Backend returns one entry per hour-bucket that has data:
//   [{ hour: '2026-05-04T14:00:00Z', count: 12 }, ...]
// Project onto a contiguous 24-hour window ending now, filling zeros.
function bucketsByHour(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const d = new Date(r.hour);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
    map.set(key, r.count);
  }
  const out = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
    out.push({ hour: d.getUTCHours(), count: map.get(key) || 0 });
  }
  return out;
}

export function AdminOverview({ lang }) {
  const { data, loading, error } = useApi(
    ({ signal }) => adminDashboard({ signal }),
    [],
  );

  const kpi = data?.kpi || {};
  const hours = useMemo(() => bucketsByHour(data?.responses_by_hour), [data]);
  const regions = data?.responses_by_region || [];
  const maxHr = Math.max(1, ...hours.map(h => h.count));
  const maxRg = Math.max(1, ...regions.map(r => r.count));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div style={{
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          padding: 12, borderRadius: 10, fontSize: 13,
        }}>{error.message}</div>
      )}

      <div className="admin-kpi-row">
        <KpiCard loading={loading} label={T(lang, 'total_responses')}
                 value={(kpi.total_responses ?? 0).toLocaleString()} />
        <KpiCard loading={loading} label={T(lang, 'active_today')}
                 value={kpi.active_surveyors_today ?? 0} />
        <KpiCard loading={loading} label={T(lang, 'settlements_covered')}
                 value={kpi.settlements_covered ?? 0} />
        <KpiCard loading={loading} label="Settlement coverage"
                 value={`${kpi.coverage_pct ?? 0}%`} />
      </div>

      <div className="admin-chart-row">
        <div className="card" style={{ padding: 16 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{T(lang, 'responses_per_hour')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{T(lang, 'last_24h')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, height: 160 }}>
            {hours.map((h, i) => (
              <div key={i} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{
                    width: '100%',
                    height: `${(h.count / maxHr) * 100}%`,
                    background: h.count === 0 ? 'var(--surface-3)' : 'var(--accent)',
                    borderRadius: '3px 3px 0 0',
                    minHeight: h.count > 0 ? 2 : 4,
                  }} />
                </div>
                <div style={{
                  height: 12, fontSize: 9, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums',
                }}>{h.hour % 4 === 0 ? String(h.hour).padStart(2, '0') : ''}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{T(lang, 'by_region')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{T(lang, 'coverage')}</div>
          </div>
          {(loading || regions.length === 0) ? (
            <div style={{ padding: 20, color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>
              {loading ? '…' : T(lang, 'no_results')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {regions.map(r => (
                <div key={r.region || 'unknown'} style={{
                  display: 'grid', gridTemplateColumns: '120px 1fr 60px',
                  alignItems: 'center', gap: 10, fontSize: 12,
                }}>
                  <span style={{
                    color: 'var(--text-2)', fontWeight: 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{r.region || '—'}</span>
                  <div style={{
                    height: 8, background: 'var(--surface-2)',
                    borderRadius: 999, overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${(r.count / maxRg) * 100}%`,
                      height: '100%',
                      background: r.count === 0 ? 'var(--surface-3)' :
                        `oklch(0.55 0.08 ${200 - (r.count / maxRg) * 80})`,
                      borderRadius: 999,
                    }} />
                  </div>
                  <span className="tabular" style={{ textAlign: 'right', color: 'var(--text-2)' }}>
                    {r.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
