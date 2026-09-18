import test from 'node:test';
import assert from 'node:assert/strict';
import { listStoryPackages, previewStoryPackage, installStoryPackage } from '../src/story-packages.mjs';

test('story package preview is side-effect free and install creates causal finite plan', () => {
  const now = new Date('2026-09-16T08:00:00.000Z');
  const plans = [];
  const preview = previewStoryPackage('tide-path-three-days-v1', { now, plans, world: { world_revision: 7 } });
  assert.equal(preview.installable, true);
  assert.equal(preview.steps.length, 3);
  assert.equal(plans.length, 0);
  let scheduled;
  const installed = installStoryPackage('tide-path-three-days-v1', { now, plans, world: { world_revision: 7 }, schedule: body => { scheduled = body; plans.push(body); return body; } });
  assert.equal(installed.schema, 'deskbot.story-package-installed.v0.1');
  assert.equal(scheduled.steps.length, 5);
  assert.deepEqual(installed.causal_chain[4].depends_on, ['life:tide-path-three-days-v1:3']);
  assert.equal(previewStoryPackage('tide-path-three-days-v1', { now, plans }).installable, false);
});

test('story package catalog is finite and versioned', () => {
  const packages = listStoryPackages();
  assert.ok(packages.some(item => item.id === 'tide-path-three-days-v1'));
  assert.ok(packages.every(item => item.schema === 'deskbot.story-package.v0.1'));
});
