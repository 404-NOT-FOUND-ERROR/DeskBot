import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEvidenceLedger } from '../src/evidence-ledger.mjs';
import { createWorldContext } from '../src/world-context.mjs';

const fixedTime = new Date('2026-08-21T00:00:00.000Z');

test('evidence ledger separates candidate inputs from audit-only assistant output', () => {
  const ledger = createEvidenceLedger({ now: () => fixedTime });
  const user = ledger.record({
    event: {
      event_id: 'evt-user-001',
      type: 'conversation.input',
      source: 'deskbot-web',
      character_id: 'ember-001',
      occurred_at: fixedTime.toISOString(),
    },
    analysis: { analyzer: 'lexicon-v0.1', label: 'sadness', valence: -0.8, arousal: 0.25, confidence: 0.9, cues: ['累'] },
  });
  const reply = ledger.record({
    event: {
      event_id: 'evt-reply-001',
      type: 'conversation.reply',
      source: 'deskbot-llm',
      character_id: 'ember-001',
      occurred_at: fixedTime.toISOString(),
    },
  });

  assert.equal(user.evidence.eligibility.status, 'candidate');
  assert.equal(user.evidence.analysis.label, 'sadness');
  assert.equal(reply.evidence.eligibility.status, 'audit_only');
  assert.equal(reply.evidence.eligibility.weight_hint, 0);
  assert.equal(ledger.list({ characterId: 'ember-001' }).length, 2);
});

test('world context records rule provenance, priority, and expiry', () => {
  let clock = fixedTime;
  const context = createWorldContext({ now: () => clock });
  const matched = context.observe({
    event_id: 'evt-late-night',
    type: 'world.time',
    source: 'clock',
    character_id: 'ember-001',
    occurred_at: fixedTime.toISOString(),
    payload: { local_hour: 23 },
  });

  assert.equal(matched.length, 1);
  assert.equal(matched[0].rule_version, 'world-rules.v0.2');
  assert.equal(matched[0].rule_source, 'deskbot-world-rules');
  assert.equal(context.active('ember-001')[0].label, 'late-night');
  assert.equal(context.matches({ characterId: 'ember-001' }).length, 1);

  clock = new Date(fixedTime.getTime() + 9 * 60 * 60 * 1000);
  assert.deepEqual(context.active('ember-001'), []);
  assert.equal(context.matches({ characterId: 'ember-001' }).length, 1);
});
