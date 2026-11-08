import type { TokenCredential } from '@azure/identity';
import { describe, expect, it, vi } from 'vitest';
import { GraphAccessError, GraphDeltaResetError, GraphError, HttpGraphClient, initialDeltaUrl, isGraphLink, parseRetryAfter } from '../../src/mail/graph.js';

const credential: TokenCredential = { getToken: async () => ({ token: 'tok', expiresOnTimestamp: Date.now() + 3600_000 }) };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function client(responses: Response[]) {
  const fetchMock = vi.fn(async () => responses.shift() ?? json(500, {}));
  const sleep = vi.fn(async () => {});
  return { graph: new HttpGraphClient({ credential, fetch: fetchMock as unknown as typeof fetch, sleep }), fetchMock, sleep };
}

describe('HttpGraphClient', () => {
  it('builds the first delta request filtered to recent mail with the required $select', () => {
    const url = new URL(initialDeltaUrl('orders@branchsuite.example.com', 'inbox', '2026-03-10T14:00:00.000Z'));
    expect(url.pathname).toBe('/v1.0/users/orders%40branchsuite.example.com/mailFolders/inbox/messages/delta');
    expect(url.searchParams.get('$filter')).toBe('receivedDateTime ge 2026-03-10T14:00:00.000Z');
    expect(url.searchParams.get('$select')).toContain('uniqueBody');
    expect(url.searchParams.get('$select')).toContain('internetMessageHeaders');
  });

  it('sends a bearer token and the plain-text body preference, and returns links', async () => {
    const { graph, fetchMock } = client([json(200, { value: [{ id: 'm1' }], '@odata.nextLink': 'https://graph.microsoft.com/next' })]);
    const page = await graph.deltaPage({ address: 'a@b.example.com', folder: 'sentitems', receivedSince: '2026-03-10T14:00:00.000Z' });
    expect(page).toEqual({ messages: [{ id: 'm1' }], nextLink: 'https://graph.microsoft.com/next', deltaLink: null });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers.Prefer).toContain('outlook.body-content-type="text"');
  });

  it('retries 429 and 503 honoring Retry-After', async () => {
    const { graph, sleep } = client([
      json(429, { error: { code: 'TooManyRequests' } }, { 'retry-after': '3' }),
      json(503, { error: { code: 'ServiceUnavailable' } }),
      json(200, { value: [], '@odata.deltaLink': 'https://graph.microsoft.com/delta' }),
    ]);
    const page = await graph.deltaPage({ link: 'https://graph.microsoft.com/v1.0/x' });
    expect(page.deltaLink).toBe('https://graph.microsoft.com/delta');
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]).toEqual([3000]);
  });

  it('maps 403/404 to GraphAccessError and 410 to GraphDeltaResetError', async () => {
    await expect(client([json(403, { error: { code: 'ErrorAccessDenied' } })]).graph.deltaPage({ link: 'https://graph.microsoft.com/x' })).rejects.toBeInstanceOf(GraphAccessError);
    await expect(client([json(404, { error: { code: 'MailboxNotEnabledForRESTAPI' } })]).graph.deltaPage({ link: 'https://graph.microsoft.com/x' })).rejects.toBeInstanceOf(GraphAccessError);
    await expect(client([json(410, { error: { code: 'SyncStateNotFound' } })]).graph.deltaPage({ link: 'https://graph.microsoft.com/x' })).rejects.toBeInstanceOf(GraphDeltaResetError);
  });

  it('gives up after the attempt limit and does not retry 400', async () => {
    const many = client([json(503, {}), json(503, {}), json(503, {}), json(503, {})]);
    await expect(many.graph.deltaPage({ link: 'https://graph.microsoft.com/x' })).rejects.toBeInstanceOf(GraphError);
    expect(many.fetchMock).toHaveBeenCalledTimes(4);
    const bad = client([json(400, { error: { code: 'BadRequest' } })]);
    await expect(bad.graph.deltaPage({ link: 'https://graph.microsoft.com/x' })).rejects.toMatchObject({ status: 400 });
    expect(bad.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to follow links outside graph.microsoft.com', async () => {
    const { graph, fetchMock } = client([]);
    await expect(graph.deltaPage({ link: 'https://evil.example.com/steal' })).rejects.toMatchObject({ code: 'invalid_link' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isGraphLink('http://graph.microsoft.com/x')).toBe(false);
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('2', 99)).toBe(2000);
    expect(parseRetryAfter(null, 99)).toBe(99);
    expect(parseRetryAfter('garbage', 99)).toBe(99);
  });
});
