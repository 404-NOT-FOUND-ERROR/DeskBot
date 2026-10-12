import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { roleStageExperience, roleStagesReadModel, roleStageAppearance, roleStageLifeProfile, roleStageCandidates } from '../src/role-stages.mjs';
import { getRoleExperiencePackage, resolveStageRoleExperience } from '../src/role-experience-packages.mjs';
import { modelRoleStageContext, modelRoleExperienceContext } from '../src/prompt-composer.mjs';
import { roleStageHttpFixture } from './support/role-stage-http-fixture.mjs';

const OWNER = 'shaping-001';

async function adoptFrog(t, eventId) {
  const h = await roleStageHttpFixture(t);
  const { proposal } = await h.actualReview('wetland_frog');
  const preview = await h.preview(proposal.proposal_id);
  const accepted = await h.stageAction(proposal.proposal_id, 'accept', { event_id: eventId,
    preview_fingerprint: preview.preview_fingerprint });
  assert.equal(accepted.status, 202, JSON.stringify(accepted));
  return { h, proposal, preview, accepted };
}

const stableStringify = value => Array.isArray(value) ? `[${value.map(stableStringify).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const packageHash = value => createHash('sha256').update(stableStringify(value)).digest('hex');

test('accepted role stage freezes the normalized experience package and exposes its binding', async t => {
  const { h, accepted } = await adoptFrog(t, 'freeze-frog-stage');

  const raw = h.world.get().role_stages.actors[OWNER].versions[0];
  assert.equal(raw.experience_freeze.schema, 'deskbot.role-stage-experience-freeze.v1');
  assert.equal(raw.experience_freeze.direction_id, 'wetland_frog');
  assert.equal(raw.experience_freeze.package_id, 'wetland-frog-v1');
  assert.match(raw.experience_freeze.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(raw.experience_freeze.package.expression.tts.profile_id, 'miaowu-lively-v1');

  const current = accepted.body.role_stages.current.form;
  assert.equal(current.experience.source, 'frozen');
  assert.equal(current.experience.package.package_id, 'wetland-frog-v1');
  assert.equal(current.asset_binding.content_hash, raw.experience_freeze.content_hash);
  assert.equal(roleStageExperience(raw).package_id, 'wetland-frog-v1');
  assert.equal(resolveStageRoleExperience(current).package_id, 'wetland-frog-v1');
  const detached = roleStageExperience(raw);
  detached.appearance.accessories.push('outside-change');
  assert.equal(roleStageExperience(raw).appearance.accessories.includes('outside-change'), false);
});

test('a historical frozen package remains authoritative for appearance, expression, TTS and life preferences', async t => {
  const { h } = await adoptFrog(t, 'freeze-before-package-upgrade');
  const before = h.world.get();
  const original = { appearance: roleStageAppearance(before, OWNER), stages: roleStagesReadModel(before),
    profile: roleStageLifeProfile(before, OWNER, { interests: [], places: [] }),
    expression: modelRoleStageContext(before), experience: modelRoleExperienceContext({ worldSnapshot: before }) };
  const originalCandidates = roleStageCandidates(before, { ...before.autonomy.actors[OWNER], energy: .9, appetite: .1 }, h.now().toISOString());
  assert.ok(originalCandidates.some(c => c.steps.some(step => step.activity_id === 'tend-bed')));

  const historical = getRoleExperiencePackage('wetland_frog');
  historical.version = 'historical-v0';
  historical.appearance.figure_form = 'historical-leaf-frog';
  historical.appearance.accessories = ['historical-collar'];
  historical.expression.catchphrases = ['这句来自旧的生活阶段'];
  historical.expression.tts.profile_id = 'historical-voice';
  historical.life.interests = ['historical-care'];
  historical.life.places = ['historical-waterside'];
  historical.life.activity = 'tend-bed';
  const historicalStage = structuredClone(before.role_stages.actors[OWNER].versions[0]);
  historicalStage.experience_freeze.package = historical;
  historicalStage.experience_freeze.package_id = historical.package_id;
  historicalStage.experience_freeze.package_version = historical.version;
  historicalStage.experience_freeze.content_hash = packageHash(historical);
  const historicalWorld = structuredClone(before);
  historicalWorld.role_stages.actors[OWNER].versions[0] = historicalStage;
  const historicalViews = { appearance: roleStageAppearance(historicalWorld, OWNER), stages: roleStagesReadModel(historicalWorld),
    profile: roleStageLifeProfile(historicalWorld, OWNER, { interests: [], places: [] }),
    expression: modelRoleStageContext(historicalWorld), experience: modelRoleExperienceContext({ worldSnapshot: historicalWorld }) };
  assert.equal(historicalViews.appearance.form.figure_form, 'historical-leaf-frog');
  assert.deepEqual(historicalViews.appearance.form.accessories, ['historical-collar']);
  assert.equal(historicalViews.appearance.form.package_version, 'historical-v0');
  assert.equal(historicalViews.expression[0].catchphrases[0], '这句来自旧的生活阶段');
  assert.equal(historicalViews.experience.current[0].package_id, 'wetland-frog-v1');
  assert.deepEqual(historicalViews.profile.interests, ['historical-care']);
  assert.deepEqual(historicalViews.profile.places, ['historical-waterside']);
  const historicalCandidates = roleStageCandidates(historicalWorld, { ...before.autonomy.actors[OWNER], energy: .9, appetite: .1 }, h.now().toISOString());
  const expectedHistoricalCandidates = structuredClone(originalCandidates);
  expectedHistoricalCandidates[0].development_topic = 'historical-care';
  assert.deepEqual(historicalCandidates, expectedHistoricalCandidates);
  assert.equal(roleStageExperience(historicalStage).expression.tts.profile_id, 'historical-voice');
});

test('different frozen package contents carry different deterministic asset hashes', () => {
  const first = getRoleExperiencePackage('wetland_frog');
  const second = structuredClone(first);
  second.appearance.accessories = ['alternate-collar'];
  const firstStage = { direction_id: 'wetland_frog', experience_freeze: { schema: 'deskbot.role-stage-experience-freeze.v1', direction_id: 'wetland_frog', package_id: first.package_id, package_version: first.version, content_hash: packageHash(first), package: first } };
  const secondStage = { direction_id: 'wetland_frog', experience_freeze: { schema: 'deskbot.role-stage-experience-freeze.v1', direction_id: 'wetland_frog', package_id: second.package_id, package_version: second.version, content_hash: packageHash(second), package: second } };
  assert.notEqual(firstStage.experience_freeze.content_hash, secondStage.experience_freeze.content_hash);
  assert.deepEqual(roleStageExperience(firstStage).appearance.accessories, first.appearance.accessories);
  assert.deepEqual(roleStageExperience(secondStage).appearance.accessories, ['alternate-collar']);
});

test('legacy stages are explicitly marked as fallback and are never backfilled by reading', () => {
  const stage = { schema: 'deskbot.role-stage.v1', stage_id: 'legacy-stage', proposal_id: 'old-proposal', trial_id: 'old-trial',
    actor_id: OWNER, direction_id: 'wetland_frog', axis: 'form', status: 'accepted', primary_root_ids: [], primary_days: [], frozen_wish_root_ids: [] };
  const world = { protagonist: { character_id: OWNER }, role_stages: { actors: { [OWNER]: {
    axis_current: { form: stage.stage_id, vocation: null }, versions: [stage] } } } };
  const before = structuredClone(world);
  const projection = roleStagesReadModel(world);
  assert.equal(projection.current.form.asset_binding.source, 'legacy_fallback');
  assert.equal(projection.appearance.form.experience_source, 'legacy_fallback');
  assert.equal(projection.current.form.experience.package.package_id, 'wetland-frog-v1');
  assert.deepEqual(world, before);
  assert.equal(world.role_stages.actors[OWNER].versions[0].experience_freeze, undefined);
});

test('tampered freeze never silently falls back to the current authored package', () => {
  const legacy = { direction_id: 'explorer' };
  assert.equal(roleStageExperience(legacy).package_id, 'explorer-v1');

  const tampered = {
    direction_id: 'explorer',
    experience_freeze: {
      schema: 'deskbot.role-stage-experience-freeze.v1',
      direction_id: 'explorer',
      package_id: 'explorer-v1',
      package_version: 'v1',
      content_hash: '0'.repeat(64),
      package: { schema: 'deskbot.role-experience-package.v1', package_id: 'explorer-v1', version: 'v1', direction_id: 'explorer' },
    },
  };
  assert.equal(roleStageExperience(tampered), null);
  assert.equal(resolveStageRoleExperience(tampered), null);
});
