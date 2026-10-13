import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';

import { createDeskBotServer } from '../src/app.mjs';

test('authored world event HTTP evaluation is read-only and returns a bounded candidate input', async t => {
  const now = () => new Date('2026-10-14T08:00:00.000Z');
  const server = createDeskBotServer({ now, websocket: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const before = await (await fetch(`${origin}/api/world/state`)).json();
  const list = await (await fetch(`${origin}/api/world/authored-events`)).json();
  assert.equal(list.schema, 'deskbot.authored-world-event-package-list.v1');
  assert.equal(list.packages[0].package_id, 'morrowmere-lamp-drift-event-v1');
  const response = await fetch(`${origin}/api/world/authored-events/evaluate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: 'http-authored-001', type: 'news.observation', confidence: 0.9,
      occurred_at: now().toISOString(), payload: { title: '雾灯偏向岔口', tags: ['雾灯', '岔口'] } }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  // Public HTTP observations do not get to self-attest confidence; the
  // server-side adapter path below is the one that may produce a candidate.
  assert.equal(body.evaluation.matches.length, 0);
  assert.equal(body.prepared, null);
  const ingested = server.ingestNonChatEvent({ event_id: 'adapter-authored-001', type: 'news.observation',
    source: 'server-news-adapter', confidence: 0.9, occurred_at: now().toISOString(), observed_at: now().toISOString(),
    payload: { title: '雾灯偏向岔口', tags: ['雾灯', '岔口'] } });
  assert.equal(ingested.worldCandidate.candidate.status, 'pending');
  assert.equal(ingested.authoredWorldEvent.package.package_id, 'morrowmere-lamp-drift-event-v1');
  const after = await (await fetch(`${origin}/api/world/state`)).json();
  assert.equal(after.world.world_revision, before.world.world_revision);
  assert.equal(after.world.world_line.latest_event, before.world.world_line.latest_event);
});
