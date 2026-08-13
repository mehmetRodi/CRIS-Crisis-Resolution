import { afterEach, describe, expect, it, vi } from 'vitest';

import { getIsOnline, subscribeOnlineStatus } from './connectivity';

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

afterEach(() => {
  setNavigatorOnLine(true);
});

describe('getIsOnline', () => {
  it('reflects navigator.onLine', () => {
    setNavigatorOnLine(true);
    expect(getIsOnline()).toBe(true);
    setNavigatorOnLine(false);
    expect(getIsOnline()).toBe(false);
  });
});

describe('subscribeOnlineStatus', () => {
  it('invokes the callback with true/false on online/offline events', () => {
    const onChange = vi.fn();
    subscribeOnlineStatus(onChange);

    window.dispatchEvent(new Event('online'));
    expect(onChange).toHaveBeenLastCalledWith(true);

    window.dispatchEvent(new Event('offline'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('stops receiving events after unsubscribing', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeOnlineStatus(onChange);
    unsubscribe();

    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('offline'));

    expect(onChange).not.toHaveBeenCalled();
  });
});
