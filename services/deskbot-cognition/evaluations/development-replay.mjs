import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {developmentFixture,formedCareFixture,policyChoice,arrange,atDay,OWNER} from './development-fixtures.mjs';
import {syncDevelopmentEvidence} from '../../../apps/deskbot-service/src/development-evidence.mjs';
import {developmentFacetsReadModel} from '../../../apps/deskbot-service/src/development-facets.mjs';
import {cognitiveDevelopmentContext} from '../../../apps/deskbot-service/src/cognitive-development.mjs';
import {syncLifeRhythm} from '../../../apps/deskbot-service/src/life-rhythm.mjs';
import {startPracticalTrial,practicalTrialReadModel} from '../../../apps/deskbot-service/src/role-practical-trials.mjs';
import {roleStagePreview,acceptRoleStage,rollbackRoleStage} from '../../../apps/deskbot-service/src/role-stages.mjs';
const output=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??'runtime/asamana-deployment/stage5');mkdirSync(output,{recursive:true});
const report={schema:'deskbot.development-replay.v1',note:'确定性合同回放。测试日期、资源、体力、安排和机会由夹具给定；任务通过实际执行器结算。不是模型自然长成的兴趣，也不是现实跨日。',trajectories:[],lifecycle:[]};
function snap(w,label){const f=developmentFacetsReadModel(w,{actorId:OWNER,at:w.clock.synced_at}).actors[0].topics.find(t=>t.topic==='care'),r=w.memory.development.rhythm.actors[OWNER]?.topics.care;return {label,at:w.clock.synced_at,interest:f.interest.status,status:r?.status??'attention',active:f.interest.active_roots.length,exploration:f.interest.exploration_roots.length,invited:f.interest.invited_roots.length,practice:f.capability.success_roots.length,opportunity_days:r?.opportunity_basis?.effective_days.length??0,reason:r?.reason??'尚无本人主动返回',roots:f.capability.success_roots};}
const exploring=developmentFixture(),samples=[];let root=null;
for(let n=0;n<4;n++){arrange(exploring,atDay(n));const t=policyChoice(exploring,{operation:'activity',activity_id:n%2?'tend-bed':'water-bed',motivation:n?'self_continuation':'self_exploration',prior_root_id:root});root=`task:${t.task_id}`;samples.push(snap(exploring,n?'跨日返回':'第一次自选探索'));}
report.trajectories.push({id:'explore',title:'自己想继续，逐渐形成投入',explanation:'第一次尝试单独记录；三个上海日返回、两个实际方法，才形成持续投入。',snapshots:samples});
const invited=developmentFixture(),invitations=[];invited.cognition.actors[OWNER].inbox=[{message_id:'invitation',sender_id:'wetland-grower-001',sender_name:'苔芽',text:'请帮忙照料苗床',at:atDay(0)}];
for(let n=0;n<4;n++){arrange(invited,atDay(n));policyChoice(invited,{operation:'activity',activity_id:'tend-bed',motivation:'invited',source_ids:['invitation']});invitations.push(snap(invited,'受邀做成一次'));}
report.trajectories.push({id:'invited',title:'做成了，不自动等于喜欢',explanation:'四次受邀工作积累实际经验，仍不生成稳定兴趣或角色资格。',snapshots:invitations});
const hold=formedCareFixture(),held=[snap(hold,'已有持续投入')];
hold.memory.development.cognitive_windows[OWNER].push({id:'limited',at:atDay(25),free:false,topics:[],alternatives:[]});hold.clock.synced_at=atDay(25);syncLifeRhythm(hold,atDay(25));held.push(snap(hold,'没有实际机会的二十二天'));
report.trajectories.push({id:'held',title:'暂时没条件，保留原来的牵挂',explanation:'这段测试时间不计入有效机会；保留形成依据，不推断讨厌或遗忘。',snapshots:held});
const returnWorld=formedCareFixture(),returning=[snap(returnWorld,'留下原来的投入')];
for(let n=4;n<=10;n++){returnWorld.memory.development.cognitive_windows[OWNER].push({id:`opportunity-${n}`,at:atDay(n),free:true,topics:['care','explore'],alternatives:['water-bed','observe-local']});returnWorld.clock.synced_at=atDay(n);syncLifeRhythm(returnWorld,atDay(n));if([6,10].includes(n))returning.push(snap(returnWorld,n===6?'三个有效日没有返回':'七个有效日选择其他安排'));}
returnWorld.cognition.actors[OWNER].interpretations=[{source_id:'fresh-question',interpreted_at:atDay(10),source_category:'agent',stance:'affirmed',effect:'inquiry',target_object_ids:['garden-bed'],expires_at:atDay(12)}];syncDevelopmentEvidence(returnWorld,atDay(10));returning.push(snap(returnWorld,'新问题重新带来机会'));
report.trajectories.push({id:'return',title:'可以放下，也能重新想起',explanation:'新输入先唤起注意，不补造实践；是否真的回来，仍等待它的下一次选择。',snapshots:returning});
const w=formedCareFixture(),ctx=cognitiveDevelopmentContext(w,OWNER,w.clock.synced_at),basis={root_outcome_ids:ctx.wish_options.find(d=>d.direction_id==='wetland_frog').basis_roots};
report.lifecycle.push({title:'已有资格，还没有说想变',detail:'满足证据门槛仅显示方向；不会自动换形。'});
policyChoice(w,{operation:'wait',wish_choice:{direction_id:'wetland_frog',decision:'propose',reason:'照料后想试试水边生活'}});
report.lifecycle.push({title:'本人提出愿望',detail:w.cognition.actors[OWNER].role_wish_choice.reason});
arrange(w,atDay(4));const proposal={origin:'lived_wish',status:'prepared',user_choice:'try',proposal_id:'replay-wish',character_id:OWNER,direction_id:'wetland_frog',axis:'form',wish_basis:basis};
startPracticalTrial(w,{proposalId:proposal.proposal_id,actorId:OWNER,directionId:proposal.direction_id,wishBasis:basis,at:w.clock.synced_at,eventId:'try'});
for(let n=4;n<=5;n++){arrange(w,atDay(n));policyChoice(w,{operation:'activity',activity_id:'tend-bed',motivation:'self_continuation',prior_root_id:basis.root_outcome_ids[0]});}
const trial=practicalTrialReadModel(w,{proposalId:proposal.proposal_id}),preview=roleStagePreview(w,{proposal,at:w.clock.synced_at});report.trial={roots:trial.progress.root_outcome_ids,successes:trial.progress.successful_primary,ready:preview.eligible};
report.lifecycle.push({title:'决定试做以后，沿原任务执行',detail:'两个不同上海日完成实际照料；材料、体力与占用照常结算。试做也能暂停或退出。'});
const adopted=acceptRoleStage(w,{proposalId:proposal.proposal_id,actorId:OWNER,directionId:proposal.direction_id,wishBasis:basis,at:w.clock.synced_at,eventId:'accept',previewFingerprint:preview.preview_fingerprint});
report.lifecycle.push({title:'经过复核，明确采用',detail:'仅采用现有数字阶段图层，身份与过去结果保留；这不代表实体外壳已经更换。'});
rollbackRoleStage(w,{stageId:adopted.stage_id,actorId:OWNER,at:w.clock.synced_at,eventId:'rollback'});
report.lifecycle.push({title:'可以撤回这次采用',detail:'撤回当前图层，保留所有做过的事情，不倒带资源和关系。'});
report.limits=['实际试做、采用与撤回沿用现有明确操作入口；本回放由夹具发起，未宣称模型自行完成采用。','四类轨迹验证规则和数据连接；兴趣是否有趣、节奏是否自然，需要第六阶段综合对照与第七阶段自然跨日观察。','兴趣维持看有效机会，形成仍看跨日实际证据；不设固定频率换角色的配额。'];
writeFileSync(join(output,'development-replay.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({trajectories:report.trajectories.length,trial_successes:trial.progress.successful_primary,paid_calls:0}));
