import { describe, expect, it } from 'vitest';
import { projectWorldSnapshot } from '../src/deskbot/worldView.ts';
import type { WorldObserverSnapshot } from '../src/deskbot/worldObserver.ts';

const map = {
  schema: 'deskbot.world-map.v0.1', world_id: 'w', world_revision: 4,
  logical_time: { day: 2, minute_of_day: 10, tick: 1 },
  protagonist: { character_id: 'shaping-001', location_id: 'plaza' }, npcs: [], locations: [],
};
const life = {
  schema: 'deskbot.world-life.v0.3', world_revision: 4, enabled: true,
  current_location_id: 'plaza', current_scene: null, recent_scenes: [], recent_experiences: [],
  encounters: [], available_interactions: [],
};
const snapshot = (overrides: Partial<WorldObserverSnapshot> = {}): WorldObserverSnapshot => ({
  schema: 'deskbot.world-observer-snapshot.v1', world_id: 'w', world_revision: 4, sequence: 9,
  snapshot_id: 's-4-9', captured_at: '2026-10-11T00:00:00.000Z', map, life,
  feed: { schema: 'deskbot.world-life-feed-response.v1', world_id: 'w', world_revision: 4, entries: [] },
  role_wishes: null, ...overrides,
});

describe('world snapshot projection', () => {
  it('keeps the map, life, feed and role wishes in one frame', () => {
    const frame = projectWorldSnapshot(snapshot({ role_wishes: { world_revision: 4, evolution: {}, proposals: [] } }));
    expect(frame.snapshotId).toBe('s-4-9');
    expect(frame.map.world_revision).toBe(frame.life?.world_revision);
    expect(frame.roleWishes?.proposals).toEqual([]);
  });

  it('rejects a mixed-revision life projection before React state changes', () => {
    expect(() => projectWorldSnapshot(snapshot({ life: { ...life, world_revision: 3 } }))).toThrow('生活快照');
    expect(() => projectWorldSnapshot(snapshot({ role_wishes: { world_revision: 3, evolution: {}, proposals: [] } }))).toThrow('角色愿望');
  });

  it('projects only the public feed fields in deterministic canonical order', () => {
    const feed = { schema: 'deskbot.world-life-feed-response.v1', world_revision: 4, entries: [
      { id: 'b', at: '2026-10-11T00:00:00Z', title: '后来的事', text: '刚刚发生', location_id: 'plaza', provenance: { sequence: 9, private: 'hidden' } },
      { id: 'a', at: '2026-10-11T01:00:00Z', title: '早先的事', text: '已经发生', provenance: { sequence: 8 } },
    ] };
    const frame = projectWorldSnapshot(snapshot({feed}));
    expect(frame.lifeFeed.map(event => event.id)).toEqual(['b', 'a']);
    expect(frame.lifeFeed[0]?.locationId).toBe('plaza');
    expect(JSON.stringify(frame.lifeFeed)).not.toContain('hidden');
  });
});
