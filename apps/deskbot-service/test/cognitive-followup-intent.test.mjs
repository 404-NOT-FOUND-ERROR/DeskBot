import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FOLLOWUP_INTENT,followupIntentContext,compileFollowupIntent,validateFollowupIntent} from '../src/cognitive-followup-intent.mjs';
import {EVIDENCE_REFS,classifyEvidence,evidenceReferences} from '../src/cognitive-evidence-refs.mjs';
import {findCognitionPython} from '../src/cognition-bridge.mjs';
import {fixture,cases,OWNER,plus} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext,applyCognitiveMutation} from '../src/cognitive-life-state.mjs';
const captured=JSON.parse(readFileSync(new URL('../../../research/experiments/a3-2026-11-01/followup-counterexample.json',import.meta.url)));
function sample(receipt=captured.receipt){
 const context={continuation:{current:{followup_id:'same-issue'},next_options:[{kind:'opportunity',id:'ask',title:'向在场朋友询问'}],wait_options:[{kind:'reply',id:'sent:message',title:'等待实际回应'}]}};
 context.followup_intent=followupIntentContext(context,{root_outcome_id:'task:actual',success:true,effects:{communication:receipt}});
 return context;
}
const raw=c=>({status:'continue',basis_ids:c.followup_intent.bases.map(b=>b.id),next_step:{kind:'opportunity',id:'ask'},delay_hours:1});
test('captured A3 question cannot enter a new factual followup; creative ideas retain an explicit boundary',()=>{
 const c=sample(),choice=raw(c),refs={followup_intent:structuredClone(c.followup_intent)};
 assert.throws(()=>compileFollowupIntent(captured.original_followup,c),{code:FOLLOWUP_INTENT.error});
 assert.throws(()=>compileFollowupIntent({...choice,question:captured.original_followup.question},c),{code:FOLLOWUP_INTENT.error});
 const payload={...choice,unverified_idea:'也许湖面的光粒会记住雨声？'},value=compileFollowupIntent(payload,c);
 const proposal={followup:value,followup_binding:{contract:FOLLOWUP_INTENT.schema,actor_payload:payload}};
 assert.equal(value.reason,captured.receipt.summary);assert.match(value.question,/尚未执行/);
 const metadata=validateFollowupIntent(proposal,c,refs);assert.equal(metadata.unverified_idea.epistemic,'unverified');
 assert.ok(!JSON.stringify(value).includes('记住雨声'));
 assert.throws(()=>validateFollowupIntent({...proposal,followup:captured.original_followup},c,refs),{code:FOLLOWUP_INTENT.binding_error});
 assert.throws(()=>validateFollowupIntent({followup:value},c,refs),{code:FOLLOWUP_INTENT.binding_error});
 assert.equal(validateFollowupIntent({followup:captured.original_followup},c,{}),null,'old frozen jobs retain their original contract');
});
test('unanswered, declined and actual non-message results preserve intention without inventing a communication effect',()=>{
 for(const receipt of [captured.receipt,{...captured.receipt,delivered:false,summary:'本次留言未送达；没有交付物品或建立承诺。'},null]){
  const c=sample(receipt),value=compileFollowupIntent({...raw(c),next_step:null,wait_for:{kind:'reply',id:'sent:message'}},c);
  assert.match(value.question,/实际记录/);assert.equal(value.reason,receipt?.summary??FOLLOWUP_INTENT.result_labels.completed);
 }
 const c=sample(null),value=compileFollowupIntent({...raw(c),status:'drop',next_step:null,closure:{kind:'abandoned',evidence_ids:[]}},c);
 assert.match(value.followup_closure.reason,/不代表目标已经完成/);
});
test('Node/Python share field rejection and exact canonical output including the original counterexample',()=>{
 const c=sample(),a=raw(c),vectors=[a,captured.original_followup,{...a,reason:'假事实'},{...a,basis_ids:[]},
  {...a,delay_hours:true},{...a,next_step:{kind:'opportunity',id:'hidden'}},{...a,closure:false},
  {...a,followup_id:'another-issue'},{...a,unverified_idea:'🌙'.repeat(161)},
  {...a,unverified_idea:'会不会有一条会唱歌的河？'},{...a,closure:{kind:'satisfied',evidence_ids:[]}}];
 const expected=vectors.map(v=>{try{return compileFollowupIntent(v,c)}catch(e){return {error:e.code}}});
 const py=spawnSync(findCognitionPython(),['-c',`import json,sys\nfrom followup_intent import compile_intent\nd=json.load(sys.stdin); out=[]\nfor r in d['vectors']:\n try:out.append(compile_intent(r,d['context']))\n except ValueError as e:out.append({'error':str(e)})\nprint(json.dumps(out))`],{cwd:fileURLToPath(new URL('../../../services/deskbot-cognition',import.meta.url)),input:JSON.stringify({context:c,vectors}),encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
 assert.equal(py.status,0,py.stderr);assert.deepEqual(JSON.parse(py.stdout),expected);
});
test('all reference types have explicit allowed uses, bounded visibility and matching Node/Python errors',()=>{
 const entries=Object.entries(EVIDENCE_REFS.types).map(([kind,spec])=>({id:kind,kind,uses:spec.uses,status:'available'}));
 const view={schema:EVIDENCE_REFS.schema,entries:[...entries,{id:'expired',kind:'position',uses:['choice_context'],status:'stale'}]};
 const vectors=entries.flatMap(r=>[['choice_context','followup_basis','practice','accepted_obligation','idea_context'].map(use=>({ids:[r.id],use}))].flat());
 vectors.push({ids:['private-or-missing'],use:'choice_context'},{ids:['expired'],use:'choice_context'});
 const expected=vectors.map(v=>{try{return classifyEvidence(v.ids,view,v.use)}catch(e){return {error:e.code}}});
 const py=spawnSync(findCognitionPython(),['-c',`import json,sys\nfrom evidence_refs import classify_evidence\nd=json.load(sys.stdin);out=[]\nfor v in d['vectors']:\n try:out.append(classify_evidence(v['ids'],d['view'],v['use']))\n except ValueError as e:out.append({'error':str(e)})\nprint(json.dumps(out))`],{cwd:fileURLToPath(new URL('../../../services/deskbot-cognition',import.meta.url)),input:JSON.stringify({view,vectors}),encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
 assert.equal(py.status,0,py.stderr);assert.deepEqual(JSON.parse(py.stdout),expected);
 const c=sample();c.inputs=[{id:'input',epistemic:'heard'}];c.saved={last_result:{root_outcome_id:'mine',effects:{communication:captured.receipt}}};
 const projection=evidenceReferences(c);assert.ok(projection.entries.some(r=>r.kind==='receipt'));
 assert.deepEqual(classifyEvidence([captured.receipt.id],projection).own_evidence_ids,[]);
});
test('in-flight sightings retain their ID but leaving the scene or expiry removes their current authority',()=>{
 const w=fixture(cases.find(c=>c.id==='resources-1-off')),at=w.clock.synced_at;
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:'refs'},at,'refs');
 const before=cognitiveContext(w,OWNER,at),after=cognitiveContext(w,OWNER,plus(at,3));
 const id=before.evidence_refs.entries.find(r=>r.kind==='position').id;
 assert.deepEqual(classifyEvidence([id],after.evidence_refs).context_evidence_ids,[id]);
 const person=w.npcs.find(n=>before.position_knowledge.people.some(p=>p.actor_id===n.npc_id&&p.source_id===id));person.location_id='moss-sprout-garden';
 assert.throws(()=>classifyEvidence([id],cognitiveContext(w,OWNER,plus(at,4)).evidence_refs),{code:'evidence_ref_unavailable'});
});
