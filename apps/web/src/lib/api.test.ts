import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken, toQueryString } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('api client', () => {
  it('sends the CSRF token on mutations but not on GET', async () => {
    setCsrfToken('tok123');
    const f = mockFetch(200, { ok: true });
    await api.get('/x');
    expect(f.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined();
    await api.post('/x', { a: 1 });
    expect(f.mock.calls[1][1].headers['X-CSRF-Token']).toBe('tok123');
    expect(f.mock.calls[1][1].body).toBe('{"a":1}');
    expect(f.mock.calls[1][1].credentials).toBe('same-origin');
  });

  it('always sends a JSON body on POST without payload', async () => {
    const f = mockFetch(200, {});
    await api.post('/x');
    expect(f.mock.calls[0][1].body).toBe('{}');
  });

  it('turns API errors into ApiError with field errors', async () => {
    mockFetch(400, { error: { code: 'BAD_REQUEST', message: 'Data tidak valid', details: [{ path: 'subject', message: 'Wajib' }] } });
    const err = (await api.post('/x', {}).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Data tidak valid');
    expect(err.fieldErrors).toEqual({ subject: 'Wajib' });
  });

  it('signals session expiry on 401', async () => {
    mockFetch(401, { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk' } });
    const handler = vi.fn();
    window.addEventListener('auth:expired', handler);
    await api.get('/incoming-letters').catch(() => undefined);
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener('auth:expired', handler);
  });

  it('builds query strings without empty values', () => {
    expect(toQueryString({ a: 'x', b: '', c: undefined, d: 2 })).toBe('?a=x&d=2');
    expect(toQueryString({})).toBe('');
  });
});
