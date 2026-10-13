import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationCatalog, validateMigrationCatalog } from '../../../scripts/validate-migration-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('migration catalog is machine-valid and dependencies resolve', () => {
  const { summary } = readMigrationCatalog();
  assert.equal(summary.item_count, 18);
  assert.ok(summary.gate_count >= 8);
  assert.equal(new Set(summary.item_ids).size, summary.item_count);
});

test('migration catalog rejects duplicate items, dangling dependencies and unknown gates', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'documentation', 'asamana-migration-catalog-v1.json'), 'utf8'));
  const duplicate = structuredClone(catalog);
  duplicate.items.push(structuredClone(duplicate.items[0]));
  assert.throws(() => validateMigrationCatalog(duplicate), /catalog_duplicate_item_id/);

  const dangling = structuredClone(catalog);
  dangling.items[0].dependencies = ['missing-item'];
  assert.throws(() => validateMigrationCatalog(dangling), /catalog_dangling_dependency/);

  const unknownGate = structuredClone(catalog);
  unknownGate.items[0].required_gates = ['G99'];
  assert.throws(() => validateMigrationCatalog(unknownGate), /catalog_item_unknown_gate/);
});

test('verified migration items must carry evidence and freshness metadata', () => {
  const { catalog } = readMigrationCatalog();
  const missingEvidence = structuredClone(catalog);
  const item = missingEvidence.items.find((entry) => entry.status === 'automated_verified');
  item.evidence_refs = [];
  assert.throws(() => validateMigrationCatalog(missingEvidence), /catalog_verified_item_without_evidence/);

  const missingTimestamp = structuredClone(catalog);
  const timestamped = missingTimestamp.items.find((entry) => entry.status === 'automated_verified');
  timestamped.last_verified_at = null;
  assert.throws(() => validateMigrationCatalog(missingTimestamp), /catalog_verified_item_without_timestamp/);
});
