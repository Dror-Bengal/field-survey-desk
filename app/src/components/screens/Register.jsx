import { useState } from 'react';
import { Icon } from '../ui/Icon.jsx';
import { AppHeader } from '../ui/AppHeader.jsx';
import { useMutation } from '../../hooks/useMutation.js';
import { surveyorsRegister } from '../../lib/endpoints.js';
import { T } from '../../i18n.js';

function splitDisplayName(displayName) {
  if (!displayName) return { first: '', last: '' };
  const parts = displayName.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function ScreenRegister({ currentUser, onDone, onSignOut, onError, lang }) {
  const seed = splitDisplayName(currentUser?.displayName || '');
  const lockedEmail = currentUser?.email || '';

  const [first, setFirst] = useState(seed.first);
  const [last, setLast] = useState(seed.last);
  const [error, setError] = useState('');

  const { mutate: register, loading } = useMutation(surveyorsRegister);

  const submit = async (e) => {
    e?.preventDefault();
    if (loading) return;
    const fullName = `${first} ${last}`.trim();
    if (!fullName || !lockedEmail) {
      setError(T(lang, 'register.error_generic'));
      return;
    }
    setError('');
    try {
      await register({ full_name: fullName, email: lockedEmail });
      onDone?.();
    } catch (err) {
      // 409 already_registered — App's /me refetch will reroute correctly.
      if (err?.status === 409) {
        onDone?.();
        return;
      }
      const msg = err?.message || T(lang, 'register.error_generic');
      setError(msg);
      onError?.(msg);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
      <AppHeader title={T(lang, 'register.title')} subtitle={T(lang, 'app_name')} />
      <form onSubmit={submit}
            style={{ flex: 1, padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label htmlFor="reg-first" style={labelStyle}>{T(lang, 'register.first_name')}</label>
          <input id="reg-first" className="input" type="text" autoComplete="given-name"
                 required value={first} onChange={(e) => setFirst(e.target.value)} />
        </div>

        <div>
          <label htmlFor="reg-last" style={labelStyle}>{T(lang, 'register.last_name')}</label>
          <input id="reg-last" className="input" type="text" autoComplete="family-name"
                 value={last} onChange={(e) => setLast(e.target.value)} />
        </div>

        <div>
          <label htmlFor="reg-email" style={labelStyle}>{T(lang, 'register.email')}</label>
          <input id="reg-email" className="input tabular" type="email"
                 value={lockedEmail} readOnly aria-readonly="true"
                 style={{ background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'not-allowed' }} />
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
            {T(lang, 'register.email_locked_help')}
          </div>
        </div>

        {error && (
          <div role="alert" style={{
            background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
            padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
          }}>{error}</div>
        )}

        <div style={{ flex: 1 }} />

        <button type="submit" className="btn btn-primary btn-lg btn-block"
                disabled={loading} style={{ opacity: loading ? 0.6 : 1 }}>
          <Icon name="check" size={16} />{T(lang, 'register.submit')}
        </button>

        {onSignOut && (
          <button type="button" onClick={onSignOut} className="btn btn-ghost btn-block"
                  style={{ color: 'var(--text-3)', fontSize: 13 }}>
            {T(lang, 'pending.signout')}
          </button>
        )}
      </form>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-2)',
  textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6,
};
