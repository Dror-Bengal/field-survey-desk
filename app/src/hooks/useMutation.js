import { useCallback, useRef, useState } from 'react';

// Writes to the backend.
//   const { mutate, loading, error, data } = useMutation(responsesCreate);
//   await mutate(body);
//
// `mutate` returns the resolved value on success and re-throws on failure
// so callers can `try/await` and branch (e.g. show a Toast).

export function useMutation(fn) {
  const [state, setState] = useState({ data: null, error: null, loading: false });

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const mutate = useCallback(async (...args) => {
    setState({ data: null, error: null, loading: true });
    try {
      const data = await fnRef.current(...args);
      setState({ data, error: null, loading: false });
      return data;
    } catch (err) {
      setState({ data: null, error: err, loading: false });
      throw err;
    }
  }, []);

  return { ...state, mutate };
}
