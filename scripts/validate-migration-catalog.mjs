import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CATALOG_PATH = path.join(ROOT, 'documentation', 'asamana-migration-catalog-v1.json');

const REQUIRED_ITEM_FIELDS = [
  'item_id', 'phase', 'wave', 'deskbot_modules', 'authority_writer', 'contracts',
  'dependencies', 'risk', 'owner', 'status', 'required_gates', 'evidence_refs',
  'last_verified_at', 'base_commit', 'known_gaps',
];

function fail(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  throw error;
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') fail(`catalog_invalid_${field}`);
}

export function validateMigrationCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) fail('catalog_invalid_root');
  if (catalog.schema !== 'deskbot.asamana-migration-catalog.v1') fail('catalog_schema_mismatch');
  nonEmptyString(catalog.catalog_version, 'catalog_version');
  if (!catalog.release || typeof catalog.release !== 'object') fail('catalog_release_missing');
  nonEmptyString(catalog.release.branch, 'release_branch');
  nonEmptyString(catalog.release.base_commit, 'release_base_commit');
  if (!catalog.lifecycle || typeof catalog.lifecycle !== 'object') fail('catalog_lifecycle_missing');
  const primary = new Set(Array.isArray(catalog.lifecycle.primary) ? catalog.lifecycle.primary : []);
  const side = new Set(Array.isArray(catalog.lifecycle.side_status) ? catalog.lifecycle.side_status : []);
  if (!primary.size || !side.size) fail('catalog_lifecycle_statuses_missing');
  const statuses = new Set([...primary, ...side]);
  if (!Array.isArray(catalog.lifecycle.evidence_stale_when) || !catalog.lifecycle.evidence_stale_when.length) {
    fail('catalog_stale_rules_missing');
  }
  if (!catalog.gates || typeof catalog.gates !== 'object') fail('catalog_gates_missing');
  const gateIds = new Set(Object.keys(catalog.gates));
  if (!gateIds.size) fail('catalog_gates_empty');
  if (!catalog.gate_crosswalk || typeof catalog.gate_crosswalk !== 'object') fail('catalog_gate_crosswalk_missing');
  for (const [stage, gates] of Object.entries(catalog.gate_crosswalk)) {
    if (!Array.isArray(gates) || !gates.length) fail('catalog_crosswalk_empty', { stage });
    for (const gate of gates) if (!gateIds.has(gate)) fail('catalog_crosswalk_unknown_gate', { stage, gate });
  }
  if (!Array.isArray(catalog.evidence_record_required) || !catalog.evidence_record_required.length) {
    fail('catalog_evidence_contract_missing');
  }
  if (!Array.isArray(catalog.items) || !catalog.items.length) fail('catalog_items_empty');
  const ids = new Set();
  for (const item of catalog.items) {
    if (!item || typeof item !== 'object') fail('catalog_item_invalid');
    for (const field of REQUIRED_ITEM_FIELDS) if (!(field in item)) fail('catalog_item_field_missing', { field });
    nonEmptyString(item.item_id, 'item_id');
    if (ids.has(item.item_id)) fail('catalog_duplicate_item_id', { item_id: item.item_id });
    ids.add(item.item_id);
    nonEmptyString(item.authority_writer, 'authority_writer');
    if (!statuses.has(item.status)) fail('catalog_unknown_item_status', { item_id: item.item_id, status: item.status });
    if (!Array.isArray(item.required_gates) || !item.required_gates.length) fail('catalog_item_gates_missing', { item_id: item.item_id });
    for (const gate of item.required_gates) if (!gateIds.has(gate)) fail('catalog_item_unknown_gate', { item_id: item.item_id, gate });
    if (!Array.isArray(item.dependencies)) fail('catalog_item_dependencies_invalid', { item_id: item.item_id });
    if (!Array.isArray(item.evidence_refs)) fail('catalog_item_evidence_refs_invalid', { item_id: item.item_id });
    if (!Array.isArray(item.known_gaps)) fail('catalog_item_known_gaps_invalid', { item_id: item.item_id });
    if (item.status === 'automated_verified' || item.status === 'accepted') {
      if (!item.evidence_refs.length) fail('catalog_verified_item_without_evidence', { item_id: item.item_id });
      if (!item.last_verified_at) fail('catalog_verified_item_without_timestamp', { item_id: item.item_id });
    }
  }
  for (const item of catalog.items) {
    for (const dependency of item.dependencies) {
      if (!ids.has(dependency)) fail('catalog_dangling_dependency', { item_id: item.item_id, dependency });
    }
  }
  return Object.freeze({ item_count: catalog.items.length, gate_count: gateIds.size, item_ids: [...ids] });
}

export function readMigrationCatalog(filePath = DEFAULT_CATALOG_PATH) {
  const resolved = path.resolve(filePath);
  const catalog = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  return { catalog, summary: validateMigrationCatalog(catalog), path: resolved };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CATALOG_PATH;
  const { summary, path: resolved } = readMigrationCatalog(filePath);
  console.log(JSON.stringify({ schema: 'deskbot.asamana-migration-catalog.v1', path: resolved, ...summary }));
}
