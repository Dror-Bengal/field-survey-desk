import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { AppHeader } from '../ui/AppHeader.jsx';
import { DiscardNotesModal, DistanceWarningModal, PartyTile } from './Respond.jsx';
import { formatAddressDisplay } from '../../lib/addressDisplay.js';
import { useApi } from '../../hooks/useApi.js';
import { useMutation } from '../../hooks/useMutation.js';
import { describeApiError } from '../../lib/api.js';
import { candidatesList, responsesCreate, toGeoPoint } from '../../lib/endpoints.js';
import { distanceWarning } from '../../lib/geo.js';
import { splitParties } from '../../lib/parties.js';
import { T } from '../../i18n.js';

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function streetLabel(st) { return st.street || ''; }

function Radio({ value, label, current, onSelect }) {
  return (
    <button onClick={() => onSelect(value)}
      className={current === value ? 'btn btn-primary' : 'btn'}
      style={{ flex: 1, padding: '12px 8px', fontSize: 13, fontWeight: 500 }}>
      {label}
    </button>
  );
}

function Label({ children }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 600, color: 'var(--text-2)',
      textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8,
    }}>{children}</div>
  );
}

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

export function ScreenDemographic({
  street, house, sessionId, settlement, onBack, onSubmitted, onError, lang, nav,
}) {
  const [gender, setGender] = useState('M');         // 'M' | 'F' | 'U'
  const [ageBucket, setAgeBucket] = useState('adult'); // 'young' | 'adult' | 'senior'
  const [chosenId, setChosenId] = useState(null);
  const [notes, setNotes] = useState('');
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  // Same unsaved-notes guard as Respond — register while there's text in
  // the notes field, surface a confirm before backing out.
  const hasUnsavedNotes = notes.trim().length > 0;
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

  // Backend requires candidate_id even for T3 — surveyor still picks the
  // declared party (or a non-answer outcome) the anonymous voter named.
  const { data: candidates, loading } = useApi(
    ({ signal }) => candidatesList({ signal }),
    [],
  );
  const parties = useMemo(
    () => (candidates || []).filter((c) => c.type === 'party'),
    [candidates],
  );
  const { priority: priorityParties, others: otherParties } = useMemo(
    () => splitParties(parties),
    [parties],
  );
  const [showMoreParties, setShowMoreParties] = useState(false);

  const { mutate: submit, loading: submitting } = useMutation(responsesCreate);

  // GPS soft-warning state. Same shape + flow as Respond.jsx — see comments
  // there. We pause the network call when device is >2km from settlement,
  // surface the prepared body in the modal, and on confirm reuse the same
  // body (preserving client_ts and client_request_id).
  const [gpsWarn, setGpsWarn] = useState(null);

  const handleSubmit = async () => {
    if (!sessionId) return;
    if (!house?.address_key) { onError?.('Internal: missing address_key'); return; }

    const coords = await getCurrentCoordsFast();
    const { geo, accuracy } = toGeoPoint(coords);
    // T3 contract (responses.ts) — IMPORTANT, schema changed since FE-3:
    //   - tier: 'T3'
    //   - voter_id: omitted (refine: !d.voter_id)
    //   - candidate_id: omitted (refine: !d.candidate_id) — was required, now forbidden
    //   - demographic: { gender, age_bucket } required
    //   - response_type: 'demographic_only'
    const body = {
      session_id: sessionId,
      tier: 'T3',
      address_key: house.address_key,
      response_type: 'demographic_only',
      demographic: { gender, age_bucket: ageBucket },
      client_ts: new Date().toISOString(),
      client_request_id: newRequestId(),
      ...(geo ? { client_geo: geo, client_accuracy_m: accuracy } : {}),
      ...(notes ? { notes } : {}),
    };

    const warn = distanceWarning(coords, settlement?.geo);
    if (warn) {
      setGpsWarn({ body, km: warn.km, accuracyM: warn.accuracyM });
      return;
    }
    await sendBody(body);
  };

  const sendBody = async (body) => {
    try {
      await submit(body);
      onSubmitted?.();
    } catch (err) {
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
        title={T(lang, 'demographic_only')}
        subtitle={formatAddressDisplay(streetLabel(street), street?.modifier, house.house, lang)}
        action={<span className="tier-badge" style={{ height: 22, padding: '0 8px', fontSize: 11 }}>T3</span>}
      />
      <div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: '14px 14px 0' }}>
        <div style={{
          background: 'var(--accent-tint)', padding: 12, borderRadius: 10,
          fontSize: 12, color: 'var(--text-2)', marginBottom: 16,
        }}>{T(lang, 'demographic_why')}</div>

        <div style={{ marginBottom: 14 }}>
          <Label>{T(lang, 'gender')}</Label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Radio value="M" label={`♂ ${T(lang, 'male')}`}   current={gender} onSelect={setGender} />
            <Radio value="F" label={`♀ ${T(lang, 'female')}`} current={gender} onSelect={setGender} />
            <Radio value="U" label={`? ${T(lang, 'unknown')}`} current={gender} onSelect={setGender} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <Label>{T(lang, 'age')}</Label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Radio value="young"  label="18–35" current={ageBucket} onSelect={setAgeBucket} />
            <Radio value="adult"  label="36–60" current={ageBucket} onSelect={setAgeBucket} />
            <Radio value="senior" label="60+"   current={ageBucket} onSelect={setAgeBucket} />
          </div>
        </div>

        <Label>{T(lang, 'parties')}</Label>
        {/* Same responsive grid + show-more toggle as the Respond screen. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))',
          gap: 8,
        }}>
          {loading && (
            <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13, textAlign: 'center', gridColumn: '1 / -1' }}>…</div>
          )}
          {!loading && priorityParties.map((p) => (
            <PartyTile key={p.id} party={p} chosen={chosenId === p.id}
              onClick={() => setChosenId(p.id)} lang={lang} />
          ))}
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

        <div style={{ marginBottom: 14 }}>
          <Label>{T(lang, 'notes')}</Label>
          <textarea className="input" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                    style={{ resize: 'none', fontFamily: 'inherit' }} />
        </div>

        {/* Sticky-bottom submit row, lives INSIDE the scroll container so
            position:sticky uses .scroll-y as its containing-block. */}
        <div style={{
          position: 'sticky', bottom: 0,
          margin: '0 -14px',
          padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px)) 16px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          zIndex: 10,
        }}>
          <button className="btn btn-primary btn-lg btn-block"
                  disabled={submitting}
                  onClick={handleSubmit}
                  style={{ opacity: submitting ? 0.5 : 1 }}>
            <Icon name="check" size={16} />{T(lang, 'submit_response')}
          </button>
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
