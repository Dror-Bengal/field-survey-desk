import { useCallback, useMemo, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { AppHeader } from '../ui/AppHeader.jsx';
import { List } from 'react-window';
import { useApi } from '../../hooks/useApi.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useScrollMemory, useToggleMemory } from '../../hooks/useScrollMemory.js';
import { formatAddressDisplay, formatStreetForDisplay } from '../../lib/addressDisplay.js';
import { settlementGetStreets, voterSearch } from '../../lib/endpoints.js';
import { STATUS_LABEL } from '../ui/helpers.js';
import { StatusPill } from '../ui/StatusPill.jsx';
import { T } from '../../i18n.js';

const UNVISITED_FIRST_KEY = 'voter-survey:browse-unvisited-first';

function settlementName(s, lang) {
  if (lang === 'en' && s.name_en) return s.name_en;
  return s.name_local || s.name_en || '';
}

// Backend returns street as a single canonical string.
// Falls back to the second segment of the first house's address_key when
// `st.street` is null but the address_key still encodes the street — keeps
// settlement|street|house|apt, so [1] is the street segment.
function streetLabel(st) {
  if (st?.street) return st.street;
  const firstHouse = st?.houses?.[0];
  const akey = firstHouse?.address_key;
  if (typeof akey === 'string') {
    const seg = akey.split('|')[1];
    if (seg) return seg;
  }
  return '';
}

// "St. 1/6" for one code, "St. 1/6, 1/7" for two, "St. 1/6 +N" for many.
// Returns '' on empty/missing input so callers can render-or-skip with a
// single truthy check.
function formatStations(codes, lang) {
  if (!Array.isArray(codes) || codes.length === 0) return '';
  // station_short is a template with a {code} placeholder so the prefix
  // localized unit. Multiple codes get joined into the placeholder slot.
  const tmpl = T(lang, 'station_short') || '{code}';
  let codeStr;
  if (codes.length === 1) codeStr = String(codes[0]);
  else if (codes.length === 2) codeStr = `${codes[0]}, ${codes[1]}`;
  else codeStr = `${codes[0]} +${codes.length - 1}`;
  return tmpl.replace('{code}', codeStr);
}

// formatStreetForDisplay + formatAddressDisplay live in src/lib/addressDisplay.js
// Re-exported here for backwards compatibility with existing tests + callers.
export { formatStreetForDisplay };
// chip stays hidden when the backend hasn't shipped voter_count yet (graceful
// degradation) and so we don't render "0 res." on truly empty addresses.
export function formatResidentsCount(n, lang) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '';
  const tmpl = T(lang, 'residents_count_short') || '{n}';
  return tmpl.replace('{n}', String(n));
}

// Visit progress = ratio of voters at this house that the current surveyor
// has at least one response for (asked_count / voter_count). The BE bubbles
// asked_count up per-house in /settlements/:id/streets — see BE-ASKED-COUNT.
// Returns 'none' for never-visited (no chip), 'partial' for in-progress
// (orange chip "{n}/{total}"), and 'complete' for fully-asked (green ✓).
//
// 'unknown' is returned when the BE hasn't shipped asked_count yet (older
// deploy on the droplet); callers omit the chip in that case so we don't
// fabricate a "complete" state from missing data.
export function visitStatus(house) {
  const total = house?.voter_count;
  const asked = house?.asked_count;
  if (typeof total !== 'number' || total <= 0) return 'none';
  if (typeof asked !== 'number' || asked < 0) return 'unknown';
  if (asked === 0) return 'none';
  if (asked >= total) return 'complete';
  return 'partial';
}

// Same width/height/font-size shape as the residents chip so the row
// alignment doesn't shift when this chip appears next to it.
function VisitChip({ house, lang }) {
  const status = visitStatus(house);
  if (status === 'none' || status === 'unknown') return null;
  const isComplete = status === 'complete';
  const label = isComplete
    ? T(lang, 'visit.complete')
    : T(lang, 'visit.partial')
        .replace('{asked}', String(house.asked_count))
        .replace('{total}', String(house.voter_count));
  return (
    <span style={{
      flexShrink: 0,
      fontSize: 11, fontWeight: 600,
      // Reuse the existing status palette — green tones for "complete" come
      // from the same vars the Address detail uses for "asked", and orange
      // tones for "partial" come from the "refused" hue (60° / orange).
      color:      isComplete ? 'var(--st-asked-fg)' : 'var(--st-refused-fg)',
      background: isComplete ? 'var(--st-asked-bg)' : 'var(--st-refused-bg)',
      padding: '3px 7px', borderRadius: 6,
      fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

// Sort houses such that un-visited (asked_count == 0) come first, then
// partial (0 < asked < total), then complete (asked >= total). Within each
// bucket the existing input order is preserved (BE already sorts by
// modifier + numeric house). Pure function — exported for unit tests.
export function sortHousesUnvisitedFirst(houses) {
  if (!Array.isArray(houses)) return [];
  const bucket = (h) => {
    const s = visitStatus(h);
    if (s === 'partial') return 1;
    if (s === 'complete') return 2;
    return 0; // 'none' and 'unknown' both sort first
  };
  // Stable sort: bucket asc, original index asc.
  return houses
    .map((h, i) => ({ h, i, b: bucket(h) }))
    .sort((a, b) => a.b - b.b || a.i - b.i)
    .map((x) => x.h);
}

// Read/write a single boolean preference for the un-visited-first sort.
// Persists across reloads in localStorage so the surveyor doesn't have to
// re-toggle every time they reopen the app.
function readUnvisitedFirstPref() {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(UNVISITED_FIRST_KEY) === '1'; } catch { return false; }
}
function useUnvisitedFirst() {
  const [on, setOn] = useState(readUnvisitedFirstPref);
  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      try { localStorage.setItem(UNVISITED_FIRST_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }, []);
  return [on, toggle];
}
// Used by row primary lines + downstream screen titles.
export function streetWithModifier(group) {
  const base = streetLabel(group);
  if (group?.modifier) return base ? `${base} · ${group.modifier}` : group.modifier;
  return base;
}

// ── Search-input normalization ───────────────────────────────────────
// a literal substring filter never matches.
//
// We:
//     short canonical Latin tokens so the same normalization can build the
//     needle and the haystack from arbitrary mixed input
//   • lowercase + collapse whitespace
export function normalizeAddrText(s) {
  if (!s) return '';
  // Pad with whitespace so the leading/trailing markers can be matched by the
  // whitespace-bounded regexes below. JS \b only honors Latin word chars, so
  // explicitly instead.
  let v = ` ${String(s).toLowerCase().replace(/\s+/g, ' ')} `;
  return v.replace(/\s+/g, ' ').trim();
}

const MODIFIER_TOKENS = new Set(['nrb', 'tghm', 'mkrsh', 'phkgh']);

// Cap how many search rows we actually mount in the DOM. 200 is the comfort
// limit on phone scrolling; the truncation notice tells the user to refine
// when their query has more matches than that.
const SEARCH_RENDER_CAP = 200;

// Strict separation: typing a main-street name (no modifier marker) only
// returns main-street rows; typing a modifier marker only returns rows
// inside that flavor of inner street. Different physical place ≠ different
// row, so there's no fuzzy union here.
export function searchHouses(allHouses, query) {
  const needle = normalizeAddrText(query);
  if (!needle) return allHouses;

  const tokens = needle.split(' ').filter(Boolean);
  const wantsModifier = tokens.some((t) => MODIFIER_TOKENS.has(t));

  return allHouses.filter(({ st, house }) => {
    const hasModifier = !!st.modifier;
    if (wantsModifier && !hasModifier) return false;
    if (!wantsModifier && hasModifier) return false;

    const haystack = normalizeAddrText(
      `${streetLabel(st)} ${st.modifier || ''} ${house?.house || ''}`,
    );
    return tokens.every((t) => haystack.includes(t));
  });
}

// Re-group the backend's per-street rows into per-(street, modifier) rows so
// houses on a lane / microdistrict separate from their parent street. The
// modifier-less bucket lands first (preserves the user's mental model that
// alphabetically after it.
//
// Returns: Array<{ street: string, modifier: string, houses: House[] }>
// where `street` is whatever streetLabel() resolves to (with address_key
// fallback) and `modifier` may be ''.
export function buildGroups(streets) {
  const out = [];
  for (const st of streets || []) {
    const street = streetLabel(st);
    if (!street) continue;
    const buckets = new Map();
    for (const h of st.houses || []) {
      const mod = h.street_modifier || '';
      if (!buckets.has(mod)) buckets.set(mod, []);
      buckets.get(mod).push(h);
    }
    if (buckets.has('')) {
      out.push({ street, modifier: '', houses: buckets.get('') });
    }
    const others = [...buckets.keys()].filter((k) => k).sort();
    for (const mod of others) {
      out.push({ street, modifier: mod, houses: buckets.get(mod) });
    }
  }
  return out;
}

// Shared two-line address row (FE-UNIFIED-ADDRESS-ROW). Replaces the
// previous "avatar + primary + secondary" layout — surveyors couldn't
// predict where the house number would appear because the layout
// bifurcated based on whether the house was numeric. The unified shape:
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │ [5 res.] [3/5] [St. 1/3]                                    │  bottom: chip strip
//   └─────────────────────────────────────────────────────────────┘
//
// Used by:
//   - AddressRow (Search tab)
//   - HouseRow inside an expanded BrowseStreet (with `indent` prop)
// Anywhere that renders an address as a tappable row should pass through
// here for consistency.
//
// `indent`: when true, the row is rendered with extra left padding for
// nesting under the BrowseStreet group header — keeps the visual that
// these rows belong to the parent street without re-introducing the
// avatar block.
export function AddressListRow({
  street, modifier, house, voter_count, asked_count, polling_station_codes,
  lang, onClick, style, indent = false,
}) {
  const formalAddr = formatAddressDisplay(street, modifier, house, lang);
  const fallback = ('Unnamed');
  const top = formalAddr || fallback;
  const stations = formatStations(polling_station_codes, lang);
  const residents = formatResidentsCount(voter_count, lang);

  return (
    <button onClick={onClick}
      style={{
        ...style, // react-window injects absolute position + height
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', height: 60,
        padding: indent ? '10px 14px 10px 28px' : '10px 14px',
        background: 'transparent',
        border: 0, borderTop: '1px solid var(--border)',
        textAlign: 'left', cursor: 'pointer',
        fontFamily: 'inherit', color: 'inherit',
      }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{
          fontSize: 15, fontWeight: 500, color: 'var(--text)', lineHeight: 1.25,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{top}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 18 }}>
          {residents && (
            <span style={{
              flexShrink: 0,
              fontSize: 11, fontWeight: 500,
              color: 'var(--text-2)', background: 'var(--surface-2)',
              padding: '2px 7px', borderRadius: 6,
              borderLeft: '3px solid var(--accent)',
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>{residents}</span>
          )}
          <VisitChip house={{ voter_count, asked_count }} lang={lang} />
          {stations && (
            <span style={{
              flexShrink: 0,
              fontSize: 11, fontWeight: 500,
              color: 'var(--text-2)', background: 'var(--surface-2)',
              padding: '2px 7px', borderRadius: 6,
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>{stations}</span>
          )}
        </div>
      </div>
      <Icon name="chevron-right" size={16}
        style={{ color: 'var(--text-3)', flexShrink: 0, marginLeft: 6 }} />
    </button>
  );
}

// Search-tab AddressRow now just adapts the (st, house) shape to the
// shared row.
function AddressRow({ st, house, lang, onClick }) {
  return (
    <AddressListRow
      street={streetLabel(st)} modifier={st.modifier}
      house={house.house}
      voter_count={house.voter_count} asked_count={house.asked_count}
      polling_station_codes={house.polling_station_codes}
      lang={lang} onClick={onClick} />
  );
}

// Threshold above which the expanded house list virtualizes + shows the
// per-street filter input. Below this, we render flat for simplicity (the
// virtual-list overhead would dwarf the gain on small lists). 30 also
// happens to be the cut where iOS scrolling latency starts mattering.
const HOUSE_VIRTUALIZE_THRESHOLD = 30;
// Height per house row in the virtualized list. Matches the unified
// AddressListRow layout (60px fixed; FE-UNIFIED-ADDRESS-ROW).
const HOUSE_ROW_HEIGHT_PX = 60;
// Cap the visible window of the virtual list so a 200-house street doesn't
// take up the entire viewport on tap. The surveyor can scroll within this
// fixed window or use the filter to narrow further.
const HOUSE_VIRTUAL_MAX_HEIGHT = 480;

// Expanded-street house row uses the same shared layout as the Search
// tab's AddressRow — surveyors always read the same shape regardless of
// which tab they're on. The `indent` flag adds a small extra left
// padding so these rows visually nest under the parent street group
// header without requiring the old avatar block.
function HouseRow({ h, st, lang, onPick, style }) {
  return (
    <AddressListRow
      street={st?.street} modifier={st?.modifier}
      house={h.house}
      voter_count={h.voter_count} asked_count={h.asked_count}
      polling_station_codes={h.polling_station_codes}
      lang={lang}
      onClick={() => onPick(h)}
      style={style}
      indent />
  );
}

// react-window v2 row adapter. The component receives index + style from
// the List and the rest from our `rowProps`. AddressListRow accepts the
// inline style (absolute positioning) directly, so we pass it through.
function VirtualHouseRow({ index, style, rows, st, lang, onPick }) {
  return (
    <HouseRow h={rows[index]} st={st} lang={lang} onPick={onPick} style={style} />
  );
}

// Filter houses by substring on the displayed `house` field. Numeric
// applied to the raw house string.
function filterHousesByQuery(houses, q) {
  const trimmed = (q || '').trim().toLowerCase();
  if (!trimmed) return houses;
  return houses.filter((h) => String(h.house || '').toLowerCase().includes(trimmed));
}

function BrowseStreet({ st, lang, onPickHouse, expansionKey }) {
  // Expansion state is persisted across mounts so a surveyor returning
  // from Address → Work doesn't see every street collapsed again. The key
  // includes settlement + street + modifier so two streets with the same
  // name in different settlements don't share state.
  const [open, setOpen] = useToggleMemory(expansionKey);
  const [unvisitedFirst, toggleUnvisitedFirst] = useUnvisitedFirst();
  // Per-street filter — narrows the house list as the surveyor types. Only
  // shown when the street has a non-trivial number of houses (the input
  // would just be visual noise on a 5-house street). State stays local
  // because re-expanding a different street should reset the filter.
  const [filter, setFilter] = useState('');
  const filterDebounced = useDebounce(filter, 200);
  // Default order is the BE-supplied one (modifier + numeric house), which
  // is what the surveyor expects when scanning a familiar street. The
  // un-visited-first toggle re-buckets by visit status while preserving
  // numeric order within each bucket — that way two adjacent un-visited
  // houses still appear in numeric sequence.
  const orderedHouses = useMemo(
    () => unvisitedFirst ? sortHousesUnvisitedFirst(st.houses) : st.houses,
    [st.houses, unvisitedFirst],
  );
  const visibleHouses = useMemo(
    () => filterHousesByQuery(orderedHouses, filterDebounced),
    [orderedHouses, filterDebounced],
  );

  const showFilter = st.houses.length >= HOUSE_VIRTUALIZE_THRESHOLD;
  const virtualize = visibleHouses.length >= HOUSE_VIRTUALIZE_THRESHOLD;
  const virtualHeight = Math.min(
    visibleHouses.length * HOUSE_ROW_HEIGHT_PX,
    HOUSE_VIRTUAL_MAX_HEIGHT,
  );
  // address ends up in `house`. Show a placeholder so the row isn't a void.
  // doesn't read "1" as ambiguous between street and house number.
  // Falls back to just the modifier when street is missing, then to the
  // language fallback.
  const baseStreet = formatStreetForDisplay(streetLabel(st));
  const fallback = ('Unnamed');
  const labelText = baseStreet
    ? (st.modifier ? `${baseStreet} · ${st.modifier}` : baseStreet)
    : (st.modifier || fallback);

  return (
    <div>
      <button className="btn btn-ghost" onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', justifyContent: 'space-between',
          padding: '12px 14px', borderRadius: 0,
          // .btn sets line-height:1 globally, which crashes stacked title+subtitle
          // paint outside a 1.0 line box). Restore comfortable line spacing here
          // and propagate it to descendants.
          lineHeight: 1.35,
        }}>
        <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 15, fontWeight: 500, lineHeight: 1.35,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{labelText}</div>
          <div style={{
            fontSize: 12, color: 'var(--text-3)', lineHeight: 1.35,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            marginTop: 2,
          }}>
            {st.houses.length} {T(lang, 'houses')}
          </div>
        </div>
        <Icon name="chevron-down" size={16}
          style={{
            color: 'var(--text-3)', flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s',
          }} />
      </button>

      {open && (
        // Vertical list, NOT chip-grid. The previous wrap-flex of .btn chips
        // because .btn { white-space: nowrap } made each chip wider than the
        // viewport with no truncation. Single-column rows with ellipsis are
        // legible at every phone width.
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Sort toggle. Lives at the top of the expanded street view (per
              the FE-VISIT-STATUS ticket) — a small inline switch the
              surveyor can flip to push un-visited houses to the top of
              their list. State is global (single localStorage key), so
              flipping it here also affects every other expanded street. */}
          <button onClick={toggleUnvisitedFirst}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '8px 14px 8px 60px',
              background: unvisitedFirst ? 'var(--accent-tint)' : 'transparent',
              border: 0, borderTop: '1px solid var(--border)',
              textAlign: 'left', cursor: 'pointer',
              color: unvisitedFirst ? 'var(--accent-strong)' : 'var(--text-3)',
              fontSize: 12, fontFamily: 'inherit',
            }}>
            <Icon name={unvisitedFirst ? 'check' : 'chevron-down'} size={12}
                  style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{T(lang, 'visit.show_unvisited')}</span>
          </button>

          {/* Per-street filter input. Hidden on small streets so it doesn't
              add visual weight where there's no friction to relieve.
              Substring match (case-insensitive) on the raw house field —
              works for "12" / "12/3" / compound house numbers. */}
          {showFilter && (
            <div style={{
              padding: '6px 14px 6px 60px', borderTop: '1px solid var(--border)',
              background: 'var(--surface)',
            }}>
              <input className="input"
                value={filter} onChange={(e) => setFilter(e.target.value)}
                placeholder={T(lang, 'list.filter_house_ph')}
                inputMode="search"
                style={{ padding: '6px 10px', fontSize: 13 }} />
            </div>
          )}

          {visibleHouses.length === 0 ? (
            <div style={{
              padding: '10px 14px 14px 60px', fontSize: 13, color: 'var(--text-3)',
              borderTop: '1px solid var(--border)',
            }}>{T(lang, 'no_results')}</div>
          ) : virtualize ? (
            // Virtualized window — only the visible rows + a small overscan
            // are mounted, so a 200-house street renders in O(window) time
            // and stays smooth on iOS. The flat fallback below handles the
            // <30 case where the overhead isn't worth it.
            <div style={{
              borderTop: '1px solid var(--border)',
              height: virtualHeight,
              // Hint to mobile browsers that this is its own scroll surface
              // — prevents the outer page-scroll from "stealing" mid-fling.
              touchAction: 'pan-y',
            }}>
              <List
                rowCount={visibleHouses.length}
                rowHeight={HOUSE_ROW_HEIGHT_PX}
                rowComponent={VirtualHouseRow}
                rowProps={{ rows: visibleHouses, st, lang, onPick: onPickHouse }}
                defaultHeight={virtualHeight}
                overscanCount={6}
                style={{ height: '100%' }} />
            </div>
          ) : (
            visibleHouses.map(h => (
              <HouseRow key={h.address_key} h={h} st={st} lang={lang} onPick={onPickHouse} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ShimmerRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--surface-2)' }} />
      <div style={{ flex: 1, height: 12, background: 'var(--surface-2)', borderRadius: 4, opacity: 0.7 }} />
    </div>
  );
}

// Map BE response_type → status pill bucket. Mirrors the table inside
// Address.jsx; kept private to avoid coupling Work to Address.
const VOTER_SEARCH_STATUS_MAP = {
  named_voter: 'asked',
  inferred_voter: 'asked',
  demographic_only: 'asked',
  undecided: 'asked',
  will_not_vote: 'asked',
  refused: 'refused',
  not_home: 'not_home',
};
function statusFromResponse(lr) {
  if (!lr) return 'pending';
  return VOTER_SEARCH_STATUS_MAP[lr.response_type] || 'pending';
}

// Two-line shape — same family as AddressListRow but the top line carries
// the voter's name (the primary identifier on this surface), and the chip
// row below shows their formal address + station + last-response status.
// No avatar, matching the address-row pattern (FE-UNIFIED-ADDRESS-ROW).
function NameSearchResultRow({ result, lang, onClick, style }) {
  const status = statusFromResponse(result.last_response);
  // surface uses, so a surveyor sees identical strings for one address.
  const addr = formatAddressDisplay(result.street, result.street_modifier, result.house, lang);
  // same way it does on the Search and Browse tabs — one canonical chip.
  const stationLabel = result.polling_station_code
    ? formatStations([result.polling_station_code], lang)
    : '';
  return (
    <button onClick={onClick}
      style={{
        ...style,
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', height: 60,
        padding: '10px 14px',
        background: 'transparent',
        border: 0, borderTop: '1px solid var(--border)',
        textAlign: 'left', cursor: 'pointer',
        fontFamily: 'inherit', color: 'inherit',
      }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{
          fontSize: 15, fontWeight: 500, color: 'var(--text)', lineHeight: 1.25,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{result.full_name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 18 }}>
          {addr && (
            <span style={{
              flex: 1, minWidth: 0,
              fontSize: 11, color: 'var(--text-3)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{addr}</span>
          )}
          {stationLabel && (
            <span style={{
              flexShrink: 0,
              fontSize: 11, fontWeight: 500,
              color: 'var(--text-2)', background: 'var(--surface-2)',
              padding: '2px 7px', borderRadius: 6,
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>{stationLabel}</span>
          )}
          <span style={{ flexShrink: 0 }}>
            <StatusPill kind={status} label={T(lang, STATUS_LABEL[status])} />
          </span>
        </div>
      </div>
      <Icon name="chevron-right" size={16}
        style={{ color: 'var(--text-3)', flexShrink: 0, marginLeft: 6 }} />
    </button>
  );
}

// Self-contained body for the "Search by name" tab. Owns its own debounced
// fetch — the parent Work screen passes the live query value (lifted to
// SurveyorApp so it survives navigation) and the tap handler.
// Exported for tests; not consumed externally.
export const NAME_SEARCH_MIN_CHARS = 2;
const NAME_RESULT_VIRTUALIZE_THRESHOLD = 30;
const NAME_RESULT_ROW_HEIGHT = 60;
const NAME_RESULT_VIRTUAL_MAX_HEIGHT = 480;

// react-window v2 row adapter for name-search results. Passes the inline
// style straight to NameSearchResultRow so the absolutely-positioned
// virtual row geometry doesn't fight the row's own layout.
function VirtualNameRow({ index, style, rows, lang, onPick }) {
  return (
    <NameSearchResultRow result={rows[index]} lang={lang} style={style}
                         onClick={() => onPick(rows[index])} />
  );
}

export function NameSearchTab({ q, setQ, lang, onPickResult }) {
  const debounced = useDebounce(q, 300);
  const trimmed = debounced.trim();
  const enabled = trimmed.length >= NAME_SEARCH_MIN_CHARS;

  const { data, loading, error } = useApi(
    ({ signal }) => enabled ? voterSearch({ q: trimmed, limit: 50 }, { signal })
                            : Promise.resolve({ results: [], total: 0, truncated: false }),
    [trimmed],
  );

  const results = data?.results || [];
  const truncated = !!data?.truncated;
  const total = data?.total ?? results.length;

  // Distinguish "no active session" from other errors so the surveyor sees
  // a helpful explanation rather than a generic "error" toast.
  const noSession = error?.code === 'no_active_session' || error?.status === 403;

  return (
    <>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Icon name="search" size={16}
          style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input className="input" autoFocus
               placeholder={T(lang, 'search.placeholder_name')}
               value={q} onChange={(e) => setQ(e.target.value)}
               style={{ paddingLeft: 38 }} />
      </div>

      {!enabled && !noSession && (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          {T(lang, 'search.min_chars_name')}
        </div>
      )}

      {noSession && (
        <div style={{
          padding: 12, borderRadius: 10, fontSize: 13,
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
        }}>{T(lang, 'search.no_active_session_body')}</div>
      )}

      {enabled && !noSession && error && (
        <div style={{
          padding: 12, borderRadius: 10, fontSize: 13,
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
        }}>{error.message || 'Error'}</div>
      )}

      {enabled && !error && loading && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="divide"><ShimmerRow /><ShimmerRow /><ShimmerRow /></div>
        </div>
      )}

      {enabled && !loading && !error && results.length === 0 && (
        <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
          {T(lang, 'search.no_residents')}
        </div>
      )}

      {enabled && !loading && !error && results.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {results.length >= NAME_RESULT_VIRTUALIZE_THRESHOLD ? (
            // Virtualized — large result sets (the BE caps at 50/100) render
            // smoothly on iOS without paying the full DOM cost.
            <div style={{
              height: Math.min(results.length * NAME_RESULT_ROW_HEIGHT, NAME_RESULT_VIRTUAL_MAX_HEIGHT),
              touchAction: 'pan-y',
            }}>
              <List
                rowCount={results.length}
                rowHeight={NAME_RESULT_ROW_HEIGHT}
                rowComponent={VirtualNameRow}
                rowProps={{ rows: results, lang, onPick: onPickResult }}
                defaultHeight={Math.min(results.length * NAME_RESULT_ROW_HEIGHT, NAME_RESULT_VIRTUAL_MAX_HEIGHT)}
                overscanCount={6}
                style={{ height: '100%' }} />
            </div>
          ) : (
            <div className="divide">
              {results.map((r) => (
                <NameSearchResultRow key={r.id} result={r} lang={lang}
                                     onClick={() => onPickResult(r)} />
              ))}
            </div>
          )}
          {truncated && (
            <div style={{
              padding: 12, fontSize: 12, color: 'var(--text-3)',
              textAlign: 'center', borderTop: '1px solid var(--border)',
            }}>
              {T(lang, 'search.showing_truncated')
                .replace('{n}', String(results.length))
                .replace('{total}', String(total))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function ScreenWork({
  settlement, onPickAddress, onChangeSettlement, onBack, lang,
  // Tab + search queries are owned by SurveyorApp so they survive a round trip
  // through ScreenAddress (otherwise the surveyor lost their search every
  // time they tapped a result and came back). Falls back to local state when
  // the parent forgets to thread them, so this component is still standalone.
  tab: tabProp, setTab: setTabProp,
  query: queryProp, setQuery: setQueryProp,
  nameQuery: nameQueryProp, setNameQuery: setNameQueryProp,
}) {
  const [localTab, setLocalTab] = useState('search');
  const [localQ, setLocalQ] = useState('');
  const [localNameQ, setLocalNameQ] = useState('');
  const tab = tabProp !== undefined ? tabProp : localTab;
  const setTab = setTabProp || setLocalTab;
  const q = queryProp !== undefined ? queryProp : localQ;
  const setQ = setQueryProp || setLocalQ;
  const nameQ = nameQueryProp !== undefined ? nameQueryProp : localNameQ;
  const setNameQ = setNameQueryProp || setLocalNameQ;

  const { data: streets, loading, error } = useApi(
    ({ signal }) => settlementGetStreets(settlement.id, { signal }),
    [settlement.id],
  );

  // Re-bucket per (street, modifier) so houses on a lane/microdistrict are
  // their own group instead of conflated with the main street. Filters out
  // null-street rows along the way (they'd otherwise dominate the top-30
  // slice — Mongo sorts null < string).
  const usableGroups = useMemo(() => buildGroups(streets || []), [streets]);

  const allHouses = useMemo(
    () => usableGroups.flatMap((g) => g.houses.map((h) => ({ st: g, house: h }))),
    [usableGroups],
  );

  const filtered = useMemo(() => searchHouses(allHouses, q), [allHouses, q]);

  // Per-tab scroll position survives navigation Work → Address → Respond →
  // back, so a surveyor doesn't have to re-scroll a long Browse list every
  // time they file a response.
  const scrollRef = useScrollMemory(`work:${settlement.id}:${tab}`);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', minHeight: 0 }}>
      <AppHeader
        onBack={onBack}
        title={settlementName(settlement, lang)}
        subtitle={settlement.region}
        action={
          <button className="btn btn-ghost" onClick={onChangeSettlement} style={{ padding: 8 }}>
            <Icon name="building" size={18} />
          </button>
        }
      />
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="tabs">
          <button data-active={tab === 'search'} onClick={() => setTab('search')}>{T(lang, 'search_address')}</button>
          <button data-active={tab === 'browse'} onClick={() => setTab('browse')}>{T(lang, 'browse')}</button>
          <button data-active={tab === 'recent'} onClick={() => setTab('recent')}>{T(lang, 'recent_tab')}</button>
          <button data-active={tab === 'name'}   onClick={() => setTab('name')}>{T(lang, 'search.by_name')}</button>
        </div>
      </div>

      <div ref={scrollRef} className="scroll-y" style={{ flex: 1, padding: 14 }}>
        {/* The name-search tab doesn't depend on the streets payload, so
            render it independently of the address-streets loading/error
            states (e.g. /streets failing shouldn't take down name search). */}
        {tab === 'name' && (
          <NameSearchTab q={nameQ} setQ={setNameQ} lang={lang}
                         onPickResult={(r) => onPickAddress(
                           // Synthesize the minimum street/house shape the
                           // Address screen needs from the search result's
                           // display fields (BE-VOTER-SEARCH).
                           { street: r.street, modifier: r.street_modifier },
                           {
                             house: r.house || '',
                             address_key: r.address_key,
                             polling_station_codes: r.polling_station_code ? [r.polling_station_code] : [],
                             // voter_count + asked_count unknown — Address
                             // refetches the voter list anyway, the chip
                             // just won't render until then.
                           },
                           // Optional 3rd arg: voter id to scroll into view.
                           r.id,
                         )} />
        )}

        {tab !== 'name' && loading && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="divide"><ShimmerRow /><ShimmerRow /><ShimmerRow /></div>
          </div>
        )}

        {tab !== 'name' && error && (
          <div style={{
            background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
            padding: 12, borderRadius: 10, fontSize: 13,
          }}>{error.message}</div>
        )}

        {!loading && !error && tab === 'search' && (
          <>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <Icon name="search" size={16}
                style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
              <input className="input" placeholder={T(lang, 'address_search_ph')} autoFocus
                     value={q} onChange={e => setQ(e.target.value)}
                     style={{ paddingLeft: 38 }} />
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="divide">
                {filtered.length === 0 ? (
                  <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
                    {T(lang, 'no_results')}
                  </div>
                ) : (
                  <>
                    {filtered.slice(0, SEARCH_RENDER_CAP).map(({ st, house }) => (
                      <AddressRow key={house.address_key} st={st} house={house} lang={lang}
                                  onClick={() => onPickAddress(st, house)} />
                    ))}
                    {filtered.length > SEARCH_RENDER_CAP && (
                      <div style={{
                        padding: 12, fontSize: 12, color: 'var(--text-3)',
                        textAlign: 'center', borderTop: '1px solid var(--border)',
                      }}>
                        {(`Showing ${SEARCH_RENDER_CAP} of ${filtered.length} — refine search`)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {!loading && !error && tab === 'browse' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="divide">
              {usableGroups.map((g) => (
                <BrowseStreet key={`${g.street}|${g.modifier}`}
                  st={g} lang={lang}
                  expansionKey={`browse:${settlement.id}:${g.street}|${g.modifier}`}
                  onPickHouse={(h) => onPickAddress(g, h)} />
              ))}
            </div>
          </div>
        )}

        {!loading && !error && tab === 'recent' && (
          <div style={{
            padding: '40px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13,
          }}>
            {/* TODO(FE-future): wire /me history once backend exposes recent addresses */}
            {('No recent addresses')}
          </div>
        )}
      </div>
    </div>
  );
}
