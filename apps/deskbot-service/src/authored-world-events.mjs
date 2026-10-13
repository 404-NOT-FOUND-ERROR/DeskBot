import { createHash } from 'node:crypto';

import { loadMorrowmereContent } from './content-packages.mjs';

const RULE_VERSION = 'authored-world-events.v1';

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(stable(value)).digest('hex'); }

function searchableObservation(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  return [payload.text, payload.title, payload.summary, payload.item?.title, payload.item?.summary,
    payload.snapshot?.condition, payload.snapshot?.location, payload.weather?.condition, payload.weather?.location,
    ...(Array.isArray(payload.tags) ? payload.tags : [])].filter(value => typeof value === 'string').join(' ').toLowerCase();
}

function matchPackage(pack, event) {
  if (!pack.activation.observation_types.includes(event.type)) return { matched: false, reason: 'observation_type_not_allowed' };
  const confidence = typeof event.confidence === 'number' ? event.confidence : 0;
  if (confidence < pack.activation.min_confidence) return { matched: false, reason: 'confidence_below_threshold' };
  const haystack = searchableObservation(event);
  if (!pack.activation.required_any_tags.some(tag => haystack.includes(String(tag).toLowerCase()))) {
    return { matched: false, reason: 'required_tag_missing' };
  }
  return { matched: true, reason: null };
}

function eventTemplate(pack, event) {
  const template = pack.event_template;
  return {
    ...clone(template),
    // The template supplies authored content; the observation supplies only
    // traceable provenance and timing, never arbitrary world fields.
    event_id: `${pack.package_id}:${event.event_id}`,
    source: 'authored-world-event-package',
    occurred_at: event.occurred_at ?? event.observed_at ?? null,
    source_event_id: event.event_id,
    content_package_id: pack.package_id,
    content_package_version: pack.version,
  };
}

function proposedActions(pack, event) {
  const template = eventTemplate(pack, event);
  return pack.actions.map(action => {
    if (action.action === 'apply_world_line_event') return { action: action.action, payload: { event: template } };
    if (action.action === 'enqueue_pending_item') return { action: action.action, payload: { item: {
      item_id: `${pack.package_id}:${event.event_id}:item`, summary: template.opportunity ?? template.title,
      kind: 'authored-world-event', source: 'authored-world-event-package',
    } } };
    if (action.action === 'record_external_context') return { action: action.action, payload: { item: {
      item_id: `${pack.package_id}:${event.event_id}:context`, title: template.title, summary: template.summary,
      provider: 'authored-world-event-package', observed_at: event.observed_at ?? event.occurred_at,
    } } };
    return null;
  }).filter(Boolean);
}

export function createAuthoredWorldEventCatalog({ content = loadMorrowmereContent() } = {}) {
  const packages = (content.worldEvents?.packages ?? []).map(clone);
  const byId = new Map(packages.map(item => [item.package_id, item]));

  function list() {
    return packages.map(pack => ({ package_id: pack.package_id, version: pack.version, title: pack.title,
      kind: pack.kind, source: content.source, rule_version: RULE_VERSION,
      activation: clone(pack.activation), expires_after_hours: pack.expires_after_hours ?? null }));
  }
  function get(packageId) { const pack = byId.get(text(packageId)); return pack ? clone(pack) : null; }
  function evaluate(event) {
    const results = packages.map(pack => ({ package_id: pack.package_id, ...matchPackage(pack, event) }));
    return { schema: 'deskbot.authored-world-event-evaluation.v1', rule_version: RULE_VERSION,
      event_id: event?.event_id ?? null, matches: results.filter(item => item.matched), rejected: results.filter(item => !item.matched) };
  }
  function prepare(packageId, event) {
    const pack = byId.get(text(packageId));
    if (!pack) return { accepted: false, reason: 'package_not_found', candidate_event: null };
    const match = matchPackage(pack, event);
    if (!match.matched) return { accepted: false, reason: match.reason, candidate_event: null };
    const sourceEvent = { ...clone(event), provenance: { ...(event.provenance ?? {}),
      authored_package_id: pack.package_id, authored_package_version: pack.version,
      authored_rule_version: RULE_VERSION, source_event_ids: [...new Set([event.event_id, ...(event.provenance?.source_event_ids ?? [])])],
    }, payload: { ...(event.payload ?? {}), proposed_actions: proposedActions(pack, event) } };
    const candidateKey = hash({ package_id: pack.package_id, source_event_id: event.event_id, version: pack.version });
    return { accepted: true, reason: null, candidate_key: `authored-world-event:${candidateKey.slice(0, 32)}`,
      package: { package_id: pack.package_id, version: pack.version, title: pack.title }, candidate_event: sourceEvent,
      expires_after_hours: pack.expires_after_hours ?? 48 };
  }
  return { evaluate, get, list, prepare, ruleVersion: RULE_VERSION };
}

export const AUTHORED_WORLD_EVENT_RULE_VERSION = RULE_VERSION;
