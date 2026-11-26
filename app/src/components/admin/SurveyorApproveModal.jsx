import { useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Icon } from '../ui/Icon.jsx';
import { useMutation } from '../../hooks/useMutation.js';
import { adminSurveyorsApprove } from '../../lib/endpoints.js';
import { ScopePicker, emptyScope, scopeIsEmpty, summarizeScope } from './ScopePicker.jsx';
import { T } from '../../i18n.js';

export function SurveyorApproveModal({ open, surveyor, lang, onClose, onApproved }) {
  // Pending applicants have no scope yet (registration starts empty), so we
  // open with all three buckets empty and require the admin to grant at
  // least one before Confirm enables.
  const [scope, setScope] = useState(emptyScope);

  const { mutate: approve, loading: approving, error: approveError } = useMutation(
    (body) => adminSurveyorsApprove(surveyor.id, body),
  );

  const empty = scopeIsEmpty(scope);
  const submit = async () => {
    if (empty || approving) return;
    try {
      // BE schema strips empty arrays (refine: scope_required); we send
      // the full shape and let the server normalize.
      await approve({ scope });
      onApproved?.();
      onClose?.();
    } catch { /* surfaced inline via approveError */ }
  };

  const handleClose = () => {
    setScope(emptyScope());
    onClose?.();
  };

  const total = scope.communities.length + scope.settlements.length + scope.polling_station_codes.length;

  return (
    <Modal open={open} onClose={handleClose} width={560}
           title={`${T(lang, 'admin.approve_title')} — ${surveyor?.full_name || ''}`}
           footer={(
             <>
               <button className="btn" onClick={handleClose} disabled={approving}>
                 {T(lang, 'admin.cancel')}
               </button>
               <button className="btn btn-primary" onClick={submit}
                       disabled={empty || approving}
                       style={{ opacity: (empty || approving) ? 0.5 : 1 }}>
                 <Icon name="check" size={14} />
                 {T(lang, 'admin.confirm')} ({total})
               </button>
             </>
           )}>
      <ScopePicker scope={scope} onChange={setScope} lang={lang} />

      {empty && (
        <div style={{
          marginTop: 12,
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          padding: 8, borderRadius: 8, fontSize: 12,
        }}>{T(lang, 'scope.must_have_one_grant')}</div>
      )}

      {!empty && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
          {summarizeScope(scope, lang)}
        </div>
      )}

      {approveError && (
        <div style={{
          marginTop: 12,
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          padding: 8, borderRadius: 8, fontSize: 12,
        }}>{approveError.message}</div>
      )}
    </Modal>
  );
}
