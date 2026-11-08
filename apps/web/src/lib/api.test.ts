import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../test/fixtures.js';
import { api, ApiError, DEV_USER_HEADER, errorMessage, isApiError, setDevUser } from './api.js';

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(impl);
}

afterEach(() => setDevUser(null));

describe('api client', () => {
  it('maps a server error body to ApiError with status, code, message and details', async () => {
    mockFetch(async () => jsonResponse({ error: { code: 'conflict', message: 'Order changed', details: { field: 'openings' } } }, 409));
    const err = await api.get('/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'conflict', message: 'Order changed', details: { field: 'openings' } });
    expect(isApiError(err, 'conflict')).toBe(true);
    expect((err as ApiError).retryable).toBe(false);
  });

  it('keeps not_provisioned distinct from forbidden', async () => {
    mockFetch(async () => jsonResponse({ error: { code: 'not_provisioned', message: 'Not on roster' } }, 403));
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 403, code: 'not_provisioned' });
  });

  it('derives a code from the status when the body is not an API error', async () => {
    mockFetch(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = (await api.get('/api/x').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('upstream_error');
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/not responding/);
  });

  it('maps 401 without a body to unauthenticated', async () => {
    mockFetch(async () => new Response(null, { status: 401 }));
    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });

  it('reports network failures as status 0, code network, retryable', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = (await api.get('/api/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ status: 0, code: 'network' });
    expect(err.retryable).toBe(true);
    expect(errorMessage(err)).toMatch(/Cannot reach/);
  });

  it('returns undefined for 204 No Content', async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    await expect(api.delete('/api/x')).resolves.toBeUndefined();
  });

  it('flags an unreadable success body as internal', async () => {
    mockFetch(async () => new Response('not json', { status: 200 }));
    await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'internal' });
  });

  it('sends JSON with same-origin credentials and the dev user header in development', async () => {
    setDevUser('dev.manager@example.test');
    const spy = mockFetch(async () => jsonResponse({ ok: true }));
    await api.patch('/api/me/preferences', { theme: 'night' });
    const [url, init] = spy.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(url).toBe('/api/me/preferences');
    expect(init).toMatchObject({ method: 'PATCH', credentials: 'same-origin', body: '{"theme":"night"}' });
    expect(headers['content-type']).toBe('application/json');
    expect(headers[DEV_USER_HEADER]).toBe('dev.manager@example.test');
  });

  it('omits the dev header when no dev user is chosen', async () => {
    const spy = mockFetch(async () => jsonResponse([]));
    await api.get('/api/branches');
    expect((spy.mock.calls[0]![1]!.headers as Record<string, string>)[DEV_USER_HEADER]).toBeUndefined();
  });
});
