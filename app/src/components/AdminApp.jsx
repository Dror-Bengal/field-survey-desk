// Admin entry point at path "/admin". Full viewport, scrollable. AdminLogin
// when signed out; AdminShell + content when signed in. The previous
// "stage card" framing (fixed 820px box on a desktop background) is gone.

import { useCallback, useState } from 'react';

import { ScreenAdminLogin } from './screens/AdminLogin.jsx';
import { AdminShell } from './admin/Shell.jsx';
import { AdminOverview } from './admin/Overview.jsx';
import { AdminResponses } from './admin/Responses.jsx';
import { AdminSurveyors } from './admin/Surveyors.jsx';

import { signOutCurrent } from '../lib/auth.js';
import { T } from '../i18n.js';

export function AdminApp({ lang, setLang, currentUser, meState, onSwitchRole }) {
  const availableRoles = meState?.data?.available_roles || [];
  const [adminPage, setAdminPage] = useState('overview');
  const [toast, setToast] = useState('');

  const onLogout = useCallback(async () => {
    try { await signOutCurrent(); } catch { /* App's auth subscriber resets state */ }
  }, []);

  // Auth gate is role-based now (FE-EMAIL-SIGNUP-SIMPLE) — both surveyors and
  // admins can sign in with password, so the Firebase provider doesn't tell us
  // anything useful. We wait for /me to land before deciding which surface to
  // show: signed-out → AdminLogin; signed-in but role still loading → loader;
  // signed-in & role=admin → AdminShell. Non-admin roles get bounced by the
  // cross-app redirect in App.jsx, so we just render a brief loader for them
  // too rather than flashing AdminLogin.
  const role = meState?.data?.role || null;
  const meLoading = !!currentUser && !meState?.data && !meState?.error;

  if (!currentUser) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
        <ScreenAdminLogin lang={lang}
                          onDone={() => { /* App's meGet picks it up */ }}
                          onError={(msg) => setToast(msg)}
                          onInfo={(msg) => setToast(msg)} />
        {toast && (
          <div role="alert" style={{
            position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            padding: '10px 14px', borderRadius: 10, fontSize: 13,
            background: 'var(--st-refused-fg)', color: 'var(--surface)',
            zIndex: 100, boxShadow: 'var(--shadow-md)',
          }} onClick={() => setToast('')}>{toast}</div>
        )}
      </div>
    );
  }

  if (meLoading) {
    return (
      <div style={{
        minHeight: '100dvh', background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-3)', fontSize: 13,
      }}>{('Loading…')}</div>
    );
  }

  // Signed in but not as an admin (probably a surveyor account on a shared
  // browser, or a fresh sign-up that hasn't been promoted). Don't auto-bounce
  // them — they came here on purpose. Give them a clear path to sign out so
  // they can re-authenticate as the admin user.
  if (role !== 'admin') {
    const email = currentUser.email || '';
    return (
      <div style={{
        minHeight: '100dvh', background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
        <div style={{
          width: '100%', maxWidth: 420,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, padding: 24,
          display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: 'var(--shadow-md)',
        }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {T(lang, 'admin.not_authorized_title')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {T(lang, 'admin.not_authorized_body').replace('{email}', email)}
          </div>
          <button className="btn btn-primary btn-block" onClick={onLogout}
                  style={{ minHeight: 44, justifyContent: 'center' }}>
            {T(lang, 'admin.sign_out_to_switch')}
          </button>
        </div>
      </div>
    );
  }

  // AdminShell owns the full-viewport flex layout (admin-shell class).
  // The "Switch to surveyor" handler is a no-op when the user doesn't
  // qualify for both roles — AdminShell hides the button in that case.
  return (
    <AdminShell lang={lang} setLang={setLang}
                page={adminPage} setPage={setAdminPage}
                currentUser={currentUser}
                onLogout={onLogout}
                canSwitchToSurveyor={availableRoles.includes('surveyor')}
                onSwitchToSurveyor={() => onSwitchRole?.('surveyor')}>
      {adminPage === 'overview'   && <AdminOverview lang={lang} />}
      {adminPage === 'responses'  && <AdminResponses lang={lang} />}
      {adminPage === 'surveyors'  && <AdminSurveyors lang={lang} />}
    </AdminShell>
  );
}
