import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisitorSessionToken, getVisitorToken } from './visitorSession';

const unavailableStorage: Storage = {
  get length() { return 0; },
  clear: () => undefined,
  getItem: () => { throw new Error('Storage unavailable'); },
  key: () => null,
  removeItem: () => { throw new Error('Storage unavailable'); },
  setItem: () => { throw new Error('Storage unavailable'); },
};

test('visitor and session identities remain available when browser storage is blocked', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: unavailableStorage,
      sessionStorage: unavailableStorage,
      crypto: globalThis.crypto,
    } as unknown as Window,
  });

  try {
    const visitorToken = getVisitorToken();
    const sessionToken = getVisitorSessionToken();

    assert.match(visitorToken, /^[a-f0-9]{64}$/);
    assert.match(sessionToken, /^[a-f0-9]{64}$/);
    assert.equal(getVisitorToken(), visitorToken);
    assert.equal(getVisitorSessionToken(), sessionToken);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});
