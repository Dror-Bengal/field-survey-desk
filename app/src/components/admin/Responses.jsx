import { useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatAddressDisplay } from '../../lib/addressDisplay.js';
import { adminResponses, adminResponsesCsv } from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

// Render a denormalized join's name field with a sensible fallback.
// `null` arrives when the FK target was deleted between write and read; the
// em-dash distinguishes that from "no value applicable here" (e.g. voter on
// a not_home row, where voter_id was always null).
function nameOrDash(obj, field = 'full_name') {
  return obj && obj[field] ? obj[field] : '—';
}

function partyShort(candidate, lang) {
  if (!candidate) return '—';
  // Use the language-specific short label when present; fall back to full
  // name. non_answer rows shouldn't reach here (voter_id is null) but the
  // guard keeps the table render defensive.
  if (lang === 'en' && candidate.short_en) return candidate.short_en;
  if (candidate.short_local) return candidate.short_local;
  return candidate.name_local || candidate.name_en || '—';
}

function Th({ children, width }) {
  return <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, width }}>{children}</th>;
}

function FilterChip({ label, value, options, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px 4px 12px',
      background: 'var(--surface-2)', borderRadius: 7, fontSize: 12,
    }}>
      <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{
          appearance: 'none', border: 0, background: 'transparent',
          padding: '4px 18px 4px 6px',
          fontWeight: 500, color: 'var(--text)', cursor: 'pointer',
          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='gray' d='M0 0h10L5 6z'/></svg>\")",
          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center',
          fontFamily: 'inherit', fontSize: 13,
        }}>
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

function downloadBlob(text, filename, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick before revoking, otherwise some browsers cancel.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AdminResponses({ lang }) {
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const filters = { page, limit: 30, ...(tier ? { tier } : {}) };

  const { data, loading, error } = useApi(
    ({ signal }) => adminResponses(filters, { signal }),
    [page, tier],
  );

  const items = data?.items || [];
  const meta = data?.page || { page: 1, pages: 1, total: 0 };

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const csv = await adminResponsesCsv(tier ? { tier } : {});
      const today = new Date().toISOString().slice(0, 10);
      downloadBlob(csv, `voters-responses-${today}.csv`);
    } catch (err) {
      setExportError(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{
        padding: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <FilterChip label={T(lang, 'tier')} value={tier} options={[
          { v: '',   l: T(lang, 'all') },
          { v: 'T1', l: 'T1' }, { v: 'T2', l: 'T2' }, { v: 'T3', l: 'T3' },
        ]} onChange={(v) => { setTier(v); setPage(1); }} />
        <div style={{ flex: 1 }} />
        <button onClick={exportCsv} className="btn" disabled={exporting}
                style={{ padding: '8px 12px', fontSize: 13, opacity: exporting ? 0.6 : 1 }}>
          <Icon name="download" size={13} />{T(lang, 'export_csv')}
        </button>
      </div>

      {error && (
        <div style={{
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          padding: 12, borderRadius: 10, fontSize: 13,
        }}>{error.message}</div>
      )}
      {exportError && (
        <div style={{
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          padding: 8, borderRadius: 8, fontSize: 12,
        }}>{exportError}</div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: 'var(--surface-2)' }}>
            <tr style={{
              color: 'var(--text-3)', fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              <Th>{T(lang, 'when')}</Th>
              <Th width={70}>{T(lang, 'tier')}</Th>
              <Th>{T(lang, 'admin.responses_surveyor')}</Th>
              <Th>{T(lang, 'address')}</Th>
              <Th>{T(lang, 'admin.responses_voter')}</Th>
              <Th width={120}>Response type</Th>
              <Th width={80}>{T(lang, 'admin.responses_party')}</Th>
              <Th>{T(lang, 'flags')}</Th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)' }}>
                {T(lang, 'admin.no_results')}
              </td></tr>
            )}
            {!loading && items.map(r => {
              const ts = new Date(r.server_ts);
              // BE shipped parsed display fields. Falls back to the raw
              // address_key for old payloads (graceful degradation while
              // the BE droplet is still on a pre-enrich build).
              const formattedAddress = r.parsed
                ? formatAddressDisplay(r.parsed.street, r.parsed.street_modifier, r.parsed.house, lang)
                : r.address_key;
              return (
                <tr key={r.id} data-response-id={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{
                    padding: '10px 14px', color: 'var(--text-2)',
                    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                  }}>
                    {ts.toISOString().slice(5, 10)}{' '}
                    <span style={{ color: 'var(--text-3)' }}>{ts.toISOString().slice(11, 16)}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}><span className="tier-badge">{r.tier}</span></td>
                  <td style={{
                    padding: '10px 14px', color: 'var(--text)', fontSize: 13,
                    maxWidth: 180,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }} title={r.surveyor?.email || ''}>
                    {nameOrDash(r.surveyor)}
                  </td>
                  <td style={{
                    padding: '10px 14px', color: 'var(--text-2)', fontSize: 13,
                    maxWidth: 320,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }} title={formattedAddress}>
                    {formattedAddress}
                  </td>
                  <td style={{
                    padding: '10px 14px', color: 'var(--text)', fontSize: 13,
                    maxWidth: 200,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {nameOrDash(r.voter)}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12 }}>{r.response_type.replaceAll('_', ' ')}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 500 }}>
                    {partyShort(r.candidate, lang)}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {r.flags && r.flags.length > 0 ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {r.flags.map(f => (
                          <span key={f} className="status-pill status-flag"
                                style={{ fontSize: 10, padding: '2px 6px' }}>{f}</span>
                        ))}
                      </div>
                    ) : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{
          padding: '10px 14px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--text-3)',
        }}>
          <span>
            {meta.total.toLocaleString()} {meta.total === 1 ? 'result' : 'results'}
          </span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button className="btn" disabled={meta.page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    style={{ padding: '4px 10px', fontSize: 12, opacity: meta.page <= 1 ? 0.5 : 1 }}>
              <Icon name="chevron-left" size={12} />{T(lang, 'admin.prev_page')}
            </button>
            <span style={{ alignSelf: 'center', padding: '0 8px', fontVariantNumeric: 'tabular-nums' }}>
              {meta.page} / {meta.pages}
            </span>
            <button className="btn" disabled={meta.page >= meta.pages}
                    onClick={() => setPage(p => p + 1)}
                    style={{ padding: '4px 10px', fontSize: 12, opacity: meta.page >= meta.pages ? 0.5 : 1 }}>
              {T(lang, 'admin.next_page')}<Icon name="chevron-right" size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
