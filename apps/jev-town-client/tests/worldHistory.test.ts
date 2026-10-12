import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorldHistoryAt, fetchWorldHistoryPage, mergeWorldHistoryWindow, WorldHistoryReadError } from '../src/deskbot/worldHistory.ts';

describe('read-only world history client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the canonical feed cursor for older pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      schema: 'deskbot.world-life-feed-response.v1', world_id: 'deskbot-small-world',
      entries: [{ id: 'life-feed:mutation-1', at: '2026-10-12T08:00:00Z', kind: 'world.event', title: '旧事', text: '已经发生', provenance: { sequence: 1 } }],
      cursor: { before_id: 'life-feed:mutation-1', has_more_before: true },
    }), { status: 200 })));
    const page = await fetchWorldHistoryPage('http://local/', 'previous-item');
    expect(page.entries[0]?.sequence).toBe(1);
    expect(page.beforeId).toBe('life-feed:mutation-1');
    expect(page.hasMoreBefore).toBe(true);
    expect(fetch).toHaveBeenCalledWith('http://local/api/life/world/feed?limit=12&before_id=previous-item', expect.objectContaining({ cache: 'no-store' }));
  });

  it('rejects a historical map from another revision instead of rendering it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      schema: 'deskbot.world-history-at.v1', world_id: 'deskbot-small-world', sequence: 8,
      head_sequence: 10, world_revision: 4,
      map: { schema: 'deskbot.world-map.v0.1', world_id: 'deskbot-small-world', world_revision: 5 },
    }), { status: 200 })));
    await expect(fetchWorldHistoryAt('http://local', 8)).rejects.toThrow('不一致');
    expect(fetch).toHaveBeenCalledWith('http://local/api/world/history/at?sequence=8', expect.objectContaining({ cache: 'no-store' }));
  });

  it('keeps a frozen head while an older page is loaded', () => {
    const initial = {
      worldId: 'deskbot-small-world', entries: [
        { id: 'new', at: '2026-10-12T08:00:00Z', kind: 'world', title: '新', text: '新', sequence: 10 },
        { id: 'old', at: '2026-10-12T07:00:00Z', kind: 'world', title: '旧', text: '旧', sequence: 9 },
      ], beforeId: 'old', afterId: 'new', headSequence: 10, currentSequence: 10,
      hasMoreBefore: true, hasMoreAfter: false,
    } as any;
    const older = { ...initial, entries: [{ id: 'older', at: '2026-10-12T06:00:00Z', kind: 'world', title: '更旧', text: '更旧', sequence: 8 }], beforeId: 'older', afterId: 'older', headSequence: 10, currentSequence: 11, hasMoreBefore: false, hasMoreAfter: true } as any;
    const merged = mergeWorldHistoryWindow(initial, older, 'older', 8);
    expect(merged.headSequence).toBe(10);
    expect(merged.entries.map(value => value.id)).toEqual(['new', 'old', 'older']);
    expect(merged.currentSequence).toBe(11);
  });

  it('uses the frozen head and after-entry cursor for reconnect catch-up without mixing heads', async () => {
    const response = { schema: 'deskbot.world-life-feed-response.v1', world_id: 'w', head_sequence: 20, current_sequence: 21,
      entries: [{ id: 'one', at: '2026-10-12T08:00:00Z', kind: 'world', title: '旧事', text: '已发生', provenance: { sequence: 19, item_index: 1 } }],
      cursor: { before_id: 'one', after_id: 'one', has_more_before: true, has_more_after: true } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })));
    const page = await fetchWorldHistoryPage('http://local', null, undefined, { afterId: 'previous', headSequence: 20 });
    expect(page.headSequence).toBe(20); expect(page.currentSequence).toBe(21); expect(page.entries[0]?.itemIndex).toBe(1);
    expect(fetch).toHaveBeenCalledWith('http://local/api/life/world/feed?limit=12&after_id=previous&head_sequence=20', expect.objectContaining({ cache: 'no-store' }));
    response.head_sequence = 21;
    await expect(fetchWorldHistoryPage('http://local', null, undefined, { headSequence: 20 })).rejects.toThrow('时间线已切换');
  });

  it('moves a bounded window in both directions without duplicates or losing a return cursor', () => {
    const entry = (sequence: number) => ({ id: `entry-${sequence}`, at: '2026-10-12T08:00:00Z', kind: 'world', title: '片段', text: '已发生', sequence });
    const page = (sequences: number[], before = true, after = false) => ({ worldId: 'w', entries: sequences.map(entry),
      beforeId: `entry-${sequences.at(-1)}`, afterId: `entry-${sequences[0]}`, headSequence: 30, currentSequence: 30, hasMoreBefore: before, hasMoreAfter: after });
    const older = mergeWorldHistoryWindow(page([30, 29, 28]), page([28, 27, 26], false, true), 'older', 4);
    expect(older.entries.map(value => value.sequence)).toEqual([29, 28, 27, 26]);
    expect(older.afterId).toBe('entry-29'); expect(older.beforeId).toBe('entry-26');
    expect(older.hasMoreAfter).toBe(true); expect(older.hasMoreBefore).toBe(false);
    const newer = mergeWorldHistoryWindow(older, page([30, 29], true, false), 'newer', 4);
    expect(newer.entries.map(value => value.sequence)).toEqual([30, 29, 28, 27]);
    expect(newer.hasMoreBefore).toBe(true); expect(newer.hasMoreAfter).toBe(false);
    expect(() => mergeWorldHistoryWindow(newer, { ...newer, headSequence: 31 }, 'older')).toThrow('时间线已切换');
  });

  it('retains a retryable disconnect error, and aborts remain aborts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchWorldHistoryAt('http://local', 8)).rejects.toMatchObject({ code: 'history_transport_failed', retryable: true });
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }));
    await expect(fetchWorldHistoryPage('http://local', null, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('preserves structured old-history boundary and does not offer a retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'history_unavailable', message: 'gap', history_boundary: { available_from_sequence: 3953 },
    }), { status: 409 })));
    await expect(fetchWorldHistoryAt('http://local', 3952)).rejects.toMatchObject({
      code: 'history_unavailable', retryable: false, availableFromSequence: 3953,
    } satisfies Partial<WorldHistoryReadError>);
  });
});
