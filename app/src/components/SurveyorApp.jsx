// Surveyor entry point at path "/". Full viewport on mobile; centered with a
// max-width on desktop so the layout stays phone-shaped without an iPhone-style
// bezel. The PhoneFrame mockup is intentionally NOT used here.

import { useCallback, useEffect, useState } from 'react';

import { BottomNav } from './ui/BottomNav.jsx';
import { Icon } from './ui/Icon.jsx';
import { LangToggle } from './ui/LangToggle.jsx';
import { Toast } from './ui/Toast.jsx';

import { ScreenLogin } from './screens/Login.jsx';
import { ScreenRegister } from './screens/Register.jsx';
import { ScreenPendingApproval } from './screens/PendingApproval.jsx';
import { ScreenRejected } from './screens/Rejected.jsx';
import { ScreenSessionStart } from './screens/SessionStart.jsx';
import { ScreenWork } from './screens/Work.jsx';
import { ScreenAddress } from './screens/Address.jsx';
import { ScreenRespond } from './screens/Respond.jsx';
import { ScreenDemographic } from './screens/Demographic.jsx';
import { ScreenProfile } from './screens/Profile.jsx';
import { GpsConsentModal, GpsConsentBanner } from './GpsConsent.jsx';

import { signOutCurrent } from '../lib/auth.js';
import { tryCaptureLocation } from '../lib/geo.js';
import { Modal } from './ui/Modal.jsx';
import { useNavStack } from '../hooks/useNavStack.js';
import { clearScrollMemory, clearToggleMemory } from '../hooks/useScrollMemory.js';
import { T } from '../i18n.js';

// First word of the surveyor's name — preferred over the full name in the
// through full_name → Firebase displayName → email local-part so the strip
// never shows a blank greeting once the user is signed in.
function firstName(meData, currentUser) {
  const candidate = (meData?.full_name || currentUser?.displayName || '').trim();
  if (candidate) return candidate.split(/\s+/)[0];
  const email = currentUser?.email || '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : '';
}

// Compact pill that mirrors the GPS state we already track at the App level.
// Hidden until the surveyor has reached SessionStart and we've actually
// probed location at least once (status === null), so the bar doesn't show
// a misleading "GPS off" before they've even tried.
function GpsPill({ status, lang }) {
  if (status !== 'granted' && status !== 'denied' && status !== 'unavailable') return null;
  const ok = status === 'granted';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999,
      background: ok ? 'var(--st-asked-bg)' : 'var(--st-refused-bg)',
      color:      ok ? 'var(--st-asked-fg)' : 'var(--st-refused-fg)',
      fontSize: 11, fontWeight: 600,
    }}>
      <Icon name="gps" size={11} />
      {T(lang, ok ? 'gps_ok' : 'gps_off_short')}
    </span>
  );
}

// Mirrors App's surveyor stage derivation. Tolerant of both pre- and
// post-pivot backends (404 'not_registered' vs 403 'no_role_assigned'), and
// of the role-based /me shape introduced in FE-EMAIL-SIGNUP-SIMPLE where
// brand-new accounts come back as { role: 'unregistered' } instead of 404.
function deriveSurveyorStage(meData, meError) {
  if (meError) {
    const code = meError.code || '';
    if (meError.status === 404 || code === 'not_registered' || code === 'no_role_assigned') {
      return 'register';
    }
    if (code === 'surveyor_suspended') return 'pending';
    return 'me_error';
  }
  if (!meData) return 'loading';
  if (meData.role === 'unregistered') return 'register';
  switch (meData.status) {
    case 'pending':   return 'pending';
    case 'active':    return 'active';
    case 'rejected':  return 'rejected';
    case 'suspended': return 'suspended';
    default:          return 'me_error';
  }
}

export function SurveyorApp({
  lang, setLang, currentUser, meState, refetchMe, onMePollResult,
  onSwitchRole, // dual-role users — switches the active /me view
  showDemo = true, cardVariant = 'rich',
}) {
  // Local screen state — only meaningful when stage === 'active'. The route
  // lives inside useNavStack rather than a bare useState so the device back
  // gesture (popstate) and our explicit Back buttons share one history.
  const nav = useNavStack('session');
  const route = nav.route;
  // Confirmation modal state for back-from-Work (abandons the active
  // session) and back-with-unsaved-notes (Respond / Demographic). Two
  // refs because the two flows are independent and can fire from
  // overlapping screens.
  const [endSessionConfirmOpen, setEndSessionConfirmOpen] = useState(false);
  const [settlement, setSettlement] = useState(null);
  const [street, setStreet] = useState(null);
  const [house, setHouse] = useState(null);
  const [voter, setVoter] = useState(null);
  const [tab, setTab] = useState('work');
  // Toast holds both message and kind ('success' | 'error') so the icon + color
  // match the type of feedback. showToast() is the canonical setter.
  const [toast, setToast] = useState({ message: '', kind: 'success' });
  const showToast = useCallback((message, kind = 'success') => {
    setToast({ message: message || '', kind });
  }, []);
  const [sessionId, setSessionId] = useState(null);
  const [addressRefreshKey, setAddressRefreshKey] = useState(0);
  // Lifted out of ScreenWork so the surveyor's tab + search query survive a
  // round trip through ScreenAddress (back from a voter list returns them to
  // the same Search results they already typed).
  const [workTab, setWorkTab] = useState('search');
  const [workQuery, setWorkQuery] = useState('');
  const [workNameQuery, setWorkNameQuery] = useState('');
  // When the surveyor taps a name-search result, we route to Address with
  // this voter id so the Address screen can scroll their row into view.
  // Cleared after one consume — leaving it would re-scroll on every later
  // mount of Address (e.g. coming back from Respond).
  const [pendingVoterScroll, setPendingVoterScroll] = useState(null);
  // Tracks the most recent geolocation status reported by SessionStart. When
  // it's 'denied' or 'unavailable' we show a persistent banner above the
  // active flow so the surveyor knows their responses will be flagged, and
  // tapping the banner reopens the consent modal so they can retry without
  // ending the session.
  const [gpsConsentStatus, setGpsConsentStatus] = useState(null);
  const [repromptOpen, setRepromptOpen] = useState(false);
  // One-shot guard for FE-SESSION-RESTORE. Flipped to true the first time
  // we have enough state to make a restore decision (succeed or skip), and
  // reset to false on sign-out so a fresh sign-in re-evaluates. Without this
  // flag, ending a session locally would re-restore on the next render
  // since meState.data.active_session can still point to the old session
  // until /me is refetched.
  const [restoreDecided, setRestoreDecided] = useState(false);

  const stage = !currentUser
    ? 'login'
    : meState.loading && !meState.data && !meState.error
      ? 'loading'
      : deriveSurveyorStage(meState.data, meState.error);

  // Reset local screen state when the user disappears, so a re-sign-in lands
  // on Session, not whatever screen they had open before.
  useEffect(() => {
    if (!currentUser) {
      nav.replace('session');
      setSettlement(null);
      setSessionId(null);
      setWorkTab('search');
      setWorkQuery('');
      setWorkNameQuery('');
      setGpsConsentStatus(null);
      setRepromptOpen(false);
      setRestoreDecided(false);
    }
  // nav is a stable handle from useNavStack — its identity is not reset
  // between renders, so adding it to the dep list would just be noise.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // The lifted Work search makes sense within one settlement; reset it when
  // the surveyor switches to a different settlement so they don't carry a
  // stale street name into a new place.
  useEffect(() => {
    setWorkTab('search');
    setWorkQuery('');
    setWorkNameQuery('');
  }, [settlement?.id]);

  // FE-SESSION-RESTORE — if /me reports an open session, drop the surveyor
  // back on the Work screen for that settlement instead of making them
  // re-pick after every refresh. One-shot per sign-in (guarded by
  // restoreDecided) so a local "End session" doesn't bounce them back into
  // the just-ended session before /me has a chance to refresh.
  //
  // We deliberately don't deep-restore (back to the same address row they
  // were viewing). v1 lands on Work top-level; the surveyor's last search
  // term + tab are reset because they're gone from memory after refresh
  // anyway. Deep-restore would require localStorage and is out of scope.
  useEffect(() => {
    if (restoreDecided) return;
    if (stage !== 'active') return;

    const me = meState.data;
    const session = me?.active_session;
    if (!session?.id || !session?.working_settlement_id) {
      // No session to restore — flip the guard so a later state churn
      // (e.g. /me refetch after the user does something) doesn't try
      // again with potentially stale data.
      setRestoreDecided(true);
      return;
    }

    // Look up the settlement in /me's accessible_settlements (already
    // shipped on every /me response). If it's missing, the admin probably
    // revoked access mid-session — leave the surveyor on SessionStart and
    // surface a small toast so they know why their session vanished.
    const accessible = me.accessible_settlements || [];
    const found = accessible.find((s) => s.id === session.working_settlement_id);
    if (!found) {
      showToast(T(lang, 'session.previous_no_longer_accessible'), 'error');
      setRestoreDecided(true);
      return;
    }

    setSettlement(found);
    setSessionId(session.id);
    nav.push('work');
    setTab('work');
    setRestoreDecided(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreDecided, stage, meState.data, lang, showToast]);

  // Re-probe GPS permission state on every app load (FE-GPS-RE-PROBE-ON-LOAD).
  // Without this, a surveyor who refreshes mid-work — or has been offline and
  // came back — sees an empty state for the banner even if they revoked
  // permission via Settings since last session. The probe runs once per
  // mount, only when:
  //   - the user is signed in
  //   - they're an active surveyor (role+status confirmed by /me)
  //   - we haven't probed yet this mount (gpsConsentStatus === null)
  // SessionStart does its own on-pick probe, so this effect must NOT run when
  // the surveyor is on that screen; otherwise we'd race the on-pick probe and
  // potentially overwrite a fresh "granted" with a stale "denied". The route
  // check below handles that — the effect only fires once we're past Session.
  // We deliberately do NOT auto-open the modal: a surveyor refreshing mid-
  // address shouldn't be ambushed by a permission dialog. The banner is
  // enough; tapping it opens the modal for any user who wants to retry.
  useEffect(() => {
    const role = meState.data?.role;
    const status = meState.data?.status;
    if (!currentUser) return;
    if (role !== 'surveyor' || status !== 'active') return;
    if (gpsConsentStatus !== null) return;
    if (route === 'session') return;

    let cancelled = false;
    (async () => {
      // 6s timeout (longer than SessionStart's 3s) — refresh-time probes
      // happen in the background and a slow GPS chip warm-up shouldn't
      // false-trigger the "unavailable" banner.
      const result = await tryCaptureLocation(6000);
      if (cancelled) return;
      setGpsConsentStatus(result.status);
    })();
    return () => { cancelled = true; };
  }, [currentUser, meState.data?.role, meState.data?.status, gpsConsentStatus, route]);

  const onPickSettlement = (s, newSessionId) => {
    setSettlement(s);
    setSessionId(newSessionId);
    // Replace (not push) so the back history is rooted at Work — backing
    // out of Work goes through the end-session confirm, not back to a
    // stale SessionStart with the same settlement still selected.
    nav.replace('work');
    setTab('work');
  };
  const onPickAddress = (st, h, scrollVoterId = null) => {
    setStreet(st);
    setHouse(h);
    setPendingVoterScroll(scrollVoterId);
    nav.push('address');
  };
  const onPickVoter = (v) => { setVoter(v); nav.push('respond'); };
  const onSubmitResponse = () => {
    setAddressRefreshKey((n) => n + 1);
    // Submit lands back at Address. We use back() (not push) so the back
    // history doesn't grow on every submit.
    nav.back();
    showToast(T(lang, 'response_recorded'), 'success');
  };
  const onAddT3 = () => { nav.push('demographic'); };
  const onSignOut = useCallback(async () => {
    try { await signOutCurrent(); } catch { /* App's auth subscriber will reset */ }
    nav.replace('session');
    setSettlement(null);
    setSessionId(null);
    // Sign-out resets every session-scoped UI memory: scroll positions,
    // expanded streets. Otherwise a shared phone would surface the prior
    // surveyor's state to the next sign-in.
    clearScrollMemory();
    clearToggleMemory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // End-session collapses the back history so the surveyor can't iOS-swipe
  // back into a session they just abandoned. The actual confirm happens
  // when Back is tapped from Work; the Profile-tab "End session" button
  // skips the confirm because it's already an explicit destructive
  // action. Scroll + expansion memory is also cleared because those keys
  // are scoped to the abandoned settlement.
  const onEndSession = () => {
    nav.replace('session');
    setSettlement(null);
    setSessionId(null);
    setTab('work');
    clearScrollMemory('work');
    clearScrollMemory('address');
    clearToggleMemory('browse');
  };

  // Back from Work — pops the end-session confirm rather than navigating
  // immediately. Wired to AppHeader.onBack inside ScreenWork.
  const onBackFromWork = () => setEndSessionConfirmOpen(true);

  // Back from Profile — Profile is rendered as an overlay on top of Work
  // (tab === 'profile'), not a true route, so backing out is just
  // resetting the tab. No nav stack mutation needed.
  const onBackFromProfile = () => setTab('work');

  const renderActiveFlow = () => {
    if (route === 'work' && tab === 'profile') {
      return <ScreenProfile lang={lang}
                onBack={onBackFromProfile}
                onSignOut={onSignOut} onEndSession={onEndSession} />;
    }
    if (route === 'work') {
      return <ScreenWork lang={lang} settlement={settlement}
                onBack={onBackFromWork}
                onPickAddress={onPickAddress}
                onChangeSettlement={() => setEndSessionConfirmOpen(true)}
                tab={workTab} setTab={setWorkTab}
                query={workQuery} setQuery={setWorkQuery}
                nameQuery={workNameQuery} setNameQuery={setWorkNameQuery} />;
    }
    if (route === 'address') {
      return <ScreenAddress lang={lang} settlement={settlement} street={street} house={house}
                showDemo={showDemo} cardVariant={cardVariant}
                refreshKey={addressRefreshKey}
                scrollToVoterId={pendingVoterScroll}
                onScrollConsumed={() => setPendingVoterScroll(null)}
                onBack={nav.back}
                onPickVoter={onPickVoter} onAddT3={onAddT3} />;
    }
    if (route === 'respond') {
      return <ScreenRespond lang={lang} voter={voter} settlement={settlement}
                street={street} house={house} sessionId={sessionId}
                nav={nav}
                onBack={nav.back}
                onSubmitted={onSubmitResponse}
                onError={(msg) => showToast(msg, 'error')} />;
    }
    if (route === 'demographic') {
      return <ScreenDemographic lang={lang} settlement={settlement}
                street={street} house={house} sessionId={sessionId}
                nav={nav}
                onBack={nav.back}
                onSubmitted={onSubmitResponse}
                onError={(msg) => showToast(msg, 'error')} />;
    }
    return <ScreenSessionStart lang={lang}
              onPick={onPickSettlement}
              onGpsStatus={setGpsConsentStatus}
              onError={(msg) => showToast(msg, 'error')}
              me={meState.data}
              refetchMe={refetchMe}
              accessibleSettlements={meState.data?.accessible_settlements || []}
              accessibleSettlementsTotal={meState.data?.accessible_settlements_total ?? 0}
              accessibleSettlementsCapped={!!meState.data?.accessible_settlements_capped} />;
  };

  const onRepromptResult = async ({ status }) => {
    setGpsConsentStatus(status);
    if (status === 'granted') setRepromptOpen(false);
  };

  const openReprompt = async () => {
    // Re-probe before showing the modal so that a freshly-granted permission
    // collapses the banner without an extra Try-again tap.
    const { status } = await tryCaptureLocation(3000);
    setGpsConsentStatus(status);
    if (status !== 'granted') setRepromptOpen(true);
  };

  const renderStage = () => {
    switch (stage) {
      case 'login':
        return <ScreenLogin lang={lang}
                  onError={(msg) => showToast(msg, 'error')}
                  onInfo={(msg) => showToast(msg, 'success')} />;

      case 'loading':
        return (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-3)', fontSize: 13,
          }}>{('Loading…')}</div>
        );

      case 'register':
        return <ScreenRegister lang={lang} currentUser={currentUser}
                  onDone={refetchMe} onSignOut={onSignOut}
                  onError={(msg) => showToast(msg, 'error')} />;

      case 'pending':
        return <ScreenPendingApproval lang={lang} currentUser={currentUser}
                  onPollResult={onMePollResult} onSignOut={onSignOut} />;

      case 'rejected':
        return <ScreenRejected lang={lang} variant="rejected"
                  reason={meState.data?.rejection_reason} onSignOut={onSignOut} />;

      case 'suspended':
        return <ScreenRejected lang={lang} variant="suspended"
                  reason={meState.data?.rejection_reason} onSignOut={onSignOut} />;

      case 'me_error':
        return (
          <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              background: 'var(--st-refused-bg)', color: 'var(--st-refused-fg)',
              padding: 12, borderRadius: 10, fontSize: 13,
            }}>{meState.error?.message || 'Error'}</div>
            <button className="btn btn-block" onClick={refetchMe}>
              {T(lang, 'pending.refresh')}
            </button>
            <button className="btn btn-ghost btn-block" onClick={onSignOut}
                    style={{ color: 'var(--text-3)' }}>
              {T(lang, 'pending.signout')}
            </button>
          </div>
        );

      case 'active':
      default:
        return renderActiveFlow();
    }
  };

  const showBottomNav = stage === 'active' && ['work', 'address'].includes(route);
  const profileOpen = stage === 'active' && tab === 'profile' && route === 'work';
  // The banner only makes sense once the surveyor is in the actual work flow
  // (settlement chosen, session live). Hiding it on the SessionStart screen
  // also avoids stacking it under that screen's own consent modal.
  const showGpsBanner = stage === 'active'
    && (gpsConsentStatus === 'denied' || gpsConsentStatus === 'unavailable')
    && route !== 'session';

  return (
    // Outer = page background (visible on desktop letterboxing).
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      display: 'flex', justifyContent: 'center',
      // Belt-and-suspenders: even with body { overflow-x: hidden } from styles.css,
      // iOS Safari sometimes still horizontal-scrolls when a flex descendant has
      // a content min-content larger than the column. Clip here too.
      overflow: 'hidden',
      width: '100%',
    }}>
      {/* Inner = phone-shaped column. Max 480px on desktop; full width on phones.
          minWidth: 0 lets the column shrink to viewport width even when a
          descendant (e.g. a .btn with white-space:nowrap) reports a wider
          min-content. overflow:hidden contains anything that still overflows. */}
      <div style={{
        width: '100%', maxWidth: 480, minWidth: 0,
        minHeight: '100dvh',
        background: 'var(--surface)',
        display: 'flex', flexDirection: 'column',
        position: 'relative',
        boxShadow: '0 0 0 1px var(--border)',
        overflow: 'hidden',
      }}>
        {/* Single unified top strip. Replaces both the old lang-only header
            and the faux-iOS PhoneStatusBar that lived inside each screen. The
            real device status bar (clock, signal, battery) sits above this in
            the browser chrome — duplicating it was just visual noise. */}
        <header style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 8, padding: '6px 10px', minHeight: 36,
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
          }}>
            {stage === 'active' && (() => {
              const name = firstName(meState.data, currentUser);
              return name ? (
                <span style={{
                  fontSize: 13, fontWeight: 500, color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  minWidth: 0,
                }}>
                  {T(lang, 'header.hello')}, {name}
                </span>
              ) : null;
            })()}
            {stage === 'active' && <GpsPill status={gpsConsentStatus} lang={lang} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Dual-role switcher. Only renders when /me reports the user
                qualifies for both admin and surveyor records. Tapping it
                flips the role hint, refetches /me, and the App-level
                cross-app redirect bounces them to /admin. */}
            {(meState.data?.available_roles || []).includes('admin') && (
              <button onClick={() => onSwitchRole?.('admin')} className="btn btn-ghost"
                      title={T(lang, 'role.switch_to_admin')}
                      aria-label={T(lang, 'role.switch_to_admin')}
                      style={{
                        padding: '4px 8px', fontSize: 11, fontWeight: 600,
                        color: 'var(--accent-strong)', background: 'var(--accent-tint)',
                        borderRadius: 6,
                      }}>
                {T(lang, 'role.admin_short')}
              </button>
            )}
            <LangToggle lang={lang} setLang={setLang} />
            {/* Always-available sign-out for signed-in surveyors. The Profile
                tab on the bottom nav also has Sign out, but bottom nav is
                hidden on SessionStart and on pre-active stages — and that's
                exactly where users feel stranded. One small icon up here is
                the universal escape hatch. */}
            {currentUser && (
              <button onClick={onSignOut} className="btn btn-ghost"
                      title={T(lang, 'pending.signout')}
                      aria-label={T(lang, 'pending.signout')}
                      style={{
                        padding: 6, color: 'var(--text-3)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                <Icon name="logout" size={16} />
              </button>
            )}
          </div>
        </header>

        {showGpsBanner && (
          <GpsConsentBanner lang={lang} onClick={openReprompt} />
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {profileOpen ? (
            <ScreenProfile lang={lang} onSignOut={onSignOut} onEndSession={onEndSession} />
          ) : renderStage()}
        </div>

        {showBottomNav && (
          <BottomNav active={tab} lang={lang}
                     onChange={(v) => { setTab(v); if (v === 'work' && route !== 'work') nav.replace('work'); }} />
        )}

        <GpsConsentModal
          open={repromptOpen}
          status={gpsConsentStatus === 'denied' ? 'denied' : 'unavailable'}
          lang={lang}
          onClose={() => setRepromptOpen(false)}
          onResult={onRepromptResult} />

        {/* End-session confirm — fires on Back from Work or "Change settlement"
            from inside ScreenWork. Both paths abandon the active session, so
            the surveyor gets a chance to bail. */}
        <Modal open={endSessionConfirmOpen}
               onClose={() => setEndSessionConfirmOpen(false)}
               width={360}
               title={T(lang, 'session.end_confirm_title')}
               footer={(
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                   <button className="btn btn-primary"
                           onClick={() => {
                             setEndSessionConfirmOpen(false);
                             onEndSession();
                           }}
                           style={{ justifyContent: 'center' }}>
                     {T(lang, 'session.end_confirm_yes')}
                   </button>
                   <button className="btn"
                           onClick={() => setEndSessionConfirmOpen(false)}
                           style={{ justifyContent: 'center' }}>
                     {T(lang, 'nav.stay')}
                   </button>
                 </div>
               )}>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {T(lang, 'session.end_confirm_body')}
          </div>
        </Modal>

        <Toast message={toast.message} kind={toast.kind}
               onDone={() => setToast({ message: '', kind: 'success' })} />
      </div>
    </div>
  );
}
