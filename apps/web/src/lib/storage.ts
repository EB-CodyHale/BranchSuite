/**
 * localStorage access that never throws: private windows, blocked site data and quota errors
 * degrade to "nothing stored" instead of breaking the app.
 */
export function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage unavailable; the value simply is not remembered.
  }
}

export function removeStorage(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Storage unavailable; nothing to remove.
  }
}
