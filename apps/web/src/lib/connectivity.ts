/**
 * Browser connectivity detection (CRIS-26). Event-driven, not polled — the
 * `online`/`offline` events fire on real transitions, so nothing here spins
 * a timer to ask "are we online yet?".
 */

/** Best-effort current connectivity. `navigator.onLine` can false-positive
 * (it only reflects link status, not real internet reachability) but never
 * false-negatives in practice, which is exactly the side to err on here — a
 * false "online" just means the next submit attempt fails and re-queues. */
export function getIsOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** Subscribes to connectivity transitions. Returns an unsubscribe function. */
export function subscribeOnlineStatus(onChange: (isOnline: boolean) => void): () => void {
  const handleOnline = () => onChange(true);
  const handleOffline = () => onChange(false);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
