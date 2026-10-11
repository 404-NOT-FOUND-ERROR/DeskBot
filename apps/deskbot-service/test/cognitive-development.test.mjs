import test from 'node:test';
import assert from 'node:assert/strict';
import {developmentFixture,formedCareFixture,policyChoice,arrange,atDay,OWNER} from '../../../services/deskbot-cognition/evaluations/development-fixtures.mjs';
import {cognitiveDevelopmentContext,cognitiveOpportunityWindow,cognitiveDevelopmentDiagnostics} from '../src/cognitive-development.mjs';
import {developmentFacetsReadModel} from '../src/development-facets.mjs';
import {syncDevelopmentEvidence} from '../src/development-evidence.mjs';
import {syncLifeRhythm} from '../src/life-rhythm.mjs';
import {startPracticalTrial,practicalTrialReadModel,controlPracticalTrial} from '../src/role-practical-trials.mjs';
import {roleStagePreview,acceptRoleStage,rollbackRoleStage} from '../src/role-stages.mjs';
import {applyCognitiveMutation,cognitiveRelevantKey,cognitiveActualResult} from '../src/cognitive-life-state.mjs';
import {settle} from '../../../services/deskbot-cognition/evaluations/development-fixtures.mjs';
const facet=(w,topic='care')=>developmentFacetsReadModel(w,{actorId:OWNER,at:w.clock.synced_at}).actors[0].topics.find(t=>t.topic===topic);
const rhythm=w=>w.memory.development.rhythm.actors[OWNER].topics.care;
test('interrupted personal goal is source checked separately from actual world result',()=>{
 const w=developmentFixture(),at=w.clock.synced_at,goal={id:'my-goal',text:'去看看水边',status:'active'};
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:'goal-plan'},at,'claim');
 const planned=applyCognitiveMutation(w,{actor_id:OWNER,operation:'plan',job_id:'goal-plan',relevant_key:cognitiveRelevantKey(w,OWNER),proposal:{schema:'deskbot.cognitive-life.proposal.v3',actor_id:OWNER,phase:'plan',state:{short_term_goal_entities:[goal]},action:{action_description:'观察'},compiled:{operation:'observe',object_index:1,reason:'先看现场'}}},at,'plan');
 settle(w,w.tasks.find(t=>t.task_id===planned.task_id));const result=cognitiveActualResult(w,OWNER,w.clock.synced_at);
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'feedback',job_id:'goal-feedback'},w.clock.synced_at,'feedback-claim');
 const raw=`短期目标被中断，尚未完成：${goal.text}`,proposal={schema:'deskbot.cognitive-life.proposal.v3',actor_id:OWNER,phase:'feedback',state:{short_term_goal_entities:[{...goal,status:'interrupted'}]},followup:{status:'postpone',question:'留待以后',reason:'改变安排',delay_hours:2},memories:[{id:'goal-memory',payload:{agent_id:OWNER,stream:'factual',kind:'event',raw_content:raw,stored_content:raw}}]};
 const payload={actor_id:OWNER,operation:'feedback',job_id:'goal-feedback',result,proposal};
 const bad=structuredClone(payload);bad.proposal.state.short_term_goal_entities[0].id='someone-else';assert.throws(()=>applyCognitiveMutation(structuredClone(w),bad,w.clock.synced_at,'bad'),{code:'cognitive_factual_record_changed'});
 applyCognitiveMutation(w,payload,w.clock.synced_at,'feedback');assert.equal(w.cognition.actors[OWNER].memories[0].epistemic,'personal_goal_transition');assert.equal(w.cognition.actors[OWNER].last_result.root_outcome_id,result.root_outcome_id);
});
function window(w,n,{free=true,topics=['care','explore']}={}){w.memory.development.cognitive_windows[OWNER].push({id:`window:${n}`,at:atDay(n),free,topics,alternatives:['water-bed','observe-local']});w.clock.synced_at=atDay(n);syncLifeRhythm(w,atDay(n));}

test('first exploration needs free time; independent returns across real tasks form interest without duplicate skill',()=>{
 const w=formedCareFixture(),f=facet(w);
 assert.equal(f.interest.status,'continuing');assert.equal(f.interest.exploration_roots.length,1);assert.equal(f.interest.active_roots.length,3);
 assert.equal(f.capability.success_roots.length,4);assert.equal(w.memory.development.records.length,4);
 const ctx=cognitiveDevelopmentContext(w,OWNER,w.clock.synced_at);assert.ok(ctx.wish_options.find(d=>d.direction_id==='wetland_frog').eligible);
 assert.equal(w.cognition.actors[OWNER].role_wish_choice,undefined);assert.equal(w.role_stages,undefined);
 const roots=structuredClone(f);syncDevelopmentEvidence(w,w.clock.synced_at);assert.deepEqual(facet(w),roots);
});
test('dense invitations build experience, not autonomous interest',()=>{
 const w=developmentFixture();
 w.cognition.actors[OWNER].inbox=[{message_id:'invite',sender_id:'wetland-grower-001',sender_name:'苔芽',text:'请帮忙照料苗床',at:atDay(0)}];
 for(let n=0;n<4;n++){arrange(w,atDay(n));policyChoice(w,{operation:'activity',activity_id:'tend-bed',motivation:'invited',source_ids:['invite']});}
 assert.equal(facet(w).interest.status,'unobserved');assert.equal(facet(w).interest.invited_roots.length,4);assert.equal(facet(w).capability.success_roots.length,4);
 assert.equal(cognitiveDevelopmentContext(w,OWNER,w.clock.synced_at).wish_options.find(d=>d.direction_id==='wetland_frog').eligible,false);
});
test('six-hour waiting diagnosis needs actual contiguous free observations, excludes offline gaps',()=>{
 const w=developmentFixture(),rows=Array.from({length:7},(_,i)=>({at:new Date(Date.parse(atDay(0))+i*3600000).toISOString(),free:true,topics:['care'],alternatives:['tend-bed','observe-local'],selected:{operation:'wait'}}));
 w.memory.development.cognitive_windows={[OWNER]:rows};assert.ok(cognitiveDevelopmentDiagnostics(w,OWNER,rows.at(-1).at).six_hour_wait);
 w.memory.development.cognitive_windows[OWNER]=[rows[0],rows[6]];assert.equal(cognitiveDevelopmentDiagnostics(w,OWNER,rows.at(-1).at).six_hour_wait,null);
 w.memory.development.cognitive_windows[OWNER]=rows.map(r=>({...r,free:false}));assert.equal(cognitiveDevelopmentDiagnostics(w,OWNER,rows.at(-1).at).six_hour_wait,null);
});
test('unrelated preceding activity cannot bootstrap self continuation in a new topic',()=>{
 const w=developmentFixture();const a=policyChoice(w,{operation:'activity',activity_id:'tend-bed',motivation:'self_exploration'});
 const b=policyChoice(w,{operation:'observe',object_index:1,motivation:'self_continuation',prior_root_id:`task:${a.task_id}`});
 assert.equal(b.life_motivation.kind,'self_exploration');assert.equal(facet(w,'explore').interest.active_roots.length,0);
});
test('offline time and unavailable resources preserve formation; seven actual free days can park it',()=>{
 const w=formedCareFixture(),formed=rhythm(w).formed_at,roots=facet(w).interest.active_roots;
 window(w,25,{free:false,topics:[]});assert.equal(rhythm(w).status,'held');assert.equal(rhythm(w).opportunity_basis.effective_days.length,0);
 assert.equal(rhythm(w).formed_at,formed);assert.deepEqual(facet(w).interest.active_roots,roots);
 for(let n=26;n<=32;n++)window(w,n);
 assert.equal(rhythm(w).status,'parked');assert.equal(rhythm(w).opportunity_basis.effective_days.length,7);
 w.cognition.actors[OWNER].interpretations=[{source_id:'new-weather-question',interpreted_at:atDay(32),source_category:'agent',stance:'affirmed',effect:'inquiry',target_object_ids:['garden-bed'],expires_at:atDay(34)}];
 syncDevelopmentEvidence(w,atDay(32));assert.equal(rhythm(w).status,'reawakened');assert.equal(w.memory.development.records.length,4);
 const n=w.memory.development.contacts.length;syncDevelopmentEvidence(w,atDay(32));assert.equal(w.memory.development.contacts.length,n);
 w.cognition.actors[OWNER].interpretations.push({source_id:'negation',interpreted_at:atDay(32),source_category:'user',stance:'negated',effect:'none',target_object_ids:['garden-bed']});
 syncDevelopmentEvidence(w,atDay(32));assert.equal(w.memory.development.contacts.length,n);
});
test('unsupported wish is rejected before task admission; chosen pause or revisit creates no result',()=>{
 const fresh=developmentFixture(),before=fresh.tasks.length;
 assert.throws(()=>policyChoice(fresh,{operation:'activity',activity_id:'tend-bed',wish_choice:{direction_id:'wetland_frog',decision:'propose',reason:'凭空想变'}}),{code:'role_wish_not_ready'});
 assert.equal(fresh.tasks.length,before);
 const w=formedCareFixture(),root=facet(w).interest.active_roots[0],count=w.tasks.length;
 for(const [decision,status]of [['pause','held'],['drop','parked'],['revisit','reawakened']]){
  policyChoice(w,{operation:'wait',interest_choice:{topic:'care',decision,reason:'想换个节奏再看',root_ids:[root]}});syncLifeRhythm(w,w.clock.synced_at);assert.equal(rhythm(w).status,status);
 }
 assert.equal(w.tasks.length,count);assert.equal(w.memory.development.records.length,4);
 policyChoice(w,{operation:'wait',wish_choice:{direction_id:'wetland_frog',decision:'propose',reason:'三日照料后想试试水边生活'}});
 assert.equal(w.cognition.actors[OWNER].role_wish_choice.decision,'propose');assert.equal(w.role_stages,undefined);
});
test('cognitive primary tasks join the existing cross-day trial and reversible adoption',()=>{
 const w=formedCareFixture(),basis={root_outcome_ids:facet(w).interest.active_roots};
 arrange(w,atDay(4));const proposal={origin:'lived_wish',status:'prepared',user_choice:'try',proposal_id:'cognitive-wish',character_id:OWNER,direction_id:'wetland_frog',axis:'form',wish_basis:basis};
 const trial=startPracticalTrial(w,{proposalId:proposal.proposal_id,actorId:OWNER,directionId:proposal.direction_id,wishBasis:basis,at:w.clock.synced_at,eventId:'try'});
 for(let n=4;n<=5;n++){arrange(w,atDay(n));const task=policyChoice(w,{operation:'activity',activity_id:'tend-bed',motivation:'self_continuation',prior_root_id:basis.root_outcome_ids[0]});assert.equal(task.role_trial?.trial_id,trial.trial_id);}
 const view=practicalTrialReadModel(w,{proposalId:proposal.proposal_id});assert.equal(view.progress.successful_primary,2);assert.equal(view.review.ready,true);
 const preview=roleStagePreview(w,{proposal,at:w.clock.synced_at});assert.equal(preview.eligible,true);
 const saved=structuredClone(w.memory),identity=w.protagonist.character_id;
 const adopted=acceptRoleStage(w,{proposalId:proposal.proposal_id,actorId:OWNER,directionId:proposal.direction_id,wishBasis:basis,at:w.clock.synced_at,eventId:'adopt',previewFingerprint:preview.preview_fingerprint});
 assert.equal(w.protagonist.appearance.role_stage.physical_shell_changed,false);assert.deepEqual(w.memory,saved);assert.equal(w.protagonist.character_id,identity);
 rollbackRoleStage(w,{stageId:adopted.stage_id,actorId:OWNER,at:w.clock.synced_at,eventId:'rollback'});assert.deepEqual(w.memory,saved);
});
test('pausing a trial prevents cognitive task from being counted as a trial attempt',()=>{
 const w=formedCareFixture(),basis={root_outcome_ids:facet(w).interest.active_roots};arrange(w,atDay(4));
 const trial=startPracticalTrial(w,{proposalId:'paused',actorId:OWNER,directionId:'wetland_frog',wishBasis:basis,at:w.clock.synced_at,eventId:'start'});
 controlPracticalTrial(w,{trialId:trial.trial_id,operation:'pause',at:w.clock.synced_at,eventId:'pause'});
 const task=policyChoice(w,{operation:'activity',activity_id:'tend-bed',motivation:'self_continuation',prior_root_id:basis.root_outcome_ids[0]});assert.equal(task.role_trial,undefined);
 assert.equal(practicalTrialReadModel(w,{proposalId:'paused'}).progress.successful_primary,0);
});
