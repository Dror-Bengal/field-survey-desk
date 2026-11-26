import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { Modal } from '../ui/Modal.jsx';
import { AppHeader } from '../ui/AppHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useMutation } from '../../hooks/useMutation.js';
import { formatAddressDisplay } from '../../lib/addressDisplay.js';
import { describeApiError } from '../../lib/api.js';
import { candidatesList, responsesCreate, toGeoPoint } from '../../lib/endpoints.js';
import { distanceWarning } from '../../lib/geo.js';
import { splitParties } from '../../lib/parties.js';
import { T } from '../../i18n.js';

// Generates a v4 UUID for the optional client_request_id field. Uses
// crypto.randomUUID where available (modern browsers + iOS Safari 15.4+) and
// falls back to a Math.random hex composition that's good enough for client
// idempotency keys.
function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: 36-char xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Backend non-answer candidates carry stable English shortcodes; map to the
// response_type enum so we can submit the right pairing. Friction noted: the
// backend does not expose response_type directly on the candidate object, so
// we infer from short_en. Flag for backend ergonomics.
const NON_ANSWER_RESPONSE_TYPE = {
  UND: 'undecided',
  WNV: 'will_not_vote',
  RFS: 'refused',
  NHM: 'not_home',
};

function deriveResponseType(candidate, namedVoter) {
  if (!candidate) return null;
  if (candidate.type === 'party') return namedVoter ? 'named_voter' : 'inferred_voter';
  return NON_ANSWER_RESPONSE_TYPE[candidate.short_en] || 'refused';
}

function settlementName(s, lang) {
  if (lang === 'en' && s.name_en) return s.name_en;
  return s.name_local || s.name_en || '';
}
function streetLabel(st) { return st.street || ''; }
function displayVoterName(v) {
  if (v.full_name) return v.full_name;
  return [v.last_name, v.first_name, v.patronymic].filter(Boolean).join(' ');
}

// Card-shaped tile, sized for a responsive grid. ≥56px tall to satisfy the
// iOS 44pt tap-target minimum with margin to spare. Short code badge sits at
// the top-left; party name fills the remaining space and wraps if it's too
// ~22 chars and don't fit in a 160px tile on one line).
export function PartyTile({ party, chosen, onClick, lang }) {
  return (
    <button onClick={onClick} type="button"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        gap: 6, minHeight: 64,
        padding: '10px 12px',
        borderRadius: 8,
        border: chosen ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: chosen ? 'var(--accent-tint)' : 'var(--surface)',
        color: chosen ? 'var(--accent-strong)' : 'var(--text)',
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: 'pointer',
        lineHeight: 1.3,
      }}>
      <span className="mono" style={{
        fontSize: 11, fontWeight: 600,
        padding: '2px 6px', borderRadius: 4,
        background: chosen ? 'var(--accent)' : 'var(--surface-3)',
        color: chosen ? 'var(--accent-fg)' : 'var(--text-2)',
        lineHeight: 1.2,
      }}>{(party.short_en)}</span>
      <span style={{
        fontSize: 13, fontWeight: 500, lineHeight: 1.3,
        // Allow the name to wrap to a second line in narrow tiles instead of
        overflowWrap: 'anywhere',
      }}>{(party.name_en)}</span>
    </button>
  );
}

// Back-compat re-export so any straggling import from Demographic.jsx still
// resolves; Demographic now imports PartyTile directly but keeping this
// alias prevents an accidental break if the rename is reverted.
export const PartyButton = PartyTile;

function Label({ children }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 600, color: 'var(--text-2)',
      textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8,
    }}>{children}</div>
  );
}

export function ScreenRespond({
  voter, settlement, street, house, sessionId, onBack, onSubmitted,
  onError, lang, nav,
}) {
  const [namedVoter, setNamedVoter] = useState(true); // T1 vs T2
  const [chosenId, setChosenId] = useState(null);
  const [notes, setNotes] = useState('');
  // FE-BACK-NAVIGATION: when notes have unsaved text, intercept Back so the
  // surveyor doesn't lose what they typed via a stray tap or iOS swipe.
  // The confirm modal appears with [Stay] / [Discard]; Discard clears the
  // guard and pops the stack via nav.back().
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const hasUnsavedNotes = notes.trim().length > 0;

  // Register a back-guard with useNavStack while there's unsaved text. When
  // the surveyor taps the AppHeader Back button OR the iOS edge-swipes,
  // the guard fires, returns false to block, and surfaces the confirm.
  useEffect(() => {
    if (!nav?.setGuard) return;
    if (!hasUnsavedNotes) {
      nav.setGuard(null);
      return;
    }
    nav.setGuard(() => {
      setDiscardConfirmOpen(true);
      return false;
    });
    return () => nav.setGuard(null);
  }, [hasUnsavedNotes, nav]);

  const handleBack = () => {
    if (hasUnsavedNotes) setDiscardConfirmOpen(true);
    else onBack?.();
  };
  const confirmDiscard = () => {
    setDiscardConfirmOpen(false);
    nav?.setGuard?.(null);
    onBack?.();
  };

  const { data: candidates, loading } = useApi(
    ({ signal }) => candidatesList({ signal }),
    [],
  );

  const { mutate: submit, loading: submitting } = useMutation(responsesCreate);

  const parties = useMemo(
    () => (candidates || []).filter((c) => c.type === 'party'),
    [candidates],
  );
  // Curated priority parties first, the rest behind a "Show more" toggle.
  const { priority: priorityParties, others: otherParties } = useMemo(
    () => splitParties(parties),
    [parties],
  );
  const [showMoreParties, setShowMoreParties] = useState(false);

  const otherOutcomes = useMemo(
    () => (candidates || []).filter((c) => c.type !== 'party'),
    [candidates],
  );
  const chosen = useMemo(
    () => (candidates || []).find((c) => c.id === chosenId) || null,
    [candidates, chosenId],
  );

  // GPS soft-warning state. When the user hits Submit and we detect they're
  // >2km from the settlement, we stash the prepared body + warning info here
  // and open the modal instead of firing the network call. Confirm reuses
  // the same body so we never re-derive timestamps or request id mid-flow.
  const [gpsWarn, setGpsWarn] = useState(null); // { body, km, accuracyM } | null

  const handleSubmit = async () => {
    if (!chosen || !sessionId) return;
    const responseType = deriveResponseType(chosen, namedVoter);
    if (!responseType) return;

    // Front-stop guards: required ids must be defined before we touch the
    // network, and the message they yield is more useful than the backend's
    // generic "request validation failed" envelope.
    if (!voter?.id) { onError?.('Internal: missing voter id'); return; }
    if (!house?.address_key) { onError?.('Internal: missing address_key'); return; }

    const coords = await getCurrentCoordsFast();
    const { geo, accuracy } = toGeoPoint(coords);
    const body = {
      session_id: sessionId,
      candidate_id: chosen.id,
      voter_id: voter.id,
      tier: namedVoter ? 'T1' : 'T2',
      address_key: house.address_key,
      response_type: responseType,
      client_ts: new Date().toISOString(),
      client_request_id: newRequestId(),
      ...(geo ? { client_geo: geo, client_accuracy_m: accuracy } : {}),
      ...(notes ? { notes } : {}),
    };

    // Soft check: warn (don't block) when device is >2km from settlement.
    // Tighter than the backend's 5km flag so we nudge BEFORE generating the
    // flag, not after. Skips silently when GPS or settlement geo is missing.
    const warn = distanceWarning(coords, settlement?.geo);
    if (warn) {
      setGpsWarn({ body, km: warn.km, accuracyM: warn.accuracyM });
      return;
    }

    await sendBody(body);
  };

  // Shared "we have a body, send it" path. Used both by the direct submit
  // (no warning) and the modal's "Submit anyway" confirm.
  const sendBody = async (body) => {
    try {
      await submit(body);
      onSubmitted?.();
    } catch (err) {
      // describeApiError surfaces zod field errors (e.g.
      // "Could not save — candidate_id (invalid_object_id)") so the next
      // failed submit identifies the specific field instead of repeating the
      // generic envelope.
      onError?.(describeApiError(err, ('Submit failed')));
    }
  };

  const confirmGpsWarn = async () => {
    if (!gpsWarn) return;
    const body = gpsWarn.body;
    setGpsWarn(null);
    await sendBody(body);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', minHeight: 0 }}>
      <AppHeader
        onBack={handleBack}
        title={displayVoterName(voter)}
        subtitle={`${formatAddressDisplay(streetLabel(street), street?.modifier, house.house, lang)} · ${settlementName(settlement, lang)}`}
      />
      <div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: '14px 14px 0' }}>
        <div style={{ marginBottom: 14 }}>
          <Label>{T(lang, 'voter_gave_name')}</Label>
          <div className="tabs">
            <button data-active={namedVoter}  onClick={() => setNamedVoter(true)}>
              {T(lang, 'yes')} <span className="tier-badge" style={{ marginLeft: 6 }}>T1</span>
            </button>
            <button data-active={!namedVoter} onClick={() => setNamedVoter(false)}>
              {T(lang, 'no')} <span className="tier-badge" style={{ marginLeft: 6 }}>T2</span>
            </button>
          </div>
        </div>

        <Label>{T(lang, 'parties')}</Label>
        {/* auto-fill grid: 2 columns on phone (160px floor), 3+ on desktop.
            min(160px, 100%) lets a single column survive on <320px screens. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))',
          gap: 8,
        }}>
          {loading && (
            <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13, textAlign: 'center', gridColumn: '1 / -1' }}>…</div>
          )}
          {/* Curated priority parties first. */}
          {!loading && priorityParties.map((p) => (
            <PartyTile key={p.id} party={p} chosen={chosenId === p.id}
              onClick={() => setChosenId(p.id)} lang={lang} />
          ))}
          {/* The rest, gated behind the toggle. If the user already picked one
              of these, expand automatically so the choice stays visible. */}
          {!loading && (showMoreParties || otherParties.some((p) => p.id === chosenId)) && otherParties.map((p) => (
            <PartyTile key={p.id} party={p} chosen={chosenId === p.id}
              onClick={() => setChosenId(p.id)} lang={lang} />
          ))}
        </div>

        {!loading && otherParties.length > 0 && (
          <button type="button"
                  onClick={() => setShowMoreParties((v) => !v)}
                  className="btn"
                  style={{
                    width: '100%', marginTop: 8, marginBottom: 14,
                    fontSize: 13, color: 'var(--accent)',
                    background: 'transparent', borderStyle: 'dashed',
                  }}>
            {showMoreParties || otherParties.some((p) => p.id === chosenId)
              ? `${T(lang, 'show_fewer_parties')}`
              : `${T(lang, 'show_more_parties')} (+${otherParties.length})`}
          </button>
        )}

        <Label>{T(lang, 'other_outcomes')}</Label>
        {/* Single-column full-width rows so non-answer outcomes are visually
            distinct from the parties grid above. Slightly muted background
            reinforces the separation. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {otherOutcomes.map(o => (
            <button key={o.id} type="button"
              onClick={() => setChosenId(o.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                width: '100%', minHeight: 44,
                padding: '10px 14px', borderRadius: 8,
                border: chosenId === o.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: chosenId === o.id ? 'var(--accent-tint)' : 'var(--surface-2)',
                color: chosenId === o.id ? 'var(--accent-strong)' : 'var(--text-2)',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                cursor: 'pointer', lineHeight: 1.3,
              }}>
              {(o.name_en)}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 18 }}>
          <Label>{T(lang, 'notes')}</Label>
          <textarea className="input" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                    style={{ resize: 'none', fontFamily: 'inherit' }} />
        </div>

        {/* Sticky-bottom submit row, lives INSIDE the scroll container so
            position:sticky uses .scroll-y as its containing-block. The
            negative horizontal margin lets it bleed to the screen edges
            even though the scroll container has horizontal padding. */}
        <div style={{
          position: 'sticky', bottom: 0,
          margin: '0 -14px',
          padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px)) 16px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          zIndex: 10,
        }}>
          <button className="btn btn-primary btn-lg btn-block"
                  disabled={!chosen || submitting}
                  onClick={handleSubmit}
                  style={{ opacity: (!chosen || submitting) ? 0.5 : 1 }}>
            <Icon name="check" size={16} />{T(lang, 'submit_response')}
          </button>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
            marginTop: 8, fontSize: 11, color: 'var(--text-3)',
          }}>
            <Icon name="pin" size={12} />{T(lang, 'gps_anchored')}
          </div>
        </div>
      </div>

      <DistanceWarningModal
        warn={gpsWarn}
        settlement={settlement}
        lang={lang}
        submitting={submitting}
        onCancel={() => setGpsWarn(null)}
        onConfirm={confirmGpsWarn} />

      <DiscardNotesModal
        open={discardConfirmOpen}
        lang={lang}
        onStay={() => setDiscardConfirmOpen(false)}
        onDiscard={confirmDiscard} />
    </div>
  );
}

// Shared confirm for "you typed something, are you sure you want to leave?"
// Used by Respond + Demographic. Inline in this file because the copy is
// identical and exporting one component avoids a duplicate elsewhere.
export function DiscardNotesModal({ open, lang, onStay, onDiscard }) {
  return (
    <Modal open={open} onClose={onStay} width={360}
           title={T(lang, 'nav.discard_response')}
           footer={(
             <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
               <button className="btn btn-primary" onClick={onStay}
                       style={{ justifyContent: 'center' }}>
                 {T(lang, 'nav.stay')}
               </button>
               <button className="btn" onClick={onDiscard}
                       style={{ justifyContent: 'center', color: 'var(--st-refused-fg)' }}>
                 {T(lang, 'nav.discard')}
               </button>
             </div>
           )}>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {T(lang, 'nav.discard_response_body')}
        </div>
    </Modal>
  );
}

// Soft-warning dialog. Doesn't block — user can confirm and submit, OR
// cancel and walk back to the form to verify their location. Renders
// nothing when `warn` is null so the parent can mount it unconditionally.
// Exported so Demographic.jsx can reuse without duplicating the JSX.
export function DistanceWarningModal({ warn, settlement, lang, submitting, onCancel, onConfirm }) {
  if (!warn) return null;
  const settlementName = (lang === 'en' && settlement?.name_en)
    ? settlement.name_en
    : (settlement?.name_local || settlement?.name_en || '');
  const body = T(lang, 'gps.outside_warning_body')
    .replace('{km}', String(warn.km))
    .replace('{settlement}', settlementName);
  const accuracyNote = warn.accuracyM != null && warn.accuracyM > 100
    ? T(lang, 'gps.low_accuracy_note').replace('{accuracy}', String(warn.accuracyM))
    : '';

  return (
    <Modal open onClose={onCancel} width={420}
           title={T(lang, 'gps.outside_warning_title')}
           footer={(
             <>
               <button className="btn" onClick={onCancel} disabled={submitting}>
                 {T(lang, 'gps.cancel')}
               </button>
               <button className="btn btn-primary" onClick={onConfirm} disabled={submitting}
                       style={{ opacity: submitting ? 0.6 : 1 }}>
                 {T(lang, 'gps.submit_anyway')}
               </button>
             </>
           )}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.45 }}>{body}</p>
      {accuracyNote && (
        <p style={{
          marginTop: 10, marginBottom: 0,
          padding: '8px 10px', borderRadius: 8,
          background: 'var(--surface-2)', color: 'var(--text-2)',
          fontSize: 12, lineHeight: 1.4,
        }}>{accuracyNote}</p>
      )}
    </Modal>
  );
}

// 2s cap: coordinates are nice-to-have for flagging, not required.
function getCurrentCoordsFast() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 2000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (!done) { done = true; clearTimeout(timer); resolve(pos.coords); } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(null); } },
      { timeout: 2000, enableHighAccuracy: false, maximumAge: 60_000 },
    );
  });
}
