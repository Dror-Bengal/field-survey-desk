// "Edit assigned access" modal. Seeds from surveyor.scope, uses ScopePicker
// for the three-tab grant UX, and submits via PATCH /admin/surveyors/:id
// { scope }. Chip labels are hydrated from the surveyor row's settlements_full
// (instant, no network) plus by-names/by-codes lookups for communities and
// stations (ScopePicker calls these on demand via the search results — but
// for chips we need to resolve identifiers we *already* have, hence the
// dedicated by-* fetches here).

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Icon } from '../ui/Icon.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useMutation } from '../../hooks/useMutation.js';
import {
  adminCommunitiesByNames,
  adminStationsByCodes,
  adminSurveyorsPatch,
} from '../../lib/endpoints.js';
import { ScopePicker, emptyScope, scopeIsEmpty, summarizeScope } from './ScopePicker.jsx';
import { T } from '../../i18n.js';

// Two scopes are "the same" iff each bucket has the same membership ignoring
// order. The picker preserves insertion order so a strict array-equal would
// over-report dirtiness when the user removes then re-adds a chip.
function sameScope(a, b) {
  return sameSet(a.communities, b.communities)
      && sameSet(a.settlements, b.settlements)
      && sameSet(a.polling_station_codes, b.polling_station_codes);
}
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const x of b) if (!setA.has(x)) return false;
  return true;
}

function settlementName(s, lang) {
  if (lang === 'en' && s.name_en) return s.name_en;
  return s.name_local || s.name_en || '';
}

export function SurveyorEditSettlementsModal({
  open, surveyor, lang, onClose, onUpdated,
}) {
  // Initial scope from the surveyor row. /admin/surveyors returns a
  // normalized `scope: {communities, settlements, polling_station_codes}`,
  // but tolerate the legacy shape (just `settlements`) so an admin opening
  // the modal during a partial deploy still gets a sensible seed.
  const initialScope = useMemo(() => {
    const s = surveyor?.scope;
    if (s && (s.communities || s.settlements || s.polling_station_codes)) {
      return {
        communities: s.communities || [],
        settlements: s.settlements || [],
        polling_station_codes: s.polling_station_codes || [],
      };
    }
    return {
      communities: [],
      settlements: surveyor?.settlements || [],
      polling_station_codes: [],
    };
  }, [surveyor]);

  const [scope, setScope] = useState(emptyScope);

  // Reset + reseed every time the modal opens with a new surveyor. This is
  // intentionally simple — the parent unmounts and remounts the modal on
  // close, but we also handle in-place re-open for safety.
  useEffect(() => {
    if (open) setScope(initialScope);
    else setScope(emptyScope());
  }, [open, initialScope]);

  // Settlement chip labels come from the surveyor row directly — the list
  // endpoint already denormalizes settlements_full, so we don't need to
  // fetch. (Stale entries fall back to id-as-label inside ScopePicker.)
  const settlementLabels = useMemo(() => {
    const map = {};
    for (const s of (surveyor?.settlements_full || [])) {
      map[s.id] = settlementName(s, lang);
    }
    return map;
  }, [surveyor, lang]);

  // Community + station labels: the response only carries identifiers
  // (names / codes), so hydrate via by-names/by-codes. Memoize the inputs
  // so the request only re-fires when the picked set actually changes.
  const communityNamesKey = scope.communities.join(',');
  const stationCodesKey = scope.polling_station_codes.join(',');

  const { data: communityRecords } = useApi(
    ({ signal }) => adminCommunitiesByNames(scope.communities, { signal }),
    [communityNamesKey],
  );
  const { data: stationRecords } = useApi(
    ({ signal }) => adminStationsByCodes(scope.polling_station_codes, { signal }),
    [stationCodesKey],
  );

  // ScopePicker accepts an optional chipLabels prop with two maps (settlements
  // by id, stations by code). Communities use their name as both id and
  // label so the picker doesn't need a map for them.
  const chipLabels = useMemo(() => ({
    settlements: settlementLabels,
    stations: Object.fromEntries(
      (stationRecords || []).map((st) => [
        st.code,
        `${st.code} (${lang === 'en' && st.settlement_name_en ? st.settlement_name_en : st.settlement_name_local})`,
      ]),
    ),
  }), [settlementLabels, stationRecords, lang]);
  void communityRecords; // currently unused; placeholder for future region tooltip

  const { mutate: save, loading: saving, error: saveError } = useMutation(
    (body) => adminSurveyorsPatch(surveyor.id, body),
  );

  const isEmpty = scopeIsEmpty(scope);
  const isDirty = !sameScope(scope, initialScope);
  const canSave = isDirty && !isEmpty && !saving;

  const submit = async () => {
    if (!canSave) return;
    try {
      await save({ scope });
      onUpdated?.();
      onClose?.();
    } catch { /* surfaced inline via saveError */ }
  };

  const handleClose = () => {
    setScope(emptyScope());
    onClose?.();
  };

  const total = scope.communities.length + scope.settlements.length + scope.polling_station_codes.length;

  return (
    <Modal open={open} onClose={handleClose} width={560}
           title={`${T(lang, 'admin.edit_settlements_title')} — ${surveyor?.full_name || ''}`}
           footer={(
             <>
               <button className="btn" onClick={handleClose} disabled={saving}>
                 {T(lang, 'admin.cancel')}
               </button>
               <button className="btn btn-primary" onClick={submit}
                       disabled={!canSave}
                       style={{ opacity: canSave ? 1 : 0.5 }}>
                 <Icon name="check" size={14} />
                 {T(lang, 'admin.edit_settlements_save')} ({total})
               </button>
             </>
           )}>
      <ScopePicker scope={scope} onChange={setScope} lang={lang} chipLabels={chipLabels} />

      {isEmpty && (
        <div style={{
          marginTop: 12,
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          padding: 8, borderRadius: 8, fontSize: 12,
        }}>{T(lang, 'scope.must_have_one_grant')}</div>
      )}

      {!isEmpty && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
          {summarizeScope(scope, lang)}
        </div>
      )}

      {saveError && (
        <div style={{
          marginTop: 12,
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          padding: 8, borderRadius: 8, fontSize: 12,
        }}>{saveError.message}</div>
      )}
    </Modal>
  );
}
