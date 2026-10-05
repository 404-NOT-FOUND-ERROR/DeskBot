import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExternalConnectors, parseNewsFeed } from '../src/external-connectors.mjs';
import { createDeskBotServer } from '../src/app.mjs';

const AT = new Date('2026-10-05T04:00:00Z');
const rss = (n = 4) => `<rss><channel>${Array.from({length:n}, (_, i) => `<item><title><![CDATA[Forest &amp; sky ${i}]]></title><link>https://science.nasa.gov/example-${i}/</link><pubDate>${new Date(AT - i * 1000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
function memory() {
  const records = new Map();
  return { get: (ns, id) => structuredClone(records.get(`${ns}:${id}`) ?? null), put: (ns, id, value) => records.set(`${ns}:${id}`, structuredClone(value)) };
}
const json = data => new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}});
const airData = (at = AT.toISOString(), aqi = 160) => ({ current: {time: at.replace('Z', ''), us_aqi: aqi, pm2_5: 45} });

test('RSS keeps publisher attribution and rejects stale/future/off-host/entity content', () => {
  const parsed = parseNewsFeed(rss(), {now: AT});
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].title, 'Forest & sky 0');
  assert.equal(parseNewsFeed(rss().replaceAll('science.nasa.gov', 'untrusted.example'), {now: AT}).length, 0);
  assert.equal(parseNewsFeed(rss(), {now: new Date(+AT + 8 * 86400000)}).length, 0);
  assert.equal(parseNewsFeed(rss(), {now: new Date(+AT - 3600000)}).length, 0);
  assert.throws(() => parseNewsFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss/>'), /invalid_feed/);
  assert.throws(() => parseNewsFeed('<html>upstream error</html>'), /invalid_feed/);
});

test('news delivery survives restart, retries identical pending events, deduplicates and caps the Shanghai day', async () => {
  const persistence = memory();
  let at = new Date(AT), translations = 0;
  const options = { persistence, now: () => at, fetchImpl: async () => new Response(rss()), translateTitle: async () => { translations++; return '森林与天空'; } };
  let news = createExternalConnectors(options)[0];
  const first = await news.refresh();
  assert.equal(first.events.length, 3);
  assert.equal(translations, 3);
  news = createExternalConnectors(options)[0];
  assert.deepEqual((await news.refresh()).events, first.events);
  assert.equal(translations, 3);
  first.events.forEach(e => news.acknowledge(e.event_id));
  assert.equal((await news.refresh()).events.length, 0);
  at = new Date('2026-10-05T17:00:00Z'); // Next Shanghai day, same UTC date.
  news = createExternalConnectors(options)[0];
  const next = await news.refresh();
  assert.equal(next.events.length, 1);
  assert.ok(!first.events.some(e => e.event_id === next.events[0].event_id));
  assert.equal(next.events[0].payload.original_title, 'Forest & sky 3');
  assert.equal(next.events[0].payload.text, '森林与天空');
});

test('failed title translation keeps original publisher text and never invents an action', async () => {
  const news = createExternalConnectors({now: () => AT, fetchImpl: async () => new Response(rss(1)), translateTitle: async () => { throw Error('offline'); }})[0];
  const {events} = await news.refresh();
  assert.equal(events[0].payload.text, 'Forest & sky 0');
  assert.equal(events[0].payload.title_translated, false);
  assert.equal(events[0].payload.topic_code, undefined);
});

test('air quality validates model timestamp/numbers and stable origin across restart', async () => {
  const persistence = memory();
  const options = {persistence, now: () => AT, fetchImpl: async () => json(airData())};
  let air = createExternalConnectors(options)[1];
  const first = await air.refresh();
  assert.equal(first.events[0].payload.data_kind, 'regional_model');
  assert.equal(first.events[0].payload.us_aqi, 160);
  air = createExternalConnectors(options)[1];
  assert.deepEqual((await air.refresh()).events, first.events);
  air.acknowledge(first.events[0].event_id);
  assert.equal((await air.refresh()).events.length, 0);
  for (const data of [airData(new Date(+AT - 3 * 3600000).toISOString()), airData(undefined, null), airData(new Date(+AT + 3600000).toISOString())]) {
    const bad = createExternalConnectors({now: () => AT, fetchImpl: async () => json(data)})[1];
    await assert.rejects(() => bad.refresh(), /air_(invalid|stale)_observation/);
  }
});

test('oversize and provider HTTP failures cannot masquerade as successful observations', async () => {
  const huge = createExternalConnectors({fetchImpl: async () => new Response('x'.repeat(1000001))})[0];
  await assert.rejects(() => huge.refresh(), /response_too_large/);
  const offline = createExternalConnectors({fetchImpl: async () => new Response('private upstream text', {status:503})})[1];
  await assert.rejects(() => offline.refresh(), e => e.message === 'source_http_503');
});

test('configured connectors enter attributed references with original links and real connection state', async t => {
  const sources = createExternalConnectors({now: () => AT, fetchImpl: async url => String(url).includes('air-quality') ? json(airData()) : new Response(rss(1))});
  const server = createDeskBotServer({now: () => AT, timeMode: 'realtime', autonomousLifeEnabled: true, residentLifeEnabled: true, refractionSources: sources,
    llm: {id:'test-real-provider', status: () => ({provider:'deepseek',model:'deepseek-flash',configured:true,status:'connected'})}});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await server.inputRuntime.tick({sourceIds:sources.map(s => s.sourceId)});
  const base = `http://127.0.0.1:${server.address().port}`;
  const before = server.persistentWorld.get();
  const inputs = await (await fetch(base + '/api/life/inputs')).json();
  const model = await (await fetch(base + '/api/model/status')).json();
  const map = await (await fetch(base + '/api/world/map')).json();
  assert.equal(model.status, 'connected');
  assert.equal(inputs.source_status.find(s => s.id === 'nasa_science').status, 'fresh');
  assert.equal(inputs.records.find(r => r.meaning === 'sourced_report').source_url, 'https://science.nasa.gov/example-0/');
  assert.equal(inputs.records.find(r => r.meaning === 'sourced_report').published_at, AT.toISOString());
  assert.equal(inputs.records.find(r => r.meaning === 'environment_reference').environment.us_aqi, 160);
  assert.equal(inputs.records.find(r => r.meaning === 'environment_reference').expires_at, new Date(+AT + 2 * 3600000).toISOString());
  assert.ok(inputs.records.every(r => r.independent_evidence === false));
  assert.deepEqual(map.refraction.source_status, inputs.source_status);
  assert.deepEqual(server.persistentWorld.get(), before);
  const again = await server.inputRuntime.tick({force:true, sourceIds:sources.map(s => s.sourceId)});
  assert.ok(again.every(r => !r.error));
  assert.equal(server.persistentWorld.get().refraction.records.length, before.refraction.records.length);
});
