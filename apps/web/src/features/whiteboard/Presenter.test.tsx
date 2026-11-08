import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Presenter } from './Presenter.js';
import { fullView } from './testFixtures.js';

describe('Presenter', () => {
  it('shows key hints, moves pages with the keyboard and closes on Esc', () => {
    const onClose = vi.fn();
    const view = fullView();
    render(<Presenter view={{ ...view, blocks: view.blocks.filter((b) => b.kind !== 'image') }} branchName="Northfield" timeZone="America/Chicago" loadMedia={vi.fn()} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Whiteboard presenter' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Welcome back, Jordan')).toBeTruthy();
    expect(screen.getByLabelText('Shortcut: Esc')).toBeTruthy();
    expect(screen.getByLabelText('Shortcut: F')).toBeTruthy();
    // jsdom has no layout, so everything fits on one page: next/previous stay disabled.
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      fireEvent.keyDown(document, { key: 'PageDown' });
    });
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close presenter (Esc)' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
