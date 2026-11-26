import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { AppHeader } from '../ui/AppHeader.jsx';
import { InstallBanner } from '../InstallBanner.jsx';
import { meGet } from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

const POLL_INTERVAL_MS = 30_000;

export function ScreenPendingApproval({ currentUser, onPollResult, onSignOut, lang }) {
  const [busy, setBusy] = useState(false);

  // One poll = one /me call. Hand the result (or error) up so App's status
  // state advances and the router can flip us to SessionStart on approval.
  const poll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await meGet();
      onPollResult?.(data, null);
    } catch (err) {
      onPollResult?.(null, err);
    } finally {
      setBusy(false);
    }
  };

  // Auto-poll. Includes a one-shot poll on mount to catch fast approvals.
  useEffect(() => {
    let cancelled = false;
    let timer;
    const tick = async () => {
      if (cancelled) return;
      try {
        const data = await meGet();
        if (!cancelled) onPollResult?.(data, null);
      } catch (err) {
        if (!cancelled) onPollResult?.(null, err);
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // onPollResult identity is stable from App's useCallback; intentionally
    // not in deps to avoid restarting the polling loop on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
      <AppHeader title={T(lang, 'pending.title')} />

      <div style={{ flex: 1, padding: '24px 24px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Install banner sits above the pending message — surveyors waiting
            for approval are the perfect audience for an install prompt. Self-
            hides when already running in standalone mode. */}
        <InstallBanner lang={lang} />

        <div style={{
          padding: 24, borderRadius: 16, background: 'var(--accent-tint)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="clock" size={28} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{T(lang, 'pending.title')}</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 300 }}>
            {T(lang, 'pending.body')}
          </div>
          {currentUser?.email && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--ff-mono)' }}>
              {currentUser.email}
            </div>
          )}
        </div>

        <button onClick={poll} disabled={busy}
                className="btn btn-block" style={{ opacity: busy ? 0.6 : 1 }}>
          <Icon name="arrow-up" size={14} style={{ transform: 'rotate(45deg)' }} />
          {T(lang, 'pending.refresh')}
        </button>

        <div style={{ flex: 1 }} />

        <button onClick={onSignOut} className="btn btn-ghost btn-block"
                style={{ color: 'var(--text-3)', fontSize: 13 }}>
          <Icon name="logout" size={14} />
          {T(lang, 'pending.signout')}
        </button>
      </div>
    </div>
  );
}
