import { useState } from 'react';
import { InstallBanner } from '../InstallBanner.jsx';
import { Modal } from '../ui/Modal.jsx';
import {
  signInWithEmail,
  signUpWithEmail,
  resetPassword,
} from '../../lib/auth.js';
import { T } from '../../i18n.js';

const PASSWORD_MIN = 6;

// Single mapper for Firebase auth/* codes (email/password, reset).
// `duringSignup` lets us tailor a couple of messages: a network failure on
// signup often means Firebase committed the account but the response was lost
// (we saw real users hit this — Vercel security checkpoint, flaky cell), so
// we nudge them toward Sign in rather than re-trying signup.
// `privacyOnReset` rewrites user-not-found in the reset flow so we don't
// confirm whether an account exists.
function describeAuthError(err, lang, { privacyOnReset = false, duringSignup = false } = {}) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/network-request-failed':
      return T(lang, duringSignup ? 'auth.network_error_signup_hint' : 'auth.network_error');
    case 'auth/invalid-email':
      return T(lang, 'auth.invalid_email');
    case 'auth/email-already-in-use':
      return T(lang, 'auth.email_in_use');
    case 'auth/weak-password':
      return T(lang, 'auth.weak_password');
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return T(lang, 'auth.wrong_password');
    case 'auth/too-many-requests':
      return T(lang, 'auth.too_many_attempts');
    case 'auth/user-not-found':
      return privacyOnReset ? T(lang, 'auth.reset_email_sent') : T(lang, 'auth.user_not_found');
    default:
      return err?.message || (('Sign-in failed'));
  }
}

// Modal body for the password reset flow. Lives inline (rather than a sibling
// component file) because it's tightly coupled to Login's state and never
// rendered anywhere else.
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
      // user-not-found gets the privacy-preserving "email sent" message + close.
      if (e2?.code === 'auth/user-not-found') {
        onSent?.(T(lang, 'auth.reset_email_sent'));
        setEmail('');
        onClose?.();
      } else {
        setErr(describeAuthError(e2, lang));
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

export function ScreenLogin({ onError, onInfo, lang }) {
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // formError is shown inline below the email row (red strip). Toast is reserved
  // for non-error feedback like "reset link sent".
  const [formError, setFormError] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);

  // Combined sign-in / sign-up. The signup branch is forgiving: when Firebase
  // says the email is already in use, we silently retry as a sign-in with the
  // same credentials. That covers two real cases — (1) the user genuinely
  // already has an account and clicked the wrong button, and (2) a previous
  // signup attempt committed server-side but lost the response (Vercel
  // checkpoint / flaky cell), which would otherwise leave them stuck.
  const handleEmail = async (mode) => {
    if (busy) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFormError(T(lang, 'auth.invalid_email'));
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setFormError(T(lang, 'auth.weak_password'));
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      if (mode === 'signup') {
        try {
          await signUpWithEmail(trimmedEmail, password);
        } catch (err) {
          if (err?.code === 'auth/email-already-in-use') {
            await signInWithEmail(trimmedEmail, password);
          } else {
            throw err;
          }
        }
      } else {
        await signInWithEmail(trimmedEmail, password);
      }
      // App's subscribeAuth + meGet take it from here.
    } catch (err) {
      setFormError(describeAuthError(err, lang, { duringSignup: mode === 'signup' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
      <div style={{ flex: 1, padding: '36px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11,
            background: 'var(--accent)', color: 'var(--accent-fg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em',
          }}>VS</div>
          <div style={{ marginTop: 14, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {T(lang, 'app_name')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
            {T(lang, 'elections_2026')} · {T(lang, 'field_edition')}
          </div>
        </div>

        <InstallBanner lang={lang} />

        {/* Email/password — single combined form. The two action buttons let the
            same input trigger sign-in OR sign-up without forcing the user into
            a separate screen first. Validation runs client-side before Firebase
            (weak_password, invalid_email) so we don't spend a network round-trip
            on obvious mistakes. */}
        <form onSubmit={(e) => { e.preventDefault(); handleEmail('signin'); }}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="input" type="email" inputMode="email"
                 autoComplete="email" placeholder={T(lang, 'auth.email')}
                 value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          <input className="input" type="password"
                 autoComplete="current-password" placeholder={T(lang, 'auth.password')}
                 value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}
                    style={{ flex: 1, minHeight: 44 }}>
              {T(lang, 'auth.sign_in')}
            </button>
            <button type="button" className="btn" disabled={busy}
                    onClick={() => handleEmail('signup')}
                    style={{ flex: 1, minHeight: 44 }}>
              {T(lang, 'auth.create_account')}
            </button>
          </div>
          {formError && (
            <div role="alert" style={{
              padding: 8, borderRadius: 8, fontSize: 12,
              background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
            }}>{formError}</div>
          )}
        </form>

        <button type="button" className="btn btn-ghost"
                onClick={() => setForgotOpen(true)} disabled={busy}
                style={{
                  marginTop: 8, alignSelf: 'center',
                  fontSize: 12, color: 'var(--accent)', background: 'transparent',
                }}>
          {T(lang, 'auth.forgot_password')}
        </button>

        <div style={{ flex: 1 }} />

        <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', marginTop: 16 }}>
          {('Admin approval required after sign-in')}
        </div>
      </div>

      <ForgotPasswordModal open={forgotOpen} lang={lang}
                           onClose={() => setForgotOpen(false)}
                           onSent={(msg) => onInfo?.(msg)} />
    </div>
  );
}
