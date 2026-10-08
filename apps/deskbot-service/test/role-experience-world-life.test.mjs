import test from 'node:test';
import assert from 'node:assert/strict';
import { roleExperienceContext } from '../src/role-experience-packages.mjs';

test('chef package exposes a complete lived-world vertical slice', () => {
  const context = roleExperienceContext(['chef']);
  const chef = context.directions[0];
  assert.equal(chef.direction_id, 'chef');
  assert.deepEqual(chef.life.places, ['warm-pot-courtyard']);
  assert.ok(chef.world.scene_hooks.length > 0);
  assert.ok(chef.world.npc_hooks.length > 0);
  assert.equal(chef.expression.screen.motif, 'steam_swirl');
  assert.equal(chef.appearance.figure_vocation, 'chef');
});

test('form and vocation packages remain independently composable for world projections', () => {
  const context = roleExperienceContext(['wetland_frog', 'chef']);
  assert.deepEqual(context.directions.map(item => item.axis), ['form', 'vocation']);
  assert.equal(context.directions.find(item => item.axis === 'form').direction_id, 'wetland_frog');
  assert.equal(context.directions.find(item => item.axis === 'vocation').direction_id, 'chef');
});

