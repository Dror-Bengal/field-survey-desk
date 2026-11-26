import { useCallback, useEffect, useState } from 'react';

// Tiny path-based router. No react-router — three routes is overkill for it.
// Tracks window.location.pathname, listens for back/forward (popstate), and
// exposes navigate(path) which pushes history and re-renders subscribers.
export function useRouter() {
  const [pathname, setPathname] = useState(
    typeof window !== 'undefined' ? window.location.pathname : '/',
  );

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((path) => {
    if (typeof window === 'undefined') return;
    if (path === window.location.pathname) return;
    window.history.pushState(null, '', path);
    setPathname(path);
  }, []);

  return { pathname, navigate };
}
