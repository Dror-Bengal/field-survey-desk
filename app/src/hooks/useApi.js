import { useCallback, useEffect, useRef, useState } from 'react';

// Reads from the backend.
//   const { data, error, loading, refetch } = useApi(({ signal }) =>
//     settlementsSearch({ q }, { signal }), [q]);
//
// `fn` is called on mount and whenever any value in `deps` changes.
// Calling `refetch()` re-runs without changing deps. The hook hands `fn`
// an AbortSignal so callers can forward it to the request layer; on unmount
// (or dep change) the controller is aborted and any settled-but-stale
// response is dropped.

export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((n) => n + 1), []);

  // Capture the latest fn so the deps array (rather than fn identity) drives re-runs.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    Promise.resolve()
      .then(() => fnRef.current({ signal: ctrl.signal }))
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setState({ data, error: null, loading: false });
      })
      .catch((err) => {
        if (ctrl.signal.aborted || err?.code === 'aborted') return;
        setState({ data: null, error: err, loading: false });
      });

    return () => ctrl.abort();
  }, [...deps, tick]);

  return { ...state, refetch };
}
