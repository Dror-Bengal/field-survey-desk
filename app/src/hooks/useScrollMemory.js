// Per-key scroll-position memory. The use case:
//
//   surveyor scrolls Browse to house ~47 → taps house → submits response
//   → returns. The Work screen unmounted on the way to Address, so its
//   scrollTop was lost. With this hook, the offset is captured into a
//   module-level Map and restored on the next mount that uses the same key.
//
// Storage is intentionally in-memory only. Tab-close / hard refresh must
// reset (no localStorage), so a surveyor on a public phone doesn't see the
// previous shift's scroll baked in. The Map persists across React renders
// because module state outlives unmounts.
//
// Usage:
//   const ref = useScrollMemory(`work:${settlement.id}:${tab}`);
//   return <div ref={ref} className="scroll-y" ...>...</div>;
//
// The key format is a free-form string — choose one that uniquely
// identifies the *list* the user was browsing (route + sub-context). Two
// renders with the same key share an offset; a new key starts at 0.

import { useEffect, useRef, useState } from 'react';

const memory = new Map();

export function useScrollMemory(key) {
  const ref = useRef(null);

  // Restore on mount. Wait one rAF so the DOM has had a chance to lay
  // out — setting scrollTop before the children render usually no-ops on
  // an empty container.
  useEffect(() => {
    const el = ref.current;
    if (!el || !key) return;
    const saved = memory.get(key);
    if (typeof saved !== 'number') return;
    let id1 = 0;
    let id2 = 0;
    id1 = requestAnimationFrame(() => {
      // Two rAFs give the browser time to lay out async-loaded children
      // (e.g. the streets payload) before we restore. One rAF was racing
      // the layout on slow phones and missing.
      id2 = requestAnimationFrame(() => {
        if (ref.current) ref.current.scrollTop = saved;
      });
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [key]);

  // Capture continuously (throttled to one rAF) so even a mid-scroll
  // unmount records the latest offset. A pure unmount-only capture would
  // miss the rare case where unmount runs before the next scroll event
  // has bubbled to our listener.
  useEffect(() => {
    const el = ref.current;
    if (!el || !key) return;
    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        if (ref.current) memory.set(key, ref.current.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      // Belt-and-suspenders unmount capture.
      if (ref.current) memory.set(key, ref.current.scrollTop);
    };
  }, [key]);

  return ref;
}

// Drop every entry under a prefix — used by SurveyorApp on sign-out / end
// session so a surveyor's offsets don't leak across phones or sessions.
// Pass no argument to clear everything.
export function clearScrollMemory(prefix) {
  if (!prefix) { memory.clear(); return; }
  for (const k of memory.keys()) {
    if (k === prefix || k.startsWith(`${prefix}:`)) memory.delete(k);
  }
}

// Test-only: read raw entries so unit tests can assert capture without
// going through React's render cycle.
export function _peekScrollMemory() {
  return new Map(memory);
}

// ─── Boolean toggle memory ──────────────────────────────────────────
// Same persistence model (module-level Set, in-memory only) for boolean
// flags whose state should survive an unmount. Used by the Browse tab to
// remember which streets the surveyor had expanded — the natural reading
// rhythm is "expand street, scroll to house, tap house, return → see same
// street still expanded with the same scroll offset".

const toggleMemory = new Set();

export function useToggleMemory(key, defaultOpen = false) {
  const initial = key ? toggleMemory.has(key) : defaultOpen;
  const ref = useRef(initial);
  const [open, setOpenState] = useState(initial);

  const setOpen = (next) => {
    const v = typeof next === 'function' ? next(ref.current) : !!next;
    ref.current = v;
    if (key) {
      if (v) toggleMemory.add(key); else toggleMemory.delete(key);
    }
    setOpenState(v);
  };

  return [open, setOpen];
}

// Same prefix-clear semantics as scroll memory. Useful when a surveyor
// changes settlements — the previous settlement's expansion state is
// stale.
export function clearToggleMemory(prefix) {
  if (!prefix) { toggleMemory.clear(); return; }
  for (const k of [...toggleMemory]) {
    if (k === prefix || k.startsWith(`${prefix}:`)) toggleMemory.delete(k);
  }
}

export function _peekToggleMemory() {
  return new Set(toggleMemory);
}
