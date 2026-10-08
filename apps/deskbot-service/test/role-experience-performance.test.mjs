import test from 'node:test';
import assert from 'node:assert/strict';
import { roleExperiencePerformance } from '../src/role-experience-performance.mjs';

test('performance projection keeps virtual appearance and physical shell separate', () => {
  const performance = roleExperiencePerformance(['wetland_frog', 'chef']);
  assert.equal(performance.schema, 'deskbot.role-experience-performance.v1');
  assert.equal(performance.virtual_appearance.form.figure_form, 'leaf-frog');
  assert.equal(performance.virtual_appearance.vocation.figure_vocation, 'chef');
  assert.equal(performance.virtual_appearance.physical_shell_changed, false);
  assert.equal(performance.consumers.screen.motif, 'steam_swirl');
  assert.equal(performance.consumers.tts.profile_id, 'miaowu-gentle-v1');
});

test('empty performance uses the baseline without exposing an invalid shell change', () => {
  const performance = roleExperiencePerformance([]);
  assert.deepEqual(performance.identity.labels, ['喵呜猫型第一形态']);
  assert.equal(performance.fallback_used, true);
  assert.equal(performance.virtual_appearance.physical_shell_changed, false);
});

