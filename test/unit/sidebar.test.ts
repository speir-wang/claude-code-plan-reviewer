// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Sidebar } from '../../src/browser/sidebar.js';

describe('Sidebar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function makeSessions(overrides: Partial<{
    id: string;
    status: string;
    updatedAt: string;
    planVersions: { version: number }[];
  }>[] = []) {
    return overrides.map((o) => ({
      id: o.id ?? 'session-id-full',
      status: o.status ?? 'active',
      updatedAt: o.updatedAt ?? new Date().toISOString(),
      planVersions: o.planVersions ?? [{ version: 1 }],
    }));
  }

  function mockFetch(sessions: ReturnType<typeof makeSessions>) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ sessions }),
    } as Response);
  }

  it('init() fetches and renders session list', async () => {
    const fetchSpy = mockFetch(makeSessions([{ id: 'abc12345-long-id' }]));
    const container = document.createElement('div');
    const sidebar = new Sidebar(container);
    await sidebar.init();
    expect(fetchSpy).toHaveBeenCalledWith('/api/sessions');
    expect(container.querySelector('[data-session-item]')).not.toBeNull();
  });

  it('shows "No sessions yet." when sessions list is empty', async () => {
    mockFetch([]);
    const container = document.createElement('div');
    const sidebar = new Sidebar(container);
    await sidebar.init();
    expect(container.querySelector('.sidebar__empty')!.textContent).toBe('No sessions yet.');
  });

  it('session ID is truncated to 8 characters', async () => {
    mockFetch(makeSessions([{ id: 'abcdefghijklmnop' }]));
    const container = document.createElement('div');
    const sidebar = new Sidebar(container);
    await sidebar.init();
    const idSpan = container.querySelector('.sidebar__session-id');
    expect(idSpan!.textContent).toBe('abcdefgh');
  });

  it('status badge has correct data-status attribute', async () => {
    mockFetch(makeSessions([{ id: 'abc12345', status: 'approved' }]));
    const container = document.createElement('div');
    const sidebar = new Sidebar(container);
    await sidebar.init();
    const badge = container.querySelector('[data-session-status]');
    expect(badge!.getAttribute('data-status')).toBe('approved');
  });

  it('version count displays v{N} based on planVersions length', async () => {
    mockFetch(makeSessions([{ id: 'abc12345', planVersions: [{ version: 1 }, { version: 2 }, { version: 3 }] }]));
    const container = document.createElement('div');
    const sidebar = new Sidebar(container);
    await sidebar.init();
    const meta = container.querySelector('.sidebar__meta');
    expect(meta!.textContent).toBe('v3');
  });

  it('link href is /?session={encodedId}', async () => {
    const sessionId = 'my-session-id';
    mockFetch(makeSessions([{ id: sessionId }]));
    const container = document.createElement('div');
    const sidebar = new Sidebar(container);
    await sidebar.init();
    const link = container.querySelector('a.sidebar__link') as HTMLAnchorElement;
    expect(link!.getAttribute('href')).toBe(`/?session=${encodeURIComponent(sessionId)}`);
  });

  it('polling triggers re-fetch after 3000ms', async () => {
    const fetchSpy = mockFetch(makeSessions([{ id: 'abc12345' }]));
    const container = document.createElement('div');
    const sidebar = new Sidebar(container);
    await sidebar.init();
    const callsBefore = fetchSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('network error during fetch leaves previous list unchanged', async () => {
    // First fetch succeeds
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: makeSessions([{ id: 'abc12345' }]) }),
      } as Response)
      .mockRejectedValueOnce(new Error('Network error'));

    const container = document.createElement('div');
    const sidebar = new Sidebar(container);
    await sidebar.init();
    expect(container.querySelector('[data-session-item]')).not.toBeNull();

    // Advance timer to trigger polling with network error
    await vi.advanceTimersByTimeAsync(3000);
    // Should not crash; previous list still showing
    expect(container.querySelector('[data-session-item]')).not.toBeNull();

    fetchSpy.mockRestore();
  });

  it('non-ok response leaves sessions unchanged', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: makeSessions([{ id: 'abc12345' }]) }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ sessions: [] }),
      } as Response);

    const container = document.createElement('div');
    const sidebar = new Sidebar(container);
    await sidebar.init();
    expect(container.querySelector('[data-session-item]')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(3000);
    // Since non-ok, sessions remain from first fetch
    expect(container.querySelector('[data-session-item]')).not.toBeNull();

    fetchSpy.mockRestore();
  });
});
