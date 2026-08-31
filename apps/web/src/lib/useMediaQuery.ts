import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query from JS (CRIS-54).
 *
 * The workspace changes STRUCTURE, not just styling, across breakpoints — the
 * incident detail is a third column on a wide screen and an overlay sheet on a
 * narrow one. Rendering both and hiding one with CSS would put the same panel
 * in the DOM twice, which duplicates its ids, its live regions, and its focus
 * targets. So the breakpoint has to be readable in JS.
 *
 * Returns `false` when `matchMedia` is unavailable (jsdom without a polyfill,
 * SSR), which resolves to the narrow layout — the simpler single-column one, and
 * therefore the safe default to fall back to.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    // Re-read on subscribe: the query may have changed between the initial
    // render and this effect (a resize during hydration, or a changed `query`).
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `lg` breakpoint — where the detail rail becomes a real column. */
export const LG_QUERY = '(min-width: 1024px)';
/** Tailwind's `xl` breakpoint — where the queue, map, and detail all fit. */
export const XL_QUERY = '(min-width: 1280px)';
