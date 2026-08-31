import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose Tailwind class strings with conditional parts, resolving conflicts by
 * last-wins (CRIS-54).
 *
 * `clsx` flattens the conditionals; `twMerge` then drops earlier classes that
 * the later ones override. Plain string concatenation cannot do the second
 * part — `"px-2" + " px-4"` leaves BOTH in the attribute and the winner is
 * decided by stylesheet order, not call order, so a caller's `className` prop
 * silently loses to the component's own default. Every primitive here takes a
 * `className` override, so that behaviour has to be correct.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
