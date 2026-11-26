// Hierarchical scope picker — three tabs (communities, settlements, polling
// stations) over a shared search + chip UX. Owns nothing it can avoid: the
// parent owns the `scope` value (shape: { communities, settlements,
// polling_station_codes }) and an onChange that fires for every pick.
//
// Design notes:
//   - One picker per tab, but only the active tab's network requests fire.
//     Switching tabs preserves its own state — chips for non-active tabs
//     stay live in the parent scope and render as a strip below the tabs
//     so admins always see the full grant.
//   - Settlements come back with ObjectId hex strings; communities and
//     stations are plain string identifiers (community name / station code).
//     The parent groups them into the right scope keys.

import { useMemo, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import {
  adminCommunitiesSearch,
  adminSettlementsSearch,
  adminStationsSearch,
} from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

// Default search providers (admin endpoints). Surveyor-side callers
// override via the `searchFns` prop to point at the public /communities,
// /settlements, /polling-stations routes — same wire shapes, different
// auth gate. Defaulting to admin keeps every existing admin call site
// working unchanged.
export const DEFAULT_SEARCH_FNS = {
  communities: adminCommunitiesSearch,
  settlements: adminSettlementsSearch,
  stations: adminStationsSearch,
};

const MIN_CHARS = 1;
const DEBOUNCE_MS = 300;

function settlementName(s, lang) {
  if (lang === 'en' && s.name_en) return s.name_en;
  return s.name_local || s.name_en || '';
}

// Tab-shaped pill button. Active tab shows the count of its picks so the
// admin can see grant distribution without scanning chips.
function Tab({ active, onClick, label, count }) {
  return (
    <button onClick={onClick}
      style={{
        flex: 1, minHeight: 36, padding: '6px 10px',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accent-fg)' : 'var(--text-2)',
        border: 'none', borderRadius: 8,
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
      {label}
      {count > 0 && (
        <span style={{
          minWidth: 18, padding: '0 5px', height: 18, borderRadius: 9,
          background: active ? 'rgba(255,255,255,0.25)' : 'var(--accent-tint)',
          color: active ? 'var(--accent-fg)' : 'var(--accent-strong)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700,
        }}>{count}</span>
      )}
    </button>
  );
}

function Chip({ label, onRemove, kind = 'accent' }) {
  const palette = kind === 'accent'
    ? { bg: 'var(--accent-tint)', fg: 'var(--accent-strong)' }
    : { bg: 'var(--surface-2)', fg: 'var(--text-2)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 6px 4px 10px', borderRadius: 7,
      background: palette.bg, color: palette.fg,
      fontSize: 12, fontWeight: 500,
      maxWidth: 220, whiteSpace: 'nowrap',
    }}>
      {label}
      {onRemove && (
        <button onClick={onRemove} className="btn btn-ghost"
                aria-label="Remove" style={{ padding: 2, color: 'inherit' }}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

// Each tab body shares this shell so the pick/search/result UX is identical
// across all three. The caller plugs in the search fn, the result row
// renderer, and the "is this row picked" predicate.
function PickerBody({ lang, query, setQuery, searching, results, renderResult }) {
  return (
    <>
      <div style={{ position: 'relative' }}>
        <Icon name="search" size={14} style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-3)',
        }} />
        <input className="input" autoFocus
               value={query} onChange={(e) => setQuery(e.target.value)}
               placeholder={T(lang, 'scope.search_placeholder')}
               style={{ paddingLeft: 34, paddingTop: 8, paddingBottom: 8 }} />
      </div>

      {!query.trim() && (
        <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>
          {T(lang, 'scope.search_hint')}
        </div>
      )}
      {query.trim() && searching && (
        <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>…</div>
      )}
      {query.trim() && !searching && results && results.length === 0 && (
        <div style={{ padding: 14, color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>
          {T(lang, 'scope.no_results')}
        </div>
      )}
      {query.trim() && !searching && results && results.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
          <div className="divide">
            {results.map(renderResult)}
          </div>
        </div>
      )}
    </>
  );
}

function ResultRow({ isPicked, onClick, primary, secondary }) {
  return (
    <button onClick={onClick} className="btn btn-ghost"
      style={{
        width: '100%', justifyContent: 'space-between', borderRadius: 0,
        padding: '10px 14px',
        background: isPicked ? 'var(--accent-tint)' : 'transparent',
      }}>
      <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 13, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{primary}</div>
        {secondary && (
          <div style={{
            fontSize: 11, color: 'var(--text-3)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{secondary}</div>
        )}
      </div>
      {isPicked && <Icon name="check" size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
    </button>
  );
}

// ─── Per-tab pickers ─────────────────────────────────────────────────

function CommunitiesPicker({ scope, onChange, lang, searchFn }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, DEBOUNCE_MS);
  const trimmed = debounced.trim();
  const enabled = trimmed.length >= MIN_CHARS;

  const { data: results, loading } = useApi(
    ({ signal }) => enabled ? searchFn({ q: trimmed, limit: 30 }, { signal }) : Promise.resolve([]),
    [trimmed],
  );

  const pickedSet = useMemo(() => new Set(scope.communities), [scope.communities]);
  const toggle = (name) => {
    if (pickedSet.has(name)) onChange({ ...scope, communities: scope.communities.filter((c) => c !== name) });
    else onChange({ ...scope, communities: [...scope.communities, name] });
  };

  return (
    <PickerBody lang={lang} query={query} setQuery={setQuery}
                searching={loading} results={results}
                renderResult={(c) => (
                  <ResultRow key={c.name} isPicked={pickedSet.has(c.name)}
                             onClick={() => toggle(c.name)}
                             primary={c.name}
                             secondary={`${c.region} · ${T(lang, 'scope.community_settlement_count').replace('{n}', c.settlement_count)}`} />
                )} />
  );
}

function SettlementsPicker({ scope, onChange, lang, searchFn }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, DEBOUNCE_MS);
  const trimmed = debounced.trim();
  const enabled = trimmed.length >= 3; // existing endpoint needs ≥3

  const { data: results, loading } = useApi(
    ({ signal }) => enabled ? searchFn({ q: trimmed }, { signal }) : Promise.resolve([]),
    [trimmed],
  );

  const pickedSet = useMemo(() => new Set(scope.settlements), [scope.settlements]);
  const toggle = (s) => {
    if (pickedSet.has(s.id)) onChange({ ...scope, settlements: scope.settlements.filter((id) => id !== s.id) });
    else onChange({ ...scope, settlements: [...scope.settlements, s.id] });
  };

  return (
    <PickerBody lang={lang} query={query} setQuery={setQuery}
                searching={loading} results={results}
                renderResult={(s) => (
                  <ResultRow key={s.id} isPicked={pickedSet.has(s.id)}
                             onClick={() => toggle(s)}
                             primary={settlementName(s, lang)}
                             secondary={s.region} />
                )} />
  );
}

function StationsPicker({ scope, onChange, lang, searchFn }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, DEBOUNCE_MS);
  const trimmed = debounced.trim();
  const enabled = trimmed.length >= MIN_CHARS;

  const { data: results, loading } = useApi(
    ({ signal }) => enabled ? searchFn({ q: trimmed, limit: 30 }, { signal }) : Promise.resolve([]),
    [trimmed],
  );

  const pickedSet = useMemo(() => new Set(scope.polling_station_codes), [scope.polling_station_codes]);
  const toggle = (st) => {
    if (pickedSet.has(st.code)) onChange({ ...scope, polling_station_codes: scope.polling_station_codes.filter((c) => c !== st.code) });
    else onChange({ ...scope, polling_station_codes: [...scope.polling_station_codes, st.code] });
  };

  return (
    <PickerBody lang={lang} query={query} setQuery={setQuery}
                searching={loading} results={results}
                renderResult={(st) => (
                  <ResultRow key={st.code} isPicked={pickedSet.has(st.code)}
                             onClick={() => toggle(st)}
                             primary={st.code}
                             secondary={`${lang === 'en' && st.settlement_name_en ? st.settlement_name_en : st.settlement_name_local} · ${st.region}`} />
                )} />
  );
}

// ─── Composite ───────────────────────────────────────────────────────

export function ScopePicker({ scope, onChange, lang, chipLabels, searchFns = DEFAULT_SEARCH_FNS }) {
  const [tab, setTab] = useState('settlements');

  const counts = {
    communities: scope.communities.length,
    settlements: scope.settlements.length,
    polling_station_codes: scope.polling_station_codes.length,
  };

  // Chip strip — always-visible summary of every active grant across tabs.
  // chipLabels is provided by the parent so settlement IDs become names and
  // stations get their settlement context. Falls back to the raw identifier
  // when a label can't be resolved.
  const labelForCommunity = (name) => name;
  const labelForSettlement = (id) => chipLabels?.settlements?.[id] || id;
  const labelForStation = (code) => chipLabels?.stations?.[code] || code;

  const removeCommunity = (name) =>
    onChange({ ...scope, communities: scope.communities.filter((c) => c !== name) });
  const removeSettlement = (id) =>
    onChange({ ...scope, settlements: scope.settlements.filter((s) => s !== id) });
  const removeStation = (code) =>
    onChange({ ...scope, polling_station_codes: scope.polling_station_codes.filter((c) => c !== code) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Tab row */}
      <div style={{
        display: 'flex', gap: 4, padding: 4, borderRadius: 10,
        background: 'var(--surface-2)',
      }}>
        <Tab active={tab === 'communities'}  onClick={() => setTab('communities')}
             label={T(lang, 'scope.communities')} count={counts.communities} />
        <Tab active={tab === 'settlements'}  onClick={() => setTab('settlements')}
             label={T(lang, 'scope.settlements')} count={counts.settlements} />
        <Tab active={tab === 'stations'}     onClick={() => setTab('stations')}
             label={T(lang, 'scope.stations')} count={counts.polling_station_codes} />
      </div>

      {/* Cross-tab chip strip — every grant visible at once */}
      {(scope.communities.length > 0 || scope.settlements.length > 0 || scope.polling_station_codes.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {scope.communities.map((c) => (
            <Chip key={`com-${c}`} label={labelForCommunity(c)}
                  onRemove={() => removeCommunity(c)} />
          ))}
          {scope.settlements.map((id) => (
            <Chip key={`set-${id}`} label={labelForSettlement(id)}
                  onRemove={() => removeSettlement(id)} />
          ))}
          {scope.polling_station_codes.map((code) => (
            <Chip key={`sta-${code}`} label={labelForStation(code)} kind="muted"
                  onRemove={() => removeStation(code)} />
          ))}
        </div>
      )}

      {/* Active tab body */}
      {tab === 'communities' && <CommunitiesPicker scope={scope} onChange={onChange} lang={lang} searchFn={searchFns.communities} />}
      {tab === 'settlements' && <SettlementsPicker scope={scope} onChange={onChange} lang={lang} searchFn={searchFns.settlements} />}
      {tab === 'stations'    && <StationsPicker    scope={scope} onChange={onChange} lang={lang} searchFn={searchFns.stations} />}
    </div>
  );
}

// Helper exported for parents that want to summarize a scope in a sentence
// ("2 communities · 3 settlements · 1 station"). Keeps the i18n key in sync
// with the picker's tab labels.
export function summarizeScope(scope, lang) {
  return T(lang, 'scope.summary')
    .replace('{c}', scope.communities?.length ?? 0)
    .replace('{s}', scope.settlements?.length ?? 0)
    .replace('{p}', scope.polling_station_codes?.length ?? 0);
}

export function emptyScope() {
  return { communities: [], settlements: [], polling_station_codes: [] };
}

export function scopeIsEmpty(scope) {
  return (scope.communities?.length ?? 0) === 0
      && (scope.settlements?.length ?? 0) === 0
      && (scope.polling_station_codes?.length ?? 0) === 0;
}
