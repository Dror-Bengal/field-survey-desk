import { Icon } from '../ui/Icon.jsx';
import { AppHeader } from '../ui/AppHeader.jsx';
import { T } from '../../i18n.js';

export function ScreenRejected({ reason, variant = 'rejected', onSignOut, lang }) {
  const isSuspended = variant === 'suspended';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
      <AppHeader title={T(lang, 'rejected.title')} />

      <div style={{ flex: 1, padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{
          padding: 24, borderRadius: 16,
          background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--st-refused-fg)', color: 'var(--st-refused-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="x" size={28} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{T(lang, 'rejected.title')}</div>
          <div style={{ fontSize: 13, maxWidth: 300, opacity: 0.9 }}>
            {T(lang, isSuspended ? 'rejected.suspended_body' : 'rejected.body')}
          </div>
        </div>

        {reason && (
          <div className="card" style={{ padding: 14 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
              textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6,
            }}>{T(lang, 'rejected.reason_label')}</div>
            <div style={{ fontSize: 14, color: 'var(--text)' }}>{reason}</div>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <button onClick={onSignOut} className="btn btn-block">
          <Icon name="logout" size={14} />
          {T(lang, 'rejected.signout')}
        </button>
      </div>
    </div>
  );
}
