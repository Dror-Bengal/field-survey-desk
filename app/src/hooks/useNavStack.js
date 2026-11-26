// In-app navigation stack with browser-history integration. Used by
// SurveyorApp to power Back buttons + iOS edge-swipe gesture without
// fighting the path-based router that lives at App.jsx (we never change
// `pathname`; we just trap popstate so the device back gesture is consumed
// by us instead of leaving the surveyor flow).
//
// Mental model:
//   - `stack` is an array of route names ('session' | 'work' | 'address' …).
//   - We mirror each push with a single window.history entry so the
//     browser back gesture pops at the same depth our stack does.
//   - A "guard" can intercept a back attempt — used by Respond/Demographic
//     to show a discard-unsaved-notes confirm before actually navigating.
//   - The first entry on the stack acts as the floor: backing past it is
//     a no-op (re-arms the trap so the user doesn't leave the app).

import { useCallback, useEffect, useRef, useState } from 'react';

export function useNavStack(initial) {
  const [stack, setStack] = useState(() => [String(initial)]);
  // useRef so the popstate handler always sees the current guard without
  // tearing down + re-installing the listener every time it changes.
  const guardRef = useRef(null);

  // Install the trap once on mount: a sentinel history entry below the
  // browser's current state so the first back gesture lands on us instead
  // of leaving the page.
  useEffect(() => {
    window.history.pushState({ navTrap: true }, '');
    return () => {
      // No reliable way to "unpush" on unmount without affecting other
      // history entries, so we leave the trap in place. Re-mounting is
      // rare (App.jsx-level remounts on auth changes) and harmless — a
      // duplicate trap is still consumed in one back tap.
    };
  }, []);

  // Single popstate listener. Whenever the browser fires popstate (back
  // gesture, swipe, or programmatic history.back()), consume it: if the
  // guard rejects the back, immediately re-push the trap; otherwise pop
  // our internal stack and re-push the trap so the next gesture is also
  // captured.
  useEffect(() => {
    const onPopState = () => {
      const guard = guardRef.current;
      if (typeof guard === 'function') {
        const allowed = guard();
        if (allowed === false) {
          // Guard wants to block the navigation. Re-arm the trap so the
          // browser stays put.
          window.history.pushState({ navTrap: true }, '');
          return;
        }
      }
      setStack((s) => {
        // Re-arm the trap regardless of stack depth so the user can never
        // back out of the app accidentally.
        window.history.pushState({ navTrap: true }, '');
        return s.length > 1 ? s.slice(0, -1) : s;
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const push = useCallback((route) => {
    if (typeof route !== 'string' || !route) return;
    setStack((s) => (s[s.length - 1] === route ? s : [...s, route]));
  }, []);

  // Programmatic back. We delegate to window.history.back() so the popstate
  // path is the single source of truth (guard checks happen there).
  const back = useCallback(() => {
    window.history.back();
  }, []);

  // Replace the entire stack with a single entry. Use for "End session"
  // (collapses the path back to the entry point) so the back history
  // doesn't re-enter a session the user just abandoned.
  const replace = useCallback((route) => {
    if (typeof route !== 'string' || !route) return;
    setStack([route]);
  }, []);

  // Register/clear a back-guard. Pass a function that returns false to block
  // the back; null to clear. Idempotent.
  const setGuard = useCallback((fn) => {
    guardRef.current = typeof fn === 'function' ? fn : null;
  }, []);

  return {
    route: stack[stack.length - 1],
    canGoBack: stack.length > 1,
    push,
    back,
    replace,
    setGuard,
    // Exposed for tests + diagnostics; do not depend on stack identity in
    // app code (use the route + canGoBack accessors instead).
    _stack: stack,
  };
}
