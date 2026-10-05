import { createHash } from 'node:crypto';

const HOUR = 3_600_000;
export const NEWS_FEED = 'https://science.nasa.gov/feed/';
export const AIR_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const iso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const dayKey = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

function plain(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
      const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[n]))
    .replace(/\s+/g, ' ').trim();
}

// This adapter accepts the fixed publisher's RSS item fields, never executes
// XML entities, downloads an article, or treats prose as an action instruction.
export function parseNewsFeed(xml, { now = new Date(), allowedHost = 'science.nasa.gov' } = {}) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<rss\b/i.test(xml)) {
    throw new Error('news_invalid_feed');
  }
  const items = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const tag = name => plain(match[1].match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '');
    const title = tag('title').slice(0, 220), published = iso(tag('pubDate'));
    let link;
    try { link = new URL(tag('link')); } catch { continue; }
    if (!title || !published || link.protocol !== 'https:' || link.hostname !== allowedHost || link.username || link.password) continue;
    if (Date.parse(published) > now.getTime() + 300_000 || now.getTime() - Date.parse(published) > 7 * 24 * HOUR) continue;
    link.hash = '';
    items.push({ title, url: link.href, published_at: published, origin_id: `nasa:${digest(link.href + published)}` });
  }
  return items.sort((a, b) => b.published_at.localeCompare(a.published_at));
}

async function boundedFetch(url, { fetchImpl, timeoutMs, format }) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { accept: format === 'json' ? 'application/json' : 'application/rss+xml, application/xml' } });
  if (!response.ok) throw new Error(`source_http_${response.status}`);
  // Streaming also bounds a response with no Content-Length header.
  if (Number(response.headers?.get('content-length')) > 1_000_000) throw new Error('source_response_too_large');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) { await reader.cancel(); throw new Error('source_response_too_large'); }
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return format === 'json' ? JSON.parse(text) : text;
}

export function createExternalConnectors({ persistence = null, now = () => new Date(), fetchImpl = globalThis.fetch,
  newsEnabled = true, airEnabled = true, latitude = 31.23, longitude = 121.47, location = '上海', timeoutMs = 15_000, translateTitle = null } = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new TypeError('Invalid air-quality coordinates');
  const namespace = 'external-connectors.v1';
  const make = ({ sourceId, displayName, sourceUrl, ttlMs, enabled, produce }) => {
    let state = persistence?.get?.(namespace, sourceId) ?? { seen: [], pending: [], delivered: {}, fetched_at: null };
    const save = next => { persistence?.put?.(namespace, sourceId, next); state = next; };
    return {
      sourceId, displayName, sourceUrl, ttlMs, enabled, kind: 'provider',
      async refresh() {
        if (!state.pending.length) {
          const events = await produce(state);
          save({ ...state, pending: events, fetched_at: now().toISOString() });
        }
        return { events: structuredClone(state.pending), fetched_at: state.fetched_at,
          connector: { provider: sourceId, last_success_at: state.fetched_at, ttl_ms: ttlMs } };
      },
      acknowledge(eventId) {
        const event = state.pending.find(e => e.event_id === eventId);
        if (!event) return;
        const date = dayKey(now());
        const delivered = { ...state.delivered, [date]: (state.delivered[date] ?? 0) + 1 };
        for (const day of Object.keys(delivered)) if (day < dayKey(now().getTime() - 8 * 24 * HOUR)) delete delivered[day];
        save({ ...state, pending: state.pending.filter(e => e.event_id !== eventId), seen: [...state.seen, event.provenance.origin_event_id].slice(-512), delivered });
      },
    };
  };
  const news = make({ sourceId: 'nasa_science', displayName: '自然与宇宙来信 · NASA Science', sourceUrl: NEWS_FEED, ttlMs: 4 * HOUR, enabled: newsEnabled,
    produce: async state => {
      const at = now(), xml = await boundedFetch(NEWS_FEED, { fetchImpl, timeoutMs, format: 'xml' });
      const remaining = Math.max(0, 3 - (state.delivered[dayKey(at)] ?? 0));
      const events = [];
      for (const item of parseNewsFeed(xml, { now: at }).filter(item => !state.seen.includes(item.origin_id)).slice(0, remaining)) {
        let translated = persistence?.get?.('news-title-translations.v1', item.origin_id)?.text ?? null;
        if (!translated && translateTitle) {
          try {
            translated = String(await translateTitle(item.title)).trim().slice(0, 160);
            if (translated) persistence?.put?.('news-title-translations.v1', item.origin_id, { text: translated });
          } catch { /* The publisher's original remains available if the model is offline. */ }
        }
        events.push({
        event_id: `news:${digest(item.origin_id)}`, type: 'news.item', occurred_at: at.toISOString(), observed_at: at.toISOString(),
        payload: { text: translated || item.title, original_title: item.title, title_translated: Boolean(translated), published_at: item.published_at, source_url: item.url, report_kind: 'science_news',
          summary: `读到一则自然与宇宙消息：${translated || item.title}` },
        provenance: { origin_event_id: item.origin_id, published_at: item.published_at, feed_url: NEWS_FEED, observation_kind: 'publisher_report' },
        });
      }
      return events;
    } });
  const air = make({ sourceId: 'shanghai_air', displayName: '上海空气 · Open-Meteo / CAMS', sourceUrl: 'https://open-meteo.com/en/docs/air-quality-api', ttlMs: HOUR, enabled: airEnabled,
    produce: async state => {
      const url = new URL(AIR_ENDPOINT);
      url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), current: 'pm2_5,us_aqi', timezone: 'UTC' });
      const data = await boundedFetch(url, { fetchImpl, timeoutMs, format: 'json' });
      const observed = iso(data.current?.time?.endsWith('Z') ? data.current.time : `${data.current?.time}Z`);
      const pm25 = data.current?.pm2_5, aqi = data.current?.us_aqi;
      if (!observed || !Number.isFinite(pm25) || pm25 < 0 || pm25 > 2000 || !Number.isFinite(aqi) || aqi < 0 || aqi > 1000) throw new Error('air_invalid_observation');
      if (Math.abs(now().getTime() - Date.parse(observed)) > 2 * HOUR || Date.parse(observed) > now().getTime() + 300_000) throw new Error('air_stale_observation');
      const origin = `cams:${digest(`${latitude}:${longitude}:${observed}:${pm25}:${aqi}`)}`;
      if (state.seen.includes(origin)) return [];
      return [{ event_id: `air:${digest(origin)}`, type: 'external.air_quality', occurred_at: now().toISOString(), observed_at: observed,
        payload: { report_kind: 'air_quality', location, pm2_5: pm25, us_aqi: aqi, data_kind: 'regional_model',
          summary: `${location}区域空气模型：PM2.5 ${pm25} μg/m³，美国 AQI ${aqi}；作为露天活动参考。` },
        provenance: { origin_event_id: origin, data_kind: 'regional_model', expires_at: new Date(Date.parse(observed) + 2 * HOUR).toISOString(), attribution: 'Open-Meteo / CAMS ENSEMBLE' },
      }];
    } });
  return [news, air];
}
