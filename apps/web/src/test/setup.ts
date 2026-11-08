import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// jsdom does not implement matchMedia; the theme code asks for prefers-color-scheme.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});
