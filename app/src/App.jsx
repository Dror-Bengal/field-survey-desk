// Root: path-based router (/ → SurveyorApp, /admin → AdminApp), auth state,
// and the design system tweaks panel (DEV builds only).
//
// Both surfaces sign in with Firebase email+password. Role is decided
// server-side by /me. The URL is authoritative for which role we ask for —
// `?as=admin` on /admin, `?as=surveyor` on /surveyor — so a user with both
// records sees the surface that matches the URL they visited. The
// localStorage-backed "role hint" hook was removed (its stale persistence
// caused dual-role admins to land on a "Not authorized" screen when their
// browser had the hint left over from an earlier surveyor session).

import { useCallback, useEffect, useState } from 'react';

import { useRouter } from './hooks/useRouter.js';
import { useLang } from './hooks/useLang.js';
import { useTweaks } from './hooks/useTweaks.js';

import { SurveyorApp } from './components/SurveyorApp.jsx';
import { AdminApp } from './components/AdminApp.jsx';
import { NotFound } from './components/NotFound.jsx';

import { subscribeAuth } from './lib/auth.js';
import { meGet } from './lib/endpoints.js';

import { TweaksPanel } from './components/tweaks/TweaksPanel.jsx';
import {
  TweakSection, TweakRadio, TweakSlider, TweakColor, TweakToggle,
} from './components/tweaks/controls.jsx';

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "fontScale": 100,
  "showStatus": true,
  "showDemo": true,
  "cardVariant": "rich",
  "accent": "#1f6877"
}/*EDITMODE-END*/;

// Surveyors live at /surveyor (matches /admin symmetrically — no more bare
// "/" entry that surveyors had to guess at). Bare "/" still works as an
// alias and is rewritten to /surveyor on first load via the redirect
// effect below, so existing bookmarks / QR codes keep landing in the
// right place.
function pathToRoute(pathname) {
  if (pathname === '/' || pathname === '/surveyor' || pathname.startsWith('/surveyor/')) {
    return 'surveyor';
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  return 'notfound';
}

// URL-derived role hint. The BE accepts ?as= to disambiguate dual-role
// users; we always send one based on which surface the user is on, so a
// user navigating to /admin gets admin and a user navigating to /surveyor
// gets surveyor — regardless of any prior preference.
function roleHintForRoute(route) {
  if (route === 'admin') return 'admin';
  if (route === 'surveyor') return 'surveyor';
  return null;
}

export function App() {
  const { pathname, navigate } = useRouter();
  const [lang, setLang] = useLang();
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply design tweaks to the document. Defaults are good in production;
  // the dev-only TweaksPanel below can change them at runtime.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', t.theme);
    root.setAttribute('data-density', t.density);
    root.style.fontSize = (t.fontScale / 100) * 14 + 'px';
    if (t.accent) root.style.setProperty('--accent', t.accent);
  }, [t.theme, t.density, t.fontScale, t.accent]);

  // Auth + /me are owned at the root: subscribeAuth fires once for the whole
  // tree and SurveyorApp/AdminApp consume the resulting state via props.
  const [currentUser, setCurrentUser] = useState(null);
  const [meState, setMeState] = useState({ data: null, error: null, loading: false });

  const route = pathToRoute(pathname);
  const hint = roleHintForRoute(route);

  const refetchMe = useCallback(async () => {
    setMeState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await meGet({ as: hint || undefined });
      setMeState({ data, error: null, loading: false });
    } catch (err) {
      setMeState({ data: null, error: err, loading: false });
    }
  }, [hint]);

  // One-time subscription to Firebase auth state. Keep this effect's deps
  // empty so it doesn't tear down + re-subscribe on every render (which
  // would cause Firebase to re-fire the current user synchronously and
  // race with in-flight /me fetches).
  useEffect(() => {
    return subscribeAuth(setCurrentUser);
  }, []);

  // Reactive /me fetch: any time the signed-in user changes OR the URL-
  // derived hint changes, refetch /me. Sign-out clears meState. This single
  // effect replaces the older "fetch inside subscribeAuth callback" path —
  // that path captured a stale `refetchMe` closure across hint changes and
  // could leave the UI showing the wrong role after a navigation.
  useEffect(() => {
    if (currentUser) {
      refetchMe();
    } else {
      setMeState({ data: null, error: null, loading: false });
    }
  }, [currentUser, refetchMe]);

  const onMePollResult = useCallback((data, err) => {
    setMeState({ data: data || null, error: err || null, loading: false });
  }, []);

  // Dual-role switcher — just navigate. The hint follows the URL, so the
  // refetchMe effect above picks up the change automatically.
  const switchRole = useCallback((nextRole) => {
    if (nextRole === 'admin') navigate('/admin');
    else if (nextRole === 'surveyor') navigate('/surveyor');
  }, [navigate]);

  // Cross-app redirect: an admin-only user landing on /surveyor has nowhere
  // useful to go on that flow, so bounce them. Dual-role users on /surveyor
  // now get role='surveyor' from /me (because hint=surveyor), so this
  // redirect only fires for users who genuinely lack a surveyor record.
  // The reverse direction is NOT auto-redirected: a non-admin who hits
  // /admin sees the "Not authorized" screen with Sign out, so they can
  // re-authenticate as someone else.
  //
  // Also canonicalizes the bare "/" alias to "/surveyor" so the URL bar
  // matches what's rendering.
  const role = meState.data?.role || null; // 'admin' | 'surveyor' | 'unregistered'
  useEffect(() => {
    if (route === 'surveyor' && role === 'admin') {
      navigate('/admin');
      return;
    }
    if (pathname === '/') navigate('/surveyor');
  }, [route, role, pathname, navigate]);

  // Per-route favicon + document title. Lets a user with both /surveyor
  // and /admin tabs open tell them apart at a glance in the tab strip.
  // SVG data URIs avoid extra asset files; both icons are tiny (~150 bytes)
  // and load synchronously on every modern browser.
  // PWA home-screen icon is intentionally NOT touched — the manifest is
  // tied to the whole scope and can only carry one icon.
  useEffect(() => {
    const isAdmin = route === 'admin';
    const SURVEYOR_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230d6e6e'/%3E%3Ctext x='32' y='42' text-anchor='middle' font-family='system-ui,sans-serif' font-weight='700' font-size='28' fill='white'%3EVS%3C/text%3E%3C/svg%3E";
    const ADMIN_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231a1a1a'/%3E%3Ctext x='32' y='42' text-anchor='middle' font-family='system-ui,sans-serif' font-weight='700' font-size='22' fill='%23f5d76e'%3EADM%3C/text%3E%3C/svg%3E";

    const link = document.getElementById('favicon');
    if (link) link.href = isAdmin ? ADMIN_FAVICON : SURVEYOR_FAVICON;
    document.title = isAdmin
      ? 'Admin · Information Survey'
      : 'Field Survey Desk';
  }, [route]);

  // One-time cleanup of the stale localStorage hint that the old useRoleHint
  // hook persisted. Without this, browsers that had the hint set before the
  // refactor would carry it forward forever; not strictly broken anymore
  // (we no longer read it), but it's harmless to clear and keeps storage
  // tidy for the small number of users who would never have noticed.
  useEffect(() => {
    try { localStorage.removeItem('voter-survey:role-hint'); } catch { /* */ }
  }, []);

  return (
    <>
      {route === 'surveyor' && (
        <SurveyorApp lang={lang} setLang={setLang}
                     currentUser={currentUser}
                     meState={meState}
                     refetchMe={refetchMe}
                     onMePollResult={onMePollResult}
                     onSwitchRole={switchRole}
                     showDemo={t.showDemo}
                     cardVariant={t.cardVariant} />
      )}
      {route === 'admin' && (
        <AdminApp lang={lang} setLang={setLang}
                  currentUser={currentUser} meState={meState}
                  onSwitchRole={switchRole} />
      )}
      {route === 'notfound' && <NotFound lang={lang} />}

      {import.meta.env.DEV && (
        <TweaksPanel title="Tweaks (dev)">
          <TweakSection label="Appearance" />
          <TweakRadio label="Theme" value={t.theme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark',  label: 'Dark' },
              { value: 'hc',    label: 'HC' },
            ]}
            onChange={(v) => setTweak('theme', v)} />
          <TweakRadio label="Density" value={t.density}
            options={[
              { value: 'compact',     label: 'Compact' },
              { value: 'comfortable', label: 'Comfy' },
              { value: 'spacious',    label: 'Wide' },
            ]}
            onChange={(v) => setTweak('density', v)} />
          <TweakSlider label="Font scale" value={t.fontScale}
            min={85} max={130} step={5} unit="%"
            onChange={(v) => setTweak('fontScale', v)} />
          <TweakColor label="Accent" value={t.accent}
            onChange={(v) => setTweak('accent', v)} />

          <TweakSection label="Surveyor data display" />
          <TweakToggle label="Demographic tags"
            value={t.showDemo} onChange={(v) => setTweak('showDemo', v)} />
          <TweakRadio label="Resident card" value={t.cardVariant}
            options={[
              { value: 'minimal', label: 'Minimal' },
              { value: 'compact', label: 'Compact' },
              { value: 'rich',    label: 'Rich' },
            ]}
            onChange={(v) => setTweak('cardVariant', v)} />
        </TweaksPanel>
      )}
    </>
  );
}
