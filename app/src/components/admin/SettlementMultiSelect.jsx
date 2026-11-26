// Reusable settlement multi-select. Owns the search-input + chip-list +
// results-list UI; the parent owns the `picked` state and submission. Both
// SurveyorApproveModal and SurveyorEditSettlementsModal mount this so the
// pick-settlements UX stays consistent.

import { useMemo, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { adminSettlementsSearch } from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

function settlementName(s, lang) {
  if (lang === 'en' && s.name_en) return s.name_en;
  return s.name_local || s.name_en || '';
}

// Convert a backend settlement record into the chip shape we hold internally.
// Keeping the original record on the chip means we can re-render the label
// in either language without another fetch.
export function toChip(s, lang) {
  return {
    id: s.id,
    label: settlementName(s, lang),
    region: s.region,
  };
}

export function SettlementMultiSelect({
  picked,
  onPickedChange,
  lang,
  seedLoading = false,   // parent uses this when hydrating chips on mount
  emptyHint,             // optional sub-text under the search box
}) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const enabled = debouncedQuery.trim().length >= 3;

  const { data: results, loading: searching } = useApi(
    ({ signal }) => enabled
      ? adminSettlementsSearch({ q: debouncedQuery.trim() }, { signal })
      : Promise.resolve([]),
    [debouncedQuery],
  );

  const pickedIds = useMemo(() => new Set(picked.map(p => p.id)), [picked]);

  const togglePick = (s) => {
    if (pickedIds.has(s.id)) {
      onPickedChange(picked.filter(p => p.id !== s.id));
    } else {
      onPickedChange([...picked, toChip(s, lang)]);
    }
  };

  const removeChip = (id) => onPickedChange(picked.filter(p => p.id !== id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {emptyHint && (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{emptyHint}</div>
      )}

      {seedLoading && picked.length === 0 ? (
        <div style={{ padding: 6, color: 'var(--text-3)', fontSize: 12 }}>…</div>
      ) : picked.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {picked.map(p => (
            <span key={p.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 6px 4px 10px', borderRadius: 7,
              background: 'var(--accent-tint)', color: 'var(--accent-strong)',
              fontSize: 12, fontWeight: 500,
            }}>
              {p.label}
              <button onClick={() => removeChip(p.id)} className="btn btn-ghost"
                      aria-label="Remove" style={{ padding: 2, color: 'inherit' }}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ position: 'relative' }}>
        <Icon name="search" size={14} style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-3)',
        }} />
        <input className="input" autoFocus
               value={query} onChange={(e) => setQuery(e.target.value)}
               placeholder={T(lang, 'admin.search_settlements')}
               // Don't override fontSize here — the global rule enforces 16px min
               // to prevent iOS zoom-on-focus when an admin picks settlements
               // from a phone (Edit/Approve modals).
               style={{ paddingLeft: 34, paddingTop: 8, paddingBottom: 8 }} />
      </div>

      {!enabled && (
        <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>
          {T(lang, 'admin.search_settlements')}
        </div>
      )}
      {enabled && searching && (
        <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>…</div>
      )}
      {enabled && !searching && results && results.length === 0 && (
        <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>
          {T(lang, 'admin.no_results')}
        </div>
      )}
      {enabled && !searching && results && results.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
          <div className="divide">
            {results.map(s => {
              const isPicked = pickedIds.has(s.id);
              return (
                <button key={s.id} onClick={() => togglePick(s)} className="btn btn-ghost"
                  style={{
                    width: '100%', justifyContent: 'space-between', borderRadius: 0,
                    padding: '10px 14px',
                    background: isPicked ? 'var(--accent-tint)' : 'transparent',
                  }}>
                  <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{settlementName(s, lang)}</div>
                    <div style={{
                      fontSize: 11, color: 'var(--text-3)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{s.region}</div>
                  </div>
                  {isPicked && <Icon name="check" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
