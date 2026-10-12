import type { DeskBotLifeWorld, DeskBotRoleWishSnapshot, DeskBotWorldMap } from './types.ts';
import { buildLifeFeed, readPersistentLifeFeed, type DeskBotLifeFeedEvent } from './lifeFeed.ts';
import type { WorldObserverSnapshot } from './worldObserver.ts';

export interface DeskBotWorldFrame {
  snapshotId: string;
  worldId: string;
  revision: number;
  sequence: number;
  map: DeskBotWorldMap;
  life: DeskBotLifeWorld | null;
  lifeFeed: DeskBotLifeFeedEvent[];
  roleWishes: DeskBotRoleWishSnapshot | null;
}

/** One publication owns all visible world projections; action replies only
 * trigger a new read and never replace one panel independently. */
export function projectWorldSnapshot(snapshot: WorldObserverSnapshot): DeskBotWorldFrame {
  const map = snapshot.map as DeskBotWorldMap | null;
  const life = snapshot.life as DeskBotLifeWorld | null;
  if (!map || map.schema !== 'deskbot.world-map.v0.1' || map.world_id !== snapshot.world_id
    || map.world_revision !== snapshot.world_revision || !Array.isArray(map.locations) || !Array.isArray(map.npcs)
    || !map.protagonist) throw new Error('世界地图快照不完整');
  if (life && (life.schema !== 'deskbot.world-life.v0.3' || life.world_revision !== snapshot.world_revision)) {
    throw new Error('生活快照与世界地图不同步');
  }
  const feed = snapshot.feed as { world_revision?: unknown } | null;
  if (!feed || feed.world_revision !== snapshot.world_revision) throw new Error('动静快照与世界地图不同步');
  const wishes = snapshot.role_wishes as { world_revision?: unknown } | null;
  if (wishes && wishes.world_revision !== snapshot.world_revision) throw new Error('角色愿望与世界地图不同步');
  return {
    snapshotId: snapshot.snapshot_id, worldId: snapshot.world_id,
    revision: snapshot.world_revision, sequence: snapshot.sequence,
    map, life,
    lifeFeed: readPersistentLifeFeed(snapshot.feed) ?? (life ? buildLifeFeed(map, life) : []),
    roleWishes: snapshot.role_wishes as DeskBotRoleWishSnapshot | null,
  };
}
