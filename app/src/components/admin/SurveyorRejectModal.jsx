import { useState } from 'react';
import { Modal } from '../ui/Modal.jsx';
import { Icon } from '../ui/Icon.jsx';
import { useMutation } from '../../hooks/useMutation.js';
import { adminSurveyorsReject } from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

export function SurveyorRejectModal({ open, surveyor, lang, onClose, onRejected }) {
  const [reason, setReason] = useState('');

  const { mutate: reject, loading: rejecting, error: rejectError } = useMutation(
    (body) => adminSurveyorsReject(surveyor.id, body),
  );

  const submit = async () => {
    if (rejecting) return;
    try {
      await reject(reason ? { reason } : {});
      onRejected?.();
      onClose?.();
    } catch { /* shown inline */ }
  };

  const handleClose = () => { setReason(''); onClose?.(); };

  return (
    <Modal open={open} onClose={handleClose} width={420}
           title={`${T(lang, 'admin.reject_title')} — ${surveyor?.full_name || ''}`}
           footer={(
             <>
               <button className="btn" onClick={handleClose} disabled={rejecting}>
                 {T(lang, 'admin.cancel')}
               </button>
               <button className="btn btn-primary" onClick={submit} disabled={rejecting}
                       style={{ background: 'var(--st-refused-fg)', borderColor: 'var(--st-refused-fg)',
                                opacity: rejecting ? 0.6 : 1 }}>
                 <Icon name="x" size={14} />{T(lang, 'admin.reject')}
               </button>
             </>
           )}>
      <label htmlFor="reject-reason" style={{
        display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-2)',
        textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6,
      }}>{T(lang, 'admin.reject_reason')}</label>
      <textarea id="reject-reason" className="input" rows={4}
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder=""
                style={{ resize: 'none', fontFamily: 'inherit' }} />
      {rejectError && (
        <div style={{
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          padding: 8, borderRadius: 8, fontSize: 12, marginTop: 10,
        }}>{rejectError.message}</div>
      )}
    </Modal>
  );
}
