import { useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { Modal } from '../ui/Modal.jsx';
import { resetPassword, signInAdmin } from '../../lib/auth.js';
import { T } from '../../i18n.js';

function describeAuthError(err, lang) {
  const code = err?.code || '';
  if (code === 'auth/invalid-credential' ||
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found') {
    return ('Invalid email or password');
  }
  if (code === 'auth/too-many-requests') {
    return ('Too many attempts');
  }
  return err?.message || (('Error'));
}

// Inline reset-password modal. Mirrors the surveyor Login's flow so an
// admin who forgot the dashboard password can self-serve without bugging
// whoever runs the create-admin script.
function ForgotPasswordModal({ open, lang, onClose, onSent }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setErr(T(lang, 'auth.invalid_email'));
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await resetPassword(trimmed);
      onSent?.(T(lang, 'auth.reset_email_sent'));
      setEmail('');
      onClose?.();
    } catch (e2) {
      if (e2?.code === 'auth/user-not-found') {
        // Privacy-preserving: don't reveal whether the email is admin/known.
        onSent?.(T(lang, 'auth.reset_email_sent'));
        setEmail('');
        onClose?.();
      } else {
        setErr(e2?.message || T(lang, 'auth.network_error'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}
           title={T(lang, 'auth.reset_title')} width={400}
           footer={(
             <>
               <button type="button" className="btn" onClick={onClose} disabled={busy}>
                 {T(lang, 'gps.cancel')}
               </button>
               <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                 {T(lang, 'auth.send_reset_link')}
               </button>
             </>
           )}>
      <form onSubmit={submit}>
        <input className="input" type="email" inputMode="email" autoComplete="email"
               placeholder={T(lang, 'auth.email')}
               value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        {err && (
          <div role="alert" style={{
            marginTop: 10, padding: 8, borderRadius: 8,
            background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
            fontSize: 12,
          }}>{err}</div>
        )}
      </form>
    </Modal>
  );
}

export function ScreenAdminLogin({ onDone, onError, onInfo, lang }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy || !email || !password) return;
    setBusy(true);
    setError('');
    try {
      await signInAdmin(email, password);
      onDone?.();
    } catch (err) {
      const msg = describeAuthError(err, lang);
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32, background: 'var(--bg)',
    }}>
      <form onSubmit={submit} style={{
        width: '100%', maxWidth: 360,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 14, padding: 28,
        boxShadow: 'var(--shadow-md)',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'var(--accent)', color: 'var(--accent-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 14,
          }}>VS</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{T(lang, 'admin_console')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{T(lang, 'sign_in')}</div>
          </div>
        </div>

        <div>
          <label htmlFor="admin-email" style={{
            display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-2)',
            textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6,
          }}>Email</label>
          <input id="admin-email" className="input" type="email" autoComplete="email" required
                 value={email} onChange={(e) => setEmail(e.target.value)}
                 placeholder="admin@example.com" />
        </div>

        <div>
          <label htmlFor="admin-password" style={{
            display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-2)',
            textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6,
          }}>{('Password')}</label>
          <input id="admin-password" className="input" type="password"
                 autoComplete="current-password" required
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {error && (
          <div role="alert" style={{
            background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
            padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
          }}>{error}</div>
        )}

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}
                style={{ opacity: busy ? 0.6 : 1 }}>
          <Icon name="logout" size={16} style={{ transform: 'scaleX(-1)' }} />
          {T(lang, 'sign_in')}
        </button>

        <button type="button" className="btn btn-ghost"
                onClick={() => setForgotOpen(true)} disabled={busy}
                style={{
                  alignSelf: 'center', fontSize: 12,
                  color: 'var(--accent)', background: 'transparent',
                }}>
          {T(lang, 'auth.forgot_password')}
        </button>
      </form>

      <ForgotPasswordModal open={forgotOpen} lang={lang}
                           onClose={() => setForgotOpen(false)}
                           onSent={(msg) => onInfo?.(msg)} />
    </div>
  );
}
