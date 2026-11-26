// Platform-aware install instructions. Decides at mount time which set of
// steps to render. Android Chrome with a captured beforeinstallprompt event
// can install in one tap; everywhere else gets numbered manual steps.

import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal.jsx';
import { Icon } from './ui/Icon.jsx';
import { captureInstallPromptEvent, detectPlatform, promptInstall } from '../lib/install.js';
import { T } from '../i18n.js';

function Step({ n, children }) {
  return (
    <li style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      padding: '10px 0',
      borderTop: '1px solid var(--border)',
    }}>
      <span style={{
        flexShrink: 0,
        width: 24, height: 24, borderRadius: '50%',
        background: 'var(--accent)', color: 'var(--accent-fg)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
      }}>{n}</span>
      <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text)' }}>{children}</span>
    </li>
  );
}

export function InstallPromptModal({ open, lang, onClose }) {
  const [platform, setPlatform] = useState('other');
  // Whether Chrome's deferred install prompt is available right now. Decided
  // on mount; we don't wait — if it lands later the user can re-open the modal.
  const [hasNativePrompt, setHasNativePrompt] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlatform(detectPlatform());
    let cancelled = false;
    // Check captured-only state (resolves immediately if a prompt already
    // landed). Race against a tiny timeout so we don't hang the UI when no
    // prompt is forthcoming.
    Promise.race([
      captureInstallPromptEvent(),
      new Promise((r) => setTimeout(() => r(null), 200)),
    ]).then((evt) => { if (!cancelled) setHasNativePrompt(!!evt); });
    return () => { cancelled = true; };
  }, [open]);

  const onNativeInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      await promptInstall();
      onClose?.();
    } catch {
      // Capture lapsed mid-flow; user can close and try the manual steps.
    } finally {
      setInstalling(false);
    }
  };

  const renderBody = () => {
    if (platform === 'ios-safari' || platform === 'ios-chrome') {
      return (
        <>
          {platform === 'ios-chrome' && (
            <div style={{
              padding: 10, marginBottom: 10, fontSize: 12,
              background: 'var(--accent-tint)', color: 'var(--text-2)',
              borderRadius: 8,
            }}>
              {('On iOS, install only works in Safari. Open this page in Safari first.')}
            </div>
          )}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            <Step n={1}>{T(lang, 'install.ios_step_1')}</Step>
            <Step n={2}>{T(lang, 'install.ios_step_2')}</Step>
            <Step n={3}>{T(lang, 'install.ios_step_3')}</Step>
          </ol>
        </>
      );
    }

    if (platform === 'android-chrome') {
      return (
        <>
          {hasNativePrompt && (
            <button onClick={onNativeInstall} disabled={installing}
              className="btn btn-primary btn-block btn-lg"
              style={{ marginBottom: 14, opacity: installing ? 0.6 : 1 }}>
              <Icon name="download" size={16} />
              {T(lang, 'install.android_native_button')}
            </button>
          )}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            <Step n={1}>{T(lang, 'install.android_step_1')}</Step>
            <Step n={2}>{T(lang, 'install.android_step_2')}</Step>
            <Step n={3}>{T(lang, 'install.android_step_3')}</Step>
          </ol>
        </>
      );
    }

    if (platform === 'android-firefox') {
      return (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          <Step n={1}>{T(lang, 'install.android_step_1')}</Step>
          <Step n={2}>{T(lang, 'install.android_step_2')}</Step>
          <Step n={3}>{T(lang, 'install.android_step_3')}</Step>
        </ol>
      );
    }

    // desktop / other
    return (
      <div style={{ padding: 14, color: 'var(--text-2)', fontSize: 13 }}>
        {T(lang, 'install.desktop_note')}
      </div>
    );
  };

  return (
    <Modal open={open} onClose={onClose} width={420}
           title={T(lang, 'install.modal_title')}
           footer={(
             <button className="btn" onClick={onClose}>
               {T(lang, 'install.modal_close')}
             </button>
           )}>
      {renderBody()}
    </Modal>
  );
}
