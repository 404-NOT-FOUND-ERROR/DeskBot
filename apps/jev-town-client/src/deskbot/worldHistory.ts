import type { DeskBotWorldMap } from './types.ts';
import { readPersistentLifeFeed, type DeskBotLifeFeedEvent } from './lifeFeed.ts';

export interface WorldHistoryPage {
  worldId: string;
  entries: DeskBotLifeFeedEvent[];
  beforeId: string | null;
  afterId: string | null;
  headSequence: number | null;
  currentSequence: number | null;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export interface WorldHistoryAt {
  worldId: string;
  sequence: number;
  headSequence: number;
  revision: number;
  committedAt: string | null;
  map: DeskBotWorldMap;
}

const root = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

export const WORLD_HISTORY_WINDOW_LIMIT = 240;

/** Keep a bounded cursor window instead of storing an ever-growing town
 * history in the browser. Moving the window never changes the live world. */
export function mergeWorldHistoryWindow(current: WorldHistoryPage | null, page: WorldHistoryPage,
  direction: 'older' | 'newer' | 'latest', limit = WORLD_HISTORY_WINDOW_LIMIT): WorldHistoryPage {
  if (!current || direction === 'latest') return { ...page, entries: page.entries.slice(0, limit) };
  if (current.worldId !== page.worldId || current.headSequence !== page.headSequence) throw new Error('小镇时间线已切换，请重新翻阅最近的日子');
  const unique = new Map<string, DeskBotLifeFeedEvent>();
  const combined = direction === 'older' ? [...current.entries, ...page.entries] : [...page.entries, ...current.entries];
  for (const item of combined) if (!unique.has(item.id)) unique.set(item.id, item);
  const values = [...unique.values()];
  const dropped = Math.max(0, values.length - limit);
  const entries = direction === 'older' ? values.slice(-limit) : values.slice(0, limit);
  return {
    ...page, entries,
    beforeId: entries.at(-1)?.id ?? null, afterId: entries[0]?.id ?? null,
    hasMoreBefore: direction === 'older' ? page.hasMoreBefore : current.hasMoreBefore || dropped > 0,
    hasMoreAfter: direction === 'newer' ? page.hasMoreAfter : current.hasMoreAfter || dropped > 0,
  };
}

export class WorldHistoryReadError extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable: boolean,
    public readonly availableFromSequence: number | null = null) { super(message); }
}

async function readHistoryResponse(url: string, signal?: AbortSignal): Promise<Response> {
  try { return await fetch(url, { cache: 'no-store', signal }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new WorldHistoryReadError('暂时没连上小镇，已有往事仍在。连接恢复后可以重试。', 'history_transport_failed', true);
  }
}

export async function fetchWorldHistoryPage(baseUrl: string, beforeId: string | null = null, signal?: AbortSignal, options: { headSequence?: number | null; afterId?: string | null; limit?: number } = {}): Promise<WorldHistoryPage> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 12) });
  if (beforeId) params.set('before_id', beforeId);
  if (options.afterId) params.set('after_id', options.afterId);
  if (Number.isSafeInteger(options.headSequence)) params.set('head_sequence', String(options.headSequence));
  const response = await readHistoryResponse(`${root(baseUrl)}/api/life/world/feed?${params}`, signal);
  const body = await response.json() as {
    schema?: string; world_id?: string; message?: string;
    head_sequence?: number | null; current_sequence?: number | null;
    cursor?: { before_id?: string | null; after_id?: string | null; has_more_before?: boolean; has_more_after?: boolean };
  };
  const entries = readPersistentLifeFeed(body, 200);
  if (!response.ok || !entries || typeof body.world_id !== 'string' || body.world_id.length === 0) {
    throw new Error(body.message ?? '无法读取小镇旧事');
  }
  if (Number.isSafeInteger(options.headSequence) && body.head_sequence !== options.headSequence
    || Number.isSafeInteger(body.head_sequence) && (body.head_sequence! < 0
      || !Number.isSafeInteger(body.current_sequence) || body.current_sequence! < body.head_sequence!
      || entries.some(item => item.sequence !== undefined && item.sequence > body.head_sequence!))) {
    throw new Error('小镇时间线已切换，请重新翻阅最近的日子');
  }
  return {
    worldId: body.world_id,
    entries,
    beforeId: typeof body.cursor?.before_id === 'string' ? body.cursor.before_id : null,
    afterId: typeof body.cursor?.after_id === 'string' ? body.cursor.after_id : null,
    headSequence: Number.isSafeInteger(body.head_sequence) ? body.head_sequence! : null,
    currentSequence: Number.isSafeInteger(body.current_sequence) ? body.current_sequence! : null,
    hasMoreBefore: body.cursor?.has_more_before === true,
    hasMoreAfter: body.cursor?.has_more_after === true,
  };
}

export async function fetchWorldHistoryAt(baseUrl: string, sequence: number, signal?: AbortSignal): Promise<WorldHistoryAt> {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('无效的世界历史序号');
  const response = await readHistoryResponse(`${root(baseUrl)}/api/world/history/at?sequence=${sequence}`, signal);
  const body = await response.json() as {
    schema?: string; world_id?: string; sequence?: number; head_sequence?: number;
    world_revision?: number; mutation?: { committed_at?: string }; map?: DeskBotWorldMap; message?: string; error?: string;
    history_boundary?: { available_from_sequence?: number | null };
  };
  if (!response.ok) {
    const unavailable = body.error === 'history_unavailable';
    throw new WorldHistoryReadError(unavailable
      ? '这段生活记录仍在，但旧存档缺少完整的变化记录，无法准确还原当时的状态。可以继续读往事，或翻看较近的日子。'
      : response.status >= 500 ? '暂时没连上小镇，已有往事仍在。连接恢复后可以重试这一刻。'
        : body.error === 'history_sequence_not_found' ? '这段往事的世界快照不在当前存档中。可以重新翻阅最近的日子。' : '这一刻暂不可回看，请重新翻阅最近的日子。',
    body.error ?? 'history_read_failed', response.status >= 500,
    Number.isSafeInteger(body.history_boundary?.available_from_sequence) ? body.history_boundary!.available_from_sequence! : null);
  }
  if (body.schema !== 'deskbot.world-history-at.v1' || !body.world_id || body.sequence !== sequence
    || !Number.isSafeInteger(body.head_sequence) || !Number.isSafeInteger(body.world_revision)
    || body.map?.schema !== 'deskbot.world-map.v0.1' || body.map.world_id !== body.world_id
    || body.map.world_revision !== body.world_revision) {
    throw new Error('历史快照与世界账本不一致');
  }
  return {
    worldId: body.world_id,
    sequence,
    headSequence: body.head_sequence!,
    revision: body.world_revision!,
    committedAt: body.mutation?.committed_at ?? null,
    map: body.map,
  };
}
