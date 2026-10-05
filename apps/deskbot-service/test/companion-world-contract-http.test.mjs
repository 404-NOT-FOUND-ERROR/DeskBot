import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskBotServer } from '../src/app.mjs';

test('contract endpoint exposes authored content without installing residents or changing the world', async t => {
  const server = createDeskBotServer({ now: () => new Date('2026-10-04T12:00:00.000Z') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const readWorld = async () => (await (await fetch(`${base}/api/world/state`)).json()).world;
  const before = await readWorld();
  const response = await fetch(`${base}/api/world/contract`);
  assert.equal(response.status, 200);
  const contract = await response.json();
  assert.equal(contract.schema, 'deskbot.companion-world-contract.v1');
  assert.equal(contract.rules.time.rate, 1);
  assert.equal(contract.catalog.residents.length, 12);
  assert.equal(contract.adoption.resident_catalog_installed, false);
  assert.equal(contract.adoption.rules_enforced_by_runtime, false);
  assert.deepEqual(contract.adoption.active_npc_ids, []);
  assert.deepEqual(await readWorld(), before);
  const rejected = await fetch(`${base}/api/world/contract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'install' }) });
  assert.equal(rejected.status, 404);
  assert.deepEqual(await readWorld(), before);
});
