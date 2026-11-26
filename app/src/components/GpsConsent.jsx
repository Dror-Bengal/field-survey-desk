// GPS consent UI: a modal shown at session start (and re-openable from the
// persistent banner) when location is denied or unavailable, plus the small
// banner that sits above the surveyor flow as a constant reminder until
// they fix the permission.

import { useState } from 'react';
import { Modal } from './ui/Modal.jsx';
import { Icon } from './ui/Icon.jsx';
import { tryCaptureLocation } from '../lib/geo.js';
import { T } from '../i18n.js';

// Inline location-pin-with-slash icon — denotes "GPS off". Standalone SVG
// so we don't need to add a new entry to the shared Icon set just for one
// surface.
function LocationOffIcon({ size = 28, color = 'currentColor' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
         viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s7-7.5 7-13a7 7 0 10-14 0c0 5.5 7 13 7 13z" />
      <circle cx="12" cy="9" r="2.5" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

// Modal copy switches based on `status` ('denied' = user actively turned us
// off; 'unavailable' = device doesn't seem to have location services). The
// caller controls open/close; this component does the retry button itself
// (calls tryCaptureLocation again) and reports the new status via onResult.
export function GpsConsentModal({ open, status, lang, onClose, onResult }) {
  const [retrying, setRetrying] = useState(false);

  const titleKey = status === 'denied' ? 'gps.required_title' : 'gps.unavailable_title';
  const bodyKey  = status === 'denied' ? 'gps.required_body'  : 'gps.unavailable_body';

  const onTryAgain = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const result = await tryCaptureLocation(3000);
      onResult?.(result);
      // Consumer is responsible for closing on a successful grant.
    } finally {
      setRetrying(false);
    }
  };

  const onDecline = () => {
    onResult?.({ status, coords: null }); // confirm whatever the current denied/unavailable status is
    onClose?.();
  };

  return (
    <Modal open={open} onClose={onClose} width={420}
           title={T(lang, titleKey)}
           footer={(
             // Stacked, full-width buttons. The modal is only ~420px on
             // desktop and ~340 on a phone; horizontal layout was bleeding
             // modal because .btn has white-space: nowrap globally.
             <div style={{
               display: 'flex', flexDirection: 'column', gap: 8, width: '100%',
             }}>
               <button className="btn btn-primary" onClick={onTryAgain} disabled={retrying}
                       style={{ opacity: retrying ? 0.6 : 1, justifyContent: 'center' }}>
                 <Icon name="gps" size={14} />
                 {T(lang, 'gps.try_again')}
               </button>
               <button className="btn" onClick={onDecline} disabled={retrying}
                       style={{ justifyContent: 'center' }}>
                 {T(lang, 'gps.continue_without')}
               </button>
             </div>
           )}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <LocationOffIcon size={26} />
        </div>
        <div style={{
          fontSize: 14, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-line',
        }}>
          {T(lang, bodyKey)}
        </div>
      </div>
    </Modal>
  );
}

// Persistent banner shown above the surveyor flow when GPS is off. Tap to
// reopen the consent modal so the user can retry without leaving the screen.
export function GpsConsentBanner({ lang, onClick }) {
  return (
    <button onClick={onClick}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px',
              background: 'var(--st-refused-bg)',
              color: 'var(--st-refused-fg)',
              border: 0, borderBottom: '1px solid var(--border)',
              cursor: 'pointer', fontFamily: 'inherit',
              textAlign: 'left',
            }}>
      <LocationOffIcon size={16} />
      <span style={{ flex: 1, fontSize: 12, fontWeight: 500, lineHeight: 1.35 }}>
        {T(lang, 'gps.banner_warning')}
      </span>
      <Icon name="chevron-right" size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
    </button>
  );
}
