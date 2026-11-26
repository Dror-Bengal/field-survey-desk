import { useEffect, useState } from 'react';

// Returns `value` after it has stayed stable for `delayMs`. Used to throttle
// search-as-you-type into a single network request.
export function useDebounce(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
