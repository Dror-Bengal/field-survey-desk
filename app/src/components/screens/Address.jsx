import { useEffect, useMemo, useRef } from 'react';
import { List } from 'react-window';
import { Icon } from '../ui/Icon.jsx';
import { AppHeader } from '../ui/AppHeader.jsx';
import { StatusPill } from '../ui/StatusPill.jsx';
import { DemoBadge } from '../ui/DemoBadge.jsx';
import { STATUS_LABEL } from '../ui/helpers.js';
import { useApi } from '../../hooks/useApi.js';
import { useScrollMemory } from '../../hooks/useScrollMemory.js';
import { formatAddressDisplay } from '../../lib/addressDisplay.js';
import { addressVoters } from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

// Maps backend response_type → UI status pill bucket.
const STATUS_FROM_RESPONSE_TYPE = {
  named_voter:      'asked',
  inferred_voter:   'asked',
  demographic_only: 'asked',
  undecided:        'asked',
  will_not_vote:    'asked',
  refused:          'refused',
  not_home:         'not_home',
};

function statusOf(voter) {
  if (!voter.last_response) return 'pending';
  return STATUS_FROM_RESPONSE_TYPE[voter.last_response.response_type] || 'pending';
}

function settlementName(s, lang) {
  if (lang === 'en' && s.name_en) return s.name_en;
  return s.name_local || s.name_en || '';
}

function streetLabel(st) { return st.street || ''; }
// list views use, so the title here matches the row the surveyor tapped.
function fullAddressLabel(street, house, lang) {
  const formatted = formatAddressDisplay(
    streetLabel(street),
    street?.modifier,
    house?.house,
    lang,
  );
  if (formatted) return formatted;
  return ('Unnamed');
}

function displayVoterName(v) {
  if (v.full_name) return v.full_name;
  return [v.last_name, v.first_name, v.patronymic].filter(Boolean).join(' ');
}

const STATUS_DOT = {
  asked:    'var(--st-asked-dot)',
  pending:  'var(--st-pending-dot)',
  refused:  'var(--st-refused-dot)',
  not_home: 'var(--st-not-home-dot)',
};

const STATUS_BG = {
  asked:    'color-mix(in oklch, var(--st-asked-bg) 50%, var(--surface))',
  pending:  'var(--surface)',
  refused:  'color-mix(in oklch, var(--st-refused-bg) 50%, var(--surface))',
  not_home: 'color-mix(in oklch, var(--st-not-home-bg) 50%, var(--surface))',
};

function SummaryChip({ count, label, tone }) {
  const cls = {
    asked: 'status-asked', pending: 'status-pending', refused: 'status-refused',
    'not-home': 'status-not-home', neutral: '',
  }[tone] || '';
  return (
    <div className={`status-pill ${cls}`} style={{
      background: tone === 'neutral' ? 'var(--surface-2)' : undefined,
      color: tone === 'neutral' ? 'var(--text-2)' : undefined,
      flex: '0 0 auto', padding: '4px 10px', fontSize: 11,
    }}>
      <span style={{ fontWeight: 600 }}>{count}</span>
      <span style={{ opacity: 0.85 }}>{label}</span>
    </div>
  );
}

function VoterCard({ v, lang, showDemo, onClick, variant = 'compact' }) {
  const status = statusOf(v);
  const dot = STATUS_DOT[status];
  const bg = STATUS_BG[status];
  const askedTime = v.last_response?.latest
    ? new Date(v.last_response.latest).toISOString().slice(11, 16)
    : null;
  const name = displayVoterName(v);

  if (variant === 'minimal') {
    return (
      <button className="card" onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          background: bg, borderRadius: 8, textAlign: 'left',
          border: '1px solid var(--border)',
        }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <div style={{
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', fontSize: 14, fontWeight: 500,
        }}>{name}</div>
        {showDemo && <DemoBadge gender={v.inferred_gender} age_bucket={v.age_bucket} />}
      </button>
    );
  }

  if (variant === 'rich') {
    return (
      <button className="card" onClick={onClick}
        style={{
          padding: '12px 14px', textAlign: 'left',
          background: bg, display: 'flex', alignItems: 'center', gap: 12,
          borderLeft: `3px solid ${dot}`,
        }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 500, color: 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <StatusPill status={status} lang={lang} />
            {showDemo && <DemoBadge gender={v.inferred_gender} age_bucket={v.age_bucket} />}
            {askedTime && (
              <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Icon name="clock" size={11} />{askedTime}
              </span>
            )}
          </div>
        </div>
        {status === 'asked' && (
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: 'var(--st-asked-dot)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}><Icon name="check" size={14} /></div>
        )}
      </button>
    );
  }

  // compact (default)
  return (
    <button className="card" onClick={onClick}
      style={{
        padding: '8px 10px 8px 12px', textAlign: 'left',
        background: bg, display: 'flex', alignItems: 'center', gap: 10,
        borderLeft: `3px solid ${dot}`, borderRadius: 8,
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <div style={{
            fontSize: 14, fontWeight: 500, color: 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
          }}>{name}</div>
          {showDemo && <DemoBadge gender={v.inferred_gender} age_bucket={v.age_bucket} />}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
          fontSize: 11, color: 'var(--text-3)',
        }}>
          {askedTime ? (
            <>
              <Icon name="clock" size={10} />
              <span className="tabular">{askedTime}</span>
            </>
          ) : (
            <span>{T(lang, STATUS_LABEL[status])}</span>
          )}
        </div>
      </div>
    </button>
  );
}

function ShimmerCard() {
  return (
    <div className="card" style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
      <div style={{ flex: 1, height: 14, background: 'var(--surface-2)', borderRadius: 4 }} />
    </div>
  );
}

// Voter list virtualization. Most addresses have <10 voters and the flat
// flexbox layout is the right tool there — preserves the gap between cards
// and adapts to whichever VoterCard variant the tweak panel selected. Big
// apartment buildings (50+) render slowly without windowing, so we switch
// to react-window above this threshold. Row height is sized for the
// 'rich' variant (the default) and includes the 6px gap that the flat
// layout would have applied via flex-gap.
const VOTER_LIST_VIRTUALIZE_THRESHOLD = 20;
const VOTER_ROW_HEIGHT_PX = 94;
const VOTER_VIRTUAL_MAX_HEIGHT = 600;

function VirtualVoterRow({ index, style, rows, lang, showDemo, cardVariant, onPickVoter }) {
  const v = rows[index];
  return (
    <div data-voter-id={v.id}
         style={{ ...style, paddingBottom: 6 }}>
      <VoterCard v={v} lang={lang} showDemo={showDemo}
                 variant={cardVariant} onClick={() => onPickVoter(v)} />
    </div>
  );
}

export function ScreenAddress({
  settlement, street, house, onBack, onPickVoter, onAddT3,
  lang, showDemo, cardVariant, refreshKey,
  // When the surveyor arrives via name-search, the parent threads the
  // matching voter id so we can scroll their row into view on first paint.
  // Single-shot — onScrollConsumed clears it so a refetch (e.g. after
  // submit) doesn't re-scroll over the surveyor's manual position.
  scrollToVoterId, onScrollConsumed,
}) {
  const { data, loading, error, refetch } = useApi(
    ({ signal }) => addressVoters(house.address_key, { signal }),
    [house.address_key],
  );

  // Allow the parent to bump a counter to force a re-fetch (e.g. after a
  // successful response submission).
  useEffect(() => { if (refreshKey) refetch(); }, [refreshKey, refetch]);

  // Voter-list scroll memory — coming back from Respond shouldn't reset
  // the surveyor's scroll on a household with 30+ voters.
  const scrollRef = useScrollMemory(`address:${house.address_key}`);
  // Virtualized list's imperative API. Used for scroll-to-row when the
  // list is windowed (querySelector won't find off-screen rows there).
  const virtualListRef = useRef(null);

  const voters = data?.voters || [];
  const count = (s) => voters.filter(v => statusOf(v) === s).length;

  const virtualize = voters.length >= VOTER_LIST_VIRTUALIZE_THRESHOLD;
  const virtualHeight = Math.min(voters.length * VOTER_ROW_HEIGHT_PX, VOTER_VIRTUAL_MAX_HEIGHT);
  const voterIndexById = useMemo(() => {
    const m = new Map();
    voters.forEach((v, i) => m.set(v.id, i));
    return m;
  }, [voters]);

  // Scroll a specific voter row into view once the list is rendered.
  // Runs once per mount when scrollToVoterId is set, then clears the
  // pending id so subsequent refetches don't re-scroll. Two paths:
  //   - Virtualized: use react-window's imperative scrollToRow (the row
  //     may not be in the DOM yet — querySelector would miss it).
  //   - Flat: querySelector + scrollIntoView (existing behavior).
  useEffect(() => {
    if (!scrollToVoterId) return;
    if (loading || !data) return;
    let id1 = 0;
    let id2 = 0;
    id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        if (virtualize) {
          const idx = voterIndexById.get(scrollToVoterId);
          if (idx !== undefined && virtualListRef.current?.scrollToRow) {
            virtualListRef.current.scrollToRow({ index: idx, align: 'center' });
          }
        } else {
          const el = scrollRef.current?.querySelector(`[data-voter-id="${scrollToVoterId}"]`);
          if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'center', behavior: 'auto' });
          }
        }
        onScrollConsumed?.();
      });
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  // We deliberately depend on the list payload + the pending id so the
  // effect re-fires if the list arrives AFTER the id was set (slow API).
  }, [scrollToVoterId, loading, data, scrollRef, onScrollConsumed, virtualize, voterIndexById]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', minHeight: 0 }}>
      <AppHeader
        onBack={onBack}
        title={fullAddressLabel(street, house, lang)}
        subtitle={settlementName(settlement, lang)}
      />

      <div style={{
        display: 'flex', gap: 6, padding: '10px 14px',
        borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        fontSize: 11, fontVariantNumeric: 'tabular-nums', flexWrap: 'wrap',
      }}>
        <SummaryChip count={voters.length}     label={T(lang, 'residents')} tone="neutral" />
        <SummaryChip count={count('asked')}    label={T(lang, 'asked')}     tone="asked" />
        <SummaryChip count={count('pending')}  label={T(lang, 'pending')}   tone="pending" />
        {count('refused')  > 0 && <SummaryChip count={count('refused')}  label={T(lang, 'refused')}  tone="refused" />}
        {count('not_home') > 0 && <SummaryChip count={count('not_home')} label={T(lang, 'not_home')} tone="not-home" />}
      </div>

      {/* Polling station(s) for this address. Lives in its own row so the
          label has space to read clearly; rare multi-station addresses (1/6,
          1/7) just join with commas. Hidden entirely when the backend
          returns an empty array. */}
      {Array.isArray(data?.polling_station_codes) && data.polling_station_codes.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px',
          borderBottom: '1px solid var(--border)', background: 'var(--surface)',
          fontSize: 12, color: 'var(--text-2)',
        }}>
          <Icon name="pin" size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>
            {T(lang, data.polling_station_codes.length > 1 ? 'polling_stations' : 'polling_station')}:
          </span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {data.polling_station_codes.join(', ')}
          </span>
        </div>
      )}

      <div ref={scrollRef} className="scroll-y" style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {loading && <><ShimmerCard /><ShimmerCard /><ShimmerCard /></>}

        {error && (
          <div style={{
            background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
            padding: 12, borderRadius: 10, fontSize: 13,
          }}>{error.message}</div>
        )}

        {!loading && !error && voters.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
            {T(lang, 'no_results')}
          </div>
        )}

        {!loading && !error && !virtualize && voters.map(v => (
          // The wrapper carries the data-voter-id selector that
          // scrollToVoterId targets — leaves VoterCard's internals alone.
          <div key={v.id} data-voter-id={v.id}>
            <VoterCard v={v} lang={lang} showDemo={showDemo}
                       variant={cardVariant} onClick={() => onPickVoter(v)} />
          </div>
        ))}

        {!loading && !error && virtualize && (
          // Virtualized window for big apartment buildings (≥20 voters).
          // Fixed row height matches the 'rich' VoterCard variant + the
          // 6px inter-row gap that the flat layout would provide via
          // flex-gap. Other variants are slightly shorter and leave a few
          // extra pixels per row — acceptable.
          <div style={{ height: virtualHeight, touchAction: 'pan-y' }}>
            <List
              listRef={virtualListRef}
              rowCount={voters.length}
              rowHeight={VOTER_ROW_HEIGHT_PX}
              rowComponent={VirtualVoterRow}
              rowProps={{ rows: voters, lang, showDemo, cardVariant, onPickVoter }}
              defaultHeight={virtualHeight}
              overscanCount={4}
              style={{ height: '100%' }} />
          </div>
        )}
      </div>

      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
        <button className="btn btn-block" onClick={onAddT3}
                style={{
                  background: 'var(--surface-2)', borderColor: 'var(--border-2)', borderStyle: 'dashed',
                  flexDirection: 'column', gap: 4,
                  padding: '12px 14px', minHeight: 60, lineHeight: 1.3,
                }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 14, fontWeight: 500,
          }}>
            <Icon name="plus" size={14} />
            {T(lang, 'address.no_voter_primary')}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {T(lang, 'address.no_voter_secondary')}
          </span>
        </button>
      </div>
    </div>
  );
}
