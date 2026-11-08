import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../test/fixtures.js';
import { INITIALS_ERROR, validateInitials } from './LinePopover.js';
import { OrderLine } from './OrderLine.js';
import { line, order, renderInBoard } from './testHarness.js';

const TODAY = '2026-03-10';

function renderLine(l: ReturnType<typeof line>, opts: { editable?: boolean; env?: Parameters<typeof renderInBoard>[1]; openings?: ReturnType<typeof line>[] } = {}) {
  const o = order({ openings: opts.openings ?? [l, line('other')] });
  return renderInBoard(
    <ul>
      <OrderLine order={o} line={l} index={0} today={TODAY} editable={opts.editable ?? true} />
    </ul>,
    opts.env,
  );
}

const initialsEl = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-ink]');

describe('OrderLine rendering', () => {
  it('renders an open line as a blank, writable line', () => {
    const { container } = renderLine(line('l1'));
    const btn = screen.getByRole('button', { name: 'Line 1: open. Edit line' });
    expect(btn.closest('li')?.dataset.state).toBe('open');
    expect(initialsEl(container)).toBeNull();
  });

  it('renders a pencil line in pencil gray, not marker ink', () => {
    const { container } = renderLine(line('l1', { state: 'tentative', initials: 'JD', writtenBy: 'usr_blake', startDate: '2026-03-20' }));
    const btn = screen.getByRole('button', { name: /^Line 1: penciled in, JD, starts 3\/20, written by Blake Ortiz/ });
    expect(within(btn).getByText('JD').className).toContain('text-subtle');
    expect(initialsEl(container)).toBeNull();
  });

  it("draws committed initials in the WRITER's marker ink", () => {
    const { container } = renderLine(line('l1', { state: 'committed', initials: 'JD', writtenBy: 'usr_blake', startDate: '2026-03-11' }));
    const el = initialsEl(container)!;
    expect(el.textContent).toBe('JD');
    expect(el.style.color).toBe('var(--marker-red-ink)');
    expect(screen.getByRole('button', { name: /committed, JD, starts 3\/11, written by Blake Ortiz/ })).toBeTruthy();
  });

  it("never falls back to the viewer's marker when the writer is unknown or missing", () => {
    // The viewer (usr_avery) has the teal marker.
    const unknown = renderLine(line('l1', { state: 'committed', initials: 'JD', writtenBy: 'usr_gone' }));
    expect(initialsEl(unknown.container)!.dataset.ink).toBe('neutral');
    expect(initialsEl(unknown.container)!.style.color).toBe('');
    expect(unknown.container.innerHTML).not.toContain('--marker-teal-ink');
    unknown.unmount();

    const none = renderLine(line('l1', { state: 'committed', initials: 'JD', writtenBy: null }));
    expect(initialsEl(none.container)!.dataset.ink).toBe('neutral');
    expect(none.container.innerHTML).not.toContain('--marker-teal-ink');
  });

  it('renders started lines with a check and the writer ink', () => {
    const { container } = renderLine(line('l1', { state: 'started', initials: 'MK', writtenBy: 'usr_casey', startDate: '2026-03-01' }));
    expect(initialsEl(container)!.style.color).toBe('var(--marker-purple-ink)');
    expect(screen.getByRole('button', { name: /^Line 1: started, MK, written by Casey Lund/ }).closest('li')!.dataset.state).toBe('started');
  });

  it('shows overdue start dates in the danger color with a "due" label', () => {
    renderLine(line('l1', { state: 'committed', initials: 'JD', startDate: '2026-03-08' }));
    const label = screen.getByText('due 3/8');
    expect(label.className).toContain('text-danger');
  });

  it('is read-only (no button) on drafts and closed orders', () => {
    renderLine(line('l1'), { editable: false });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img', { name: 'Line 1: open' })).toBeTruthy();
  });
});

describe('initials validation', () => {
  it('accepts 1 to 4 letters and rejects digits, spaces or more than 4', () => {
    expect(validateInitials('J')).toBeNull();
    expect(validateInitials('JDQX')).toBeNull();
    expect(validateInitials('J2')).toBe(INITIALS_ERROR);
    expect(validateInitials('ABCDE')).toBe(INITIALS_ERROR);
    expect(validateInitials('J D')).toBe(INITIALS_ERROR);
    expect(validateInitials('')).toBe(INITIALS_ERROR);
  });
});

describe('LinePopover', () => {
  function open(l = line('l1'), env?: Parameters<typeof renderInBoard>[1], openings?: ReturnType<typeof line>[]) {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(order()));
    const utils = renderLine(l, { env, openings });
    fireEvent.click(screen.getAllByRole('button', { name: /^Line 1/ })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Line 1' });
    return { ...utils, dialog, fetchSpy };
  }

  it('focuses the initials input and uppercases what is typed', () => {
    const { dialog } = open();
    const input = within(dialog).getByLabelText('Initials') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'jd' } });
    expect(input.value).toBe('JD');
  });

  it('rejects digits and more than four letters without calling the API', () => {
    const { dialog, fetchSpy } = open();
    const input = within(dialog).getByLabelText('Initials') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'j2' } });
    expect(within(dialog).getByText(INITIALS_ERROR)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    fireEvent.change(input, { target: { value: 'abcde' } });
    expect(within(dialog).getByText(INITIALS_ERROR)).toBeTruthy();
    fireEvent.submit(input.closest('form')!);

    expect(screen.getByRole('dialog', { name: 'Line 1' })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('saves initials, state and start date with Enter', async () => {
    const { dialog, fetchSpy } = open();
    fireEvent.change(within(dialog).getByLabelText('Initials'), { target: { value: 'jd' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Pencil' }));
    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-03-16' } });
    fireEvent.submit(within(dialog).getByLabelText('Initials').closest('form')!);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe('/api/branches/br_north/orders/ord_1/openings/l1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ state: 'tentative', initials: 'JD', startDate: '2026-03-16' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clears a written line', async () => {
    const { dialog, fetchSpy } = open(line('l1', { state: 'committed', initials: 'JD', writtenBy: 'usr_blake' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear line' }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).toEqual({ state: 'open' });
  });

  it('closes with Escape and Cancel without saving', () => {
    const { dialog, fetchSpy } = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dialog.isConnected).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /^Line 1/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets a pipeline-held line change only its start date and links to the candidate', async () => {
    const held = line('l1', { state: 'tentative', initials: 'RS', candidateId: 'cand_9', writtenBy: 'usr_blake' });
    const { dialog, fetchSpy } = open(held);
    expect(within(dialog).getByText(/Held by pipeline candidate/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'manage in Pipeline' }).getAttribute('href')).toBe('/pipeline?candidate=cand_9');
    expect((within(dialog).getByLabelText('Initials') as HTMLInputElement).readOnly).toBe(true);
    expect(within(dialog).queryByRole('radiogroup', { name: 'Line state' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Clear line' })).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Start date'));

    fireEvent.change(within(dialog).getByLabelText('Start date'), { target: { value: '2026-03-18' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).toEqual({ state: 'tentative', startDate: '2026-03-18' });
  });

  it('offers "Remove this line" on open lines to managers only', async () => {
    const managerView = open(line('l1'));
    const remove = within(managerView.dialog).getByRole('button', { name: 'Remove this line' });
    fireEvent.click(remove);
    await waitFor(() => expect(managerView.fetchSpy).toHaveBeenCalled());
    expect(managerView.fetchSpy.mock.calls[0]![1]?.method).toBe('DELETE');
    managerView.unmount();

    const memberView = open(line('l1'), { canManage: () => false });
    expect(within(memberView.dialog).queryByRole('button', { name: 'Remove this line' })).toBeNull();
  });

  it('shows a toast with the API message when the server refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { code: 'conflict', message: 'Lines cannot be changed on a closed order' } }, 409));
    renderLine(line('l1'));
    fireEvent.click(screen.getByRole('button', { name: /^Line 1/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Initials'), { target: { value: 'JD' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Lines cannot be changed on a closed order')).toBeTruthy();
    expect(screen.getByText('Line not saved')).toBeTruthy();
  });
});
