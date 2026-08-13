import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Device connectivity + app-lifecycle detection (CRIS-26). Mobile twin of
 * `apps/web/src/lib/connectivity.ts` — RN has no synchronous "am I online
 * right now" accessor (unlike web's `navigator.onLine`), only this
 * subscription; `NetInfo.addEventListener` fires immediately with the current
 * state when added, which is what seeds the context's initial value.
 *
 * `isInternetReachable` can be `null` right after a network change while
 * NetInfo is still probing — treated as online (same reasoning as the web
 * twin: a false positive just means the next attempt fails and re-queues,
 * cheap; a false negative would silently stop retrying).
 */
export function isNetInfoStateOnline(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

/** Subscribes to connectivity changes, firing once immediately with the current state. */
export function subscribeOnlineStatus(onChange: (isOnline: boolean) => void): () => void {
  return NetInfo.addEventListener((state) => onChange(isNetInfoStateOnline(state)));
}

/**
 * Subscribes to app foreground/background transitions — used to pause the
 * backoff poll while backgrounded (no point burning battery retrying a queue
 * the citizen isn't looking at) and flush immediately on foreground.
 */
export function subscribeAppState(onChange: (status: AppStateStatus) => void): () => void {
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}
