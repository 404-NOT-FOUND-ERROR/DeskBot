import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('experience package endpoint is read-only and exposes the unified performance projection', async () => {
  const persistence = createSqlitePersistence({ filename: join(mkdtempSync(join(tmpdir(), 'deskbot-packages-')), 'state.sqlite') });
  const server = createDeskBotServer({ persistence, worldLifeEnabled: false, autonomousLifeEnabled: false });
  server.listen(0);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/roles/experience-packages?direction_id=wetland_frog&direction_id=chef`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.schema, 'deskbot.role-experience-package-list.v1');
    assert.ok(body.packages.some(item => item.direction_id === 'explorer'));
    assert.deepEqual(body.performance.package_ids, ['wetland-frog-v1', 'chef-v1']);
    assert.equal(body.performance.virtual_appearance.physical_shell_changed, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    persistence.close();
  }
});

