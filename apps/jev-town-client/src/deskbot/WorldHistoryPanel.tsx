import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { worldGlance } from './lifeGlance.ts';
import { fetchWorldHistoryAt, fetchWorldHistoryPage, mergeWorldHistoryWindow, WorldHistoryReadError,
  type WorldHistoryAt, type WorldHistoryPage } from './worldHistory.ts';
import { shapingAppearanceLabel } from '../three/shapingAppearance.ts';
import './world-history.css';

const Figure = lazy(() => import('./RoleAppearancePreview.tsx').then(module => ({ default: module.RoleAppearancePreview })));

const dateTime = (value: string) => new Date(value).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Old ledger gaps are permanent; transport errors can be retried. Give the
 * two situations different actions while leaving the narrative readable. */
export function WorldHistoryMomentNotice({ error, onLive, onRetry }: {
  error: Error; onLive: () => void; onRetry: () => void;
}) {
  return <p className="world-history__error" role="status">{error.message}
    {error instanceof WorldHistoryReadError && error.code === 'history_unavailable'
      ? <button type="button" className="world-history__retry" onClick={onLive}>返回实时小镇</button> : null}
    {(!(error instanceof WorldHistoryReadError) || error.retryable)
      ? <button type="button" className="world-history__retry" onClick={onRetry}>重试这一刻</button> : null}
  </p>;
}

export function WorldHistoryPanel({ baseUrl, onClose, worldId: expectedWorldId, liveSequence }: {
  baseUrl: string; onClose: () => void; worldId?: string; liveSequence?: number;
}) {
  const [page, setPage] = useState<WorldHistoryPage | null>(null);
  const entries = page?.entries ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<WorldHistoryAt | null>(null);
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingAt, setLoadingAt] = useState(false);
  const [pageError, setPageError] = useState('');
  const [momentError, setMomentError] = useState<Error | null>(null);
  const [momentRetry, setMomentRetry] = useState(0);
  const pageRequest = useRef<AbortController | null>(null);
  const lifecycle = useRef(0);
  const selectedIndex = Math.max(0, entries.findIndex(item => item.id === selectedId));
  const selected = entries[selectedIndex] ?? null;

  useEffect(() => {
    const generation = ++lifecycle.current;
    const controller = new AbortController();
    pageRequest.current = controller;
    setPage(null); setHistory(null); setSelectedId(null); setLoadingPage(true); setPageError('');
    fetchWorldHistoryPage(baseUrl, null, controller.signal).then(page => {
      if (controller.signal.aborted || generation !== lifecycle.current) return;
      if (expectedWorldId && page.worldId !== expectedWorldId) throw new Error('这份往事属于另一个小镇，请重新连接当前世界');
      setPage(page);
      setSelectedId(page.entries[0]?.id ?? null);
      setPageError('');
    }).catch(value => {
      if (!controller.signal.aborted && generation === lifecycle.current) setPageError(value instanceof Error ? value.message : '无法读取小镇旧事');
    }).finally(() => { if (!controller.signal.aborted && generation === lifecycle.current) { setLoadingPage(false); pageRequest.current = null; } });
    return () => { lifecycle.current += 1; controller.abort(); pageRequest.current?.abort(); pageRequest.current = null; };
  }, [baseUrl, expectedWorldId]);

  useEffect(() => {
    if (selected?.sequence === undefined || !page?.worldId) { setHistory(null); setLoadingAt(false); setMomentError(null); return; }
    const controller = new AbortController();
    setHistory(null);
    setMomentError(null);
    setLoadingAt(true);
    fetchWorldHistoryAt(baseUrl, selected.sequence, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (value.worldId !== page.worldId) throw new Error('这段记录属于另一个世界，无法放进当前时间线');
      setHistory(value);
      setMomentError(null);
    }).catch(value => {
      if (!controller.signal.aborted) setMomentError(value instanceof Error ? value : new Error('这一刻的状态暂不可回看'));
    }).finally(() => { if (!controller.signal.aborted) setLoadingAt(false); });
    return () => controller.abort();
  }, [baseUrl, selected?.id, selected?.sequence, page?.worldId, momentRetry]);

  async function loadPage(direction: 'older' | 'newer' | 'latest') {
    if (loadingPage || direction === 'older' && (!page?.beforeId || !page.hasMoreBefore)
      || direction === 'newer' && (!page?.afterId || !page.hasMoreAfter)) return;
    const generation = lifecycle.current;
    const controller = new AbortController();
    pageRequest.current = controller;
    setLoadingPage(true);
    try {
      const next = await fetchWorldHistoryPage(baseUrl, direction === 'older' ? page?.beforeId ?? null : null, controller.signal,
        { ...(direction === 'latest' ? {} : { headSequence: page?.headSequence }), afterId: direction === 'newer' ? page?.afterId : null });
      if (controller.signal.aborted || generation !== lifecycle.current) return;
      if ((expectedWorldId ?? page?.worldId) && next.worldId !== (expectedWorldId ?? page?.worldId)) throw new Error('小镇记录已切换，关闭后重新打开即可');
      const merged = mergeWorldHistoryWindow(page, next, direction);
      setPage(merged);
      if (direction === 'latest') setSelectedId(merged.entries[0]?.id ?? null);
      else if (!merged.entries.some(item => item.id === selectedId)) setSelectedId((direction === 'older' ? merged.entries[0] : merged.entries.at(-1))?.id ?? null);
      setPageError('');
    } catch (value) {
      if (!controller.signal.aborted && generation === lifecycle.current) setPageError(value instanceof Error ? value.message : '这页记录暂不可读取，连接恢复后可以重试');
    } finally { if (!controller.signal.aborted && generation === lifecycle.current) { setLoadingPage(false); pageRequest.current = null; } }
  }

  const glance = useMemo(() => history && selected
    ? worldGlance(history.map, Date.parse(history.committedAt ?? selected.at)) : null,
  [history, selected]);
  const place = history?.map.locations.find(item => item.location_id === history.map.protagonist.location_id);
  const appearance = history?.map.protagonist.appearance?.role_stage;
  const residentsHere = history?.map.npcs.filter(item => item.location_id === history.map.protagonist.location_id) ?? [];

  return <aside id="deskbot-history-panel" className="world-history" aria-label="小镇往事" aria-live="off">
    <div className="world-history__head">
      <div><span>世界账本 · 只读</span><h2>小镇往事</h2></div>
      <button type="button" className="world-history__close" aria-label="关闭往事，返回实时小镇" onClick={onClose}>×</button>
    </div>
    {loadingPage && !entries.length ? <p className="world-history__status" role="status">正在翻阅…</p> : null}
    {pageError ? <p className="world-history__error" role="alert">{pageError}</p> : null}
    <div className="world-history__navigation">
      <button type="button" disabled={loadingPage} onClick={() => void loadPage('latest')}>{pageError && !page ? '重新连接并翻阅' : '翻到最近的日子'}</button>
      {page?.headSequence !== null && page?.headSequence !== undefined && liveSequence !== undefined && liveSequence > page.headSequence
        ? <span>小镇又有了新的动静</span> : <span>翻阅往事时，小镇仍在继续生活</span>}
    </div>
    {!loadingPage && !entries.length && !pageError ? <p className="world-history__status">小镇还没有留下可回看的生活片段。</p> : null}
    {selected ? <>
      <div className="world-history__selected">
        <time dateTime={selected.at}>{dateTime(selected.at)}</time>
        <h3>{selected.title}</h3>
        {selected.text ? <p>{selected.text}</p> : null}
      </div>
      <div className="world-history__scrubber" aria-label="浏览已加载的历史记录">
        <button type="button" aria-label="更早一条" disabled={selectedIndex >= entries.length - 1} onClick={() => setSelectedId(entries[selectedIndex + 1]?.id ?? null)}>‹</button>
        <input type="range" min={0} max={Math.max(0, entries.length - 1)} value={entries.length - 1 - selectedIndex}
          aria-label="历史时间线" disabled={entries.length < 2}
          onChange={event => setSelectedId(entries[entries.length - 1 - Number(event.target.value)]?.id ?? null)} />
        <button type="button" aria-label="较近一条" disabled={selectedIndex === 0} onClick={() => setSelectedId(entries[selectedIndex - 1]?.id ?? null)}>›</button>
      </div>
      <div className="world-history__moment" aria-busy={loadingAt}>
        {momentError ? <WorldHistoryMomentNotice error={momentError} onLive={onClose}
          onRetry={() => setMomentRetry(value => value + 1)} /> : null}
        {loadingAt ? <p role="status">正在还原这一刻…</p> : history && glance ? <>
          <div className="world-history__facts"><span>当时 · {glance.date} {glance.clock}</span><span>第 {history.revision} 次世界修订</span></div>
          <p>喵呜在<strong>{place?.name ?? '尚未标注的地方'}</strong>{residentsHere.length ? `，${residentsHere.map(item => item.display_name).join('、')}也在这里。` : '。'}</p>
          <p>当时的形象：<strong>{shapingAppearanceLabel(appearance)}</strong></p>
          {appearance ? <Suspense fallback={<p>正在读取当时的形象…</p>}><Figure appearance={appearance} label="当时采用的虚拟形象" /></Suspense> : null}
        </> : null}
      </div>
      {page?.hasMoreAfter ? <button className="world-history__more" type="button" disabled={loadingPage} onClick={() => void loadPage('newer')}>翻看较近的日子</button> : null}
      <ol className="world-history__events" aria-label="已加载的小镇往事">
        {entries.map(item => <li key={item.id}>
          <button type="button" aria-current={item.id === selected.id ? 'step' : undefined}
            onClick={() => setSelectedId(item.id)}>
            <time dateTime={item.at}>{dateTime(item.at)}</time><span>{item.title}</span>
          </button>
        </li>)}
      </ol>
      {page?.hasMoreBefore ? <button className="world-history__more" type="button" disabled={loadingPage} onClick={() => void loadPage('older')}>{loadingPage ? '正在翻阅…' : '翻看更早的日子'}</button> : null}
    </> : null}
  </aside>;
}
