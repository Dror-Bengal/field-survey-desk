// Small banner that opens the InstallPromptModal. Hidden when already running
// in standalone mode (no point re-prompting an installed user). Used on
// Login (pre-auth) and PendingApproval (post-register, pre-approval) — both
// places where the user has time to wait through an install.

import { useState } from 'react';
import { Icon } from './ui/Icon.jsx';
import { InstallPromptModal } from './InstallPromptModal.jsx';
import { isStandalone } from '../lib/install.js';
import { T } from '../i18n.js';

export function InstallBanner({ lang }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  // isStandalone() is read at render time (cheap, just a media-query check).
  // If the user installs while the banner is mounted, the next render will
  // hide it — Login/PendingApproval re-render frequently enough that we
  // don't need to listen for display-mode changes explicitly.
  if (hidden || isStandalone()) return null;

  return (
    <>
      <div style={{
        margin: '0 0 12px',
        padding: 12,
        background: 'var(--accent-tint)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        display: 'flex', alignItems: 'center', gap: 10,
        lineHeight: 1.35,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: 'var(--accent)', color: 'var(--accent-fg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="download" size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text)' }}>
          {T(lang, 'install.banner_title')}
        </div>
        <button onClick={() => setOpen(true)} className="btn btn-primary"
                style={{ padding: '8px 12px', fontSize: 12, flexShrink: 0 }}>
          {T(lang, 'install.banner_cta')}
        </button>
        <button onClick={() => setHidden(true)} className="btn btn-ghost"
                aria-label={T(lang, 'install.banner_dismiss')}
                style={{ padding: 6, color: 'var(--text-3)', flexShrink: 0 }}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <InstallPromptModal open={open} lang={lang} onClose={() => setOpen(false)} />
    </>
  );
}
