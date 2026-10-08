import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoleExperiencePackage, roleExperienceContext } from '../src/role-experience-packages.mjs';
import { roleDirectionOverlay } from '../src/role-proposals.mjs';
import { ACTIVITIES } from '../src/living-resources.mjs';
import { activityTopic } from '../src/development-facets.mjs';

test('explorer is a package-backed vocation with legal world hooks', () => {
  const explorer = getRoleExperiencePackage('explorer');
  assert.equal(explorer.axis, 'vocation');
  assert.deepEqual(explorer.life.places, ['tidal-old-road', 'backlit-grove', 'echo-waterside']);
  assert.ok(explorer.world.scene_hooks.includes('潮退后的新岔路'));
  assert.equal(roleDirectionOverlay('explorer').package_id, 'explorer-v1');
  assert.equal(ACTIVITIES.find(item => item.activity_id === 'scout-route')?.target, 'floating-frame');
  assert.equal(activityTopic('scout-route'), 'explore');
});

test('explorer can compose with a form without changing physical shell state', () => {
  const context = roleExperienceContext(['wetland_frog', 'explorer']);
  assert.deepEqual(context.directions.map(item => item.direction_id), ['wetland_frog', 'explorer']);
  assert.equal(context.directions.find(item => item.direction_id === 'explorer').appearance.figure_vocation, 'explorer');
});

