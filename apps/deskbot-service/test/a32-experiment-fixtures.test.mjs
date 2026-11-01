import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {goalCases,goalFixture,goalSnapshot,restartGoalWorld,goalCoverage} from '../../../services/deskbot-cognition/evaluations/a32-goal-fixtures.mjs';
import {experimentSources,experimentVersion} from '../../../services/deskbot-cognition/evaluations/experiment-freeze.mjs';
import {fixture,cases,OWNER,hash,tick,opportunity} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext} from '../src/cognitive-life-state.mjs';
const seed=id=>goalFixture(goalCases.find(c=>c.id===id));
const context=w=>cognitiveContext(w,OWNER,w.clock.synced_at);

test('goal fixtures are deterministic and leave the original four fixtures unchanged',()=>{
 const originals=cases.filter(c=>['resources-1-off','resources-1-on','invitation-3-off','invitation-3-on'].includes(c.id));
 const before=originals.map(c=>hash(fixture(c)));
 for(const c of goalCases)assert.equal(hash(goalFixture(c)),hash(goalFixture(c)));
 assert.deepEqual(originals.map(c=>hash(fixture(c))),before);
 const w=seed('G1-formation');assert.deepEqual(goalSnapshot(w).goals,[]);
 assert.equal(opportunity(w,OWNER).strict_two,true);
 assert.equal(w.living.inventories[OWNER].stock.water??0,0);
 assert.ok(context(w).capabilities.activities.some(a=>a.activity_id==='collect-water'&&a.available));
});
test('G2 clock blocks the seeded lamp method, while the same reserve criterion has a real alternative',()=>{
 const w=seed('G2-change-method'),c=context(w),g=c.goal_lifecycle.goals[0];
 const lamp=c.capabilities.activities.find(a=>a.activity_id==='waylight-use');
 assert.equal(lamp.available,false);
 assert.ok(c.capabilities.activities.find(a=>a.activity_id==='collect-water').available);
 const alternative=c.opportunities.entries.find(e=>e.binding.activity_id==='collect-water'&&e.binding.production_use?.kind==='reserve');
 assert.equal(c.goal_lifecycle.criteria.find(k=>k.opportunity_ids.includes(alternative.id)).id,g.completion_criteria.id);
 assert.equal(g.lifecycle_status,'active');assert.deepEqual(g.evidence_ids,[]);
});
test('G3 persists the complete world through real SQLite close/reopen; overnight never invents a transition',t=>{
 const w=seed('G3-overnight'),before=goalSnapshot(w).goals[0],dir=mkdtempSync(join(tmpdir(),'deskbot-a32-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const result=restartGoalWorld(w,join(dir,'world.sqlite'));
 assert.deepEqual(result.world,w);assert.equal(result.proof.before_hash,result.proof.after_hash);
 tick(result.world,'2026-10-21T01:00:00.000Z');
 const after=goalSnapshot(result.world).goals[0];
 assert.equal(after.goal_id,before.goal_id);assert.deepEqual(after.completion_criteria,before.completion_criteria);
 assert.equal(after.lifecycle_status,'active');assert.equal(after.next_review_at,before.next_review_at);
 assert.equal(after.review_due,true);assert.deepEqual(after.evidence_ids,[]);
});
test('G4 measures through the finite executor without completing or answering an open inquiry',()=>{
 const w=seed('G4-open-inquiry'),task=w.tasks.find(t=>t.task_id==='fixture-inquiry-measure');
 assert.equal(task.status,'completed');assert.ok(task.completion.result.method_result);
 const g=goalSnapshot(w).goals[0];
 assert.equal(g.completion_criteria.kind,'open_inquiry');assert.equal(g.completion_status,'open');assert.deepEqual(g.evidence_ids,[]);
});
test('coverage cannot count seeded setup or an empty run as spontaneous goal success',()=>{
 for(const c of goalCases){const w=goalFixture(c),initial=goalSnapshot(w);
  const episode={initial_goals:initial,turns:[{turn:1,goals_before:initial,goals_after:initial}]};
  assert.equal(goalCoverage(c,episode).covered,false);
 }
});
test('freeze includes protocol, executor, vendor and content dependencies, excludes private configuration, fingerprints settings',()=>{
 const base=fileURLToPath(new URL('../../../',import.meta.url)),sources=experimentSources(base);
 for(const path of ['contracts/cognitive-followup-intent.v1.json','contracts/cognitive-evidence-refs.v1.json',
  'services/deskbot-cognition/followup_intent.py','services/deskbot-cognition/evidence_refs.py',
  'apps/deskbot-service/src/persistence.mjs','world-content/companion-world/map.v1.json'])assert.ok(sources[path],path);
 assert.ok(Object.keys(sources).some(p=>p.startsWith('services/deskbot-cognition/vendor/asamana/')));
 assert.ok(Object.keys(sources).every(p=>!p.startsWith('config/')&&!p.startsWith('data/')));
 const v=experimentVersion(sources,{family:'original',turns:5});
 assert.notEqual(v,experimentVersion(sources,{family:'goals',turns:5}));
 assert.notEqual(v,experimentVersion({...sources,'contracts/cognitive-evidence-refs.v1.json':'changed'},{family:'original',turns:5}));
});
