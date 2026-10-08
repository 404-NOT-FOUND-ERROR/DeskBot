import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_EXPERIENCE_PACKAGE_SCHEMA,
  getRoleExperiencePackage,
  listRoleExperiencePackages,
  validateRoleExperiencePackage,
  composeRoleExperiencePackages,
  roleExperienceContext,
} from '../src/role-experience-packages.mjs';

test('built-in role experience packages satisfy the versioned contract', () => {
  const packages = listRoleExperiencePackages();
  assert.ok(packages.length >= 6);
  for (const item of packages) {
    assert.equal(item.schema, ROLE_EXPERIENCE_PACKAGE_SCHEMA);
    assert.equal(validateRoleExperiencePackage(item).valid, true);
    assert.ok(item.identity.label);
    assert.ok(item.expression.catchphrases.length >= 1);
  }
});

test('package lookup accepts direction id and package id without sharing mutable state', () => {
  const frog = getRoleExperiencePackage('wetland_frog');
  const byPackage = getRoleExperiencePackage(frog.package_id);
  assert.deepEqual(byPackage, frog);
  frog.life.interests.push('mutated');
  assert.equal(getRoleExperiencePackage('wetland_frog').life.interests.includes('mutated'), false);
});

test('composition replaces one axis while preserving independent axes', () => {
  const composed = composeRoleExperiencePackages(['wetland_frog', 'chef']);
  assert.deepEqual(composed.packages.map(item => item.direction_id), ['wetland_frog', 'chef']);
  const replaced = composeRoleExperiencePackages(['wetland_frog', 'dream_cloud', 'chef']);
  assert.deepEqual(replaced.packages.map(item => item.direction_id), ['dream_cloud', 'chef']);
});

test('invalid and conflicting package inputs are rejected with baseline fallback', () => {
  const invalid = { schema: 'wrong', package_id: 'x' };
  const result = composeRoleExperiencePackages([invalid]);
  assert.equal(result.fallback_used, true);
  assert.equal(result.packages[0].direction_id, 'miaowu-baseline');
  assert.equal(result.rejected[0].reason, 'invalid_package');
});

test('role context is safe for prompt and UI consumers', () => {
  const context = roleExperienceContext(['wetland_frog', 'chef']);
  assert.equal(context.schema, 'deskbot.role-experience-registry.v1');
  assert.equal(context.directions[0].expression.catchphrases.length > 0, true);
  assert.equal(context.directions[1].appearance.figure_vocation, 'chef');
});

