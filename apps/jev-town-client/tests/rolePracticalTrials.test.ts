import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {RoleWishes,RoleWishCard,PracticalRoleTrial} from '../src/deskbot/RoleWishes.tsx';
import {createPracticalTrialController} from '../src/deskbot/bridge.ts';
import {isPracticalRoleTrial,readRolePracticalTrialsReview} from '../src/rolePracticalTrialsReview.ts';
import type {RolePracticalTrialsReviewFixture} from '../src/rolePracticalTrialsReview.ts';
import type {DeskBotPracticalRoleTrial,DeskBotRoleProposal,DeskBotRoleWishSnapshot} from '../src/deskbot/types.ts';

const wishFixture=JSON.parse(readFileSync(new URL('../public/role-wishes-review.json',import.meta.url),'utf8'));
const sample=()=>structuredClone(wishFixture.samples.find((value:any)=>value.proposals.some((p:any)=>p.status==='prepared')));
const proposal=():DeskBotRoleProposal=>({...sample().proposals.find((value:DeskBotRoleProposal)=>value.status==='prepared'),practical_trial_available:true});
function trial():DeskBotPracticalRoleTrial {
  const p=proposal(),at='2026-10-06T04:00:00.000Z';
  return {schema:'deskbot.practical-role-trial.v1',trial_id:'practical-1',proposal_id:p.proposal_id,actor_id:sample().memory.owner_id,direction_id:p.direction_id,axis:p.axis!,status:'running',variant_id:'nursery',variant_label:'苗圃照料',variant_choices:[{id:'nursery',label:'苗圃照料'},{id:'waterside',label:'水岸生活'}],allowed_actions:['pause','exit'],started_at:at,updated_at:at,
    active_task:{task_id:'actual-task-1',title:'照看一格苗床',activity_id:'water-bed',status:'executing',due_at:'2026-10-06T04:03:00.000Z',remaining_ms:180000,step_role:'primary'},current_step:{kind:'activity',activity_id:'water-bed',location_id:'moss-nursery',step_role:'primary'},outcomes:[],
    progress:{successful_primary:0,condition_failures:0,performance_failures:0,unknown_failures:0,cancelled:0,primary_days:[],root_outcome_ids:[],support_roots:[],started_attempts:1},review:{ready:false,reason:null,basis:'canonical_unique_task_results',summary:'实际动手之后再回看。',quality_proven:false,qualification_proven:false,preference_proven:false,changes_appearance:false},blockers:[],next_step:'先照看这格苗床，做完后核验结果。',frozen_wish_root_ids:p.wish_basis!.root_outcome_ids};
}
const render=(value:DeskBotPracticalRoleTrial,readOnly=false)=>renderToStaticMarkup(createElement(PracticalRoleTrial,{trial:value,readOnly,onControl:()=>{}}));
const researchSource=readFileSync(new URL('../../deskbot-web/public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function researchFunction(name:string,context:Record<string,unknown>) {
  const start=researchSource.indexOf(`function ${name}(`),from=researchSource.slice(start-6,start)==='async '?start-6:start,end=researchSource.indexOf('\n}\n',start)+3;
  return runInNewContext(`${researchSource.slice(from,end)};${name}`,context);
}
afterEach(()=>vi.unstubAllGlobals());
describe('practical role trials keep intent, actual work and grounded review separate',()=>{
  it('offers an actual start only when this phase is available, without treating an ordinary busy gate as a ban on queueing',()=>{
    const p=proposal();p.current_gate={eligible:false,checks:[],barriers:[{id:'actor_busy',label:'眼下有日常活动，先等它忙完',scope:'circumstance'}]};
    const html=renderToStaticMarkup(createElement(RoleWishCard,{proposal:p,onPracticalTrial:()=>{}}));
    expect(html).toContain('还没有开始实际试做');expect(html).toContain('先等它忙完');expect(html).toContain('>开始实际试做</button>');expect(html).not.toContain('disabled="">开始实际试做');
    p.practical_trial_available=false;p.practical_trial_connected=true;
    expect(renderToStaticMarkup(createElement(RoleWishCard,{proposal:p,onPracticalTrial:()=>{}}))).not.toContain('开始实际试做</button>');
  });
  it('shows the actual running task and step without awarding completion or offering adjustment during execution',()=>{
    const value=trial(),before=JSON.stringify(value),html=render(value);
    for(const text of ['照看一格苗床','核验结果','当前步骤','已核验 0 次主要实践','先暂停试做','退出这次试做','不能从这次试做认定喜欢'])expect(html).toContain(text);
    expect(html).not.toContain('调整试做安排');expect(html).not.toContain('确认方向');expect(html).not.toContain('试行反馈');expect(JSON.stringify(value)).toBe(before);
  });
  it('distinguishes blocked conditions, operation difficulties and unique primary or support outcomes',()=>{
    const value=trial();value.status='blocked';value.active_task=null;value.allowed_actions=['resume','adjust','exit'];value.blockers=[{code:'crop_absent',label:'苗床已经空了，先等可照料的苗木',classification:'condition'}];
    const outcome={root_outcome_id:'task:actual-root',at:value.updated_at,outcome:'failed',activity_id:'water-bed',location_id:'moss-nursery',step_role:'primary' as const,attempt_id:'attempt-1',classification:'condition' as const,failure_code:'crop_absent'};
    value.outcomes=[outcome,{...outcome},{...outcome,root_outcome_id:'task:operation-root',classification:'performance',failure_code:'execution_failed'},{...outcome,root_outcome_id:'task:support-root',step_role:'support',outcome:'completed',classification:null,failure_code:null}];
    const html=render(value);
    for(const text of ['苗床已经空了','受条件影响，没办成','操作还需要练习','准备与补给','实际留下的结果 · 3','继续实际试做','调整试做安排'])expect(html).toContain(text);
    expect(html.match(/<code>task:actual-root<\/code>/g)).toHaveLength(1);expect(html).not.toContain('讨厌');
    const replay=render(value,true);expect(replay).toMatch(/disabled="">继续实际试做/);expect(replay).toMatch(/disabled="">退出这次试做/);
  });
  it('keeps review and its results visible across two days, without qualification or appearance acceptance',()=>{
    const value=trial();value.status='review';value.active_task=null;value.allowed_actions=['adjust','exit'];value.progress.successful_primary=2;value.progress.primary_days=['2026-10-05','2026-10-06'];value.review.ready=true;value.review.reason='repeated_actual_success';value.review.summary='两个日子里实际做成了两次，可以回看这段尝试。';
    const p={...proposal(),practical_trial:value},s=sample(),snapshot:DeskBotRoleWishSnapshot={evolution:s.evolution,proposals:[p,...Array.from({length:12},(_,i)=>({...proposal(),proposal_id:`settled-${i}`,axis:'vocation' as const,direction_id:'chef',status:'deferred'}))]};
    const html=renderToStaticMarkup(createElement(RoleWishes,{snapshot,onPracticalTrial:()=>{}}));
    expect(html).toContain('这一段可以回看了');expect(html).toContain('2 个上海日期');expect(html).toContain('两个日子里实际做成了两次');expect(html).not.toContain('还没有正在准备的愿望');expect(html).not.toContain('确认方向');expect(html).not.toContain('继续实际试做</button>');expect(html).toContain('>按这个做法继续试做</button>');expect(html).not.toMatch(/disabled="">按这个做法继续试做/);expect(html).toContain('目前没有变身，也没有认定职业资格');
    value.status='exited';value.allowed_actions=[];expect(render(value)).not.toContain('<button');
  });
  it('validates isolated, nonfixed-length trial fixtures and rejects mismatched actors or promoted claims',()=>{
    const s=sample();s.proposals=[{...proposal(),practical_trial:trial()}];
    const fixture:RolePracticalTrialsReviewFixture={schema:'deskbot.practical-role-trials-review.v1',simulated:true,live_world_untouched:true,samples:[s,{...structuredClone(s),id:`${s.id}-again`}]};
    const before=JSON.stringify(fixture);expect(readRolePracticalTrialsReview(fixture)).toEqual(fixture);expect(JSON.stringify(fixture)).toBe(before);
    for(const change of [(v:any)=>v.live_world_untouched=false,(v:any)=>v.samples[0].proposals[0].practical_trial.review.changes_appearance=true,(v:any)=>v.samples[0].proposals[0].practical_trial.actor_id='wrong',(v:any)=>v.samples[0].proposals[0].status='proposed',(v:any)=>v.samples[0].proposals[0].practical_trial.allowed_actions.push('accept')]) {
      const broken=structuredClone(fixture);change(broken);expect(readRolePracticalTrialsReview(broken)).toBe(null);
    }
    expect(isPracticalRoleTrial({...trial(),variant_id:'arbitrary'})).toBe(false);
  });
  it('renders every generated SQLite practical lifecycle sample from authoritative tasks and common roots',()=>{
    const value=JSON.parse(readFileSync(new URL('../public/role-practical-trials-review.json',import.meta.url),'utf8'));
    const before=JSON.stringify(value),fixture=readRolePracticalTrialsReview(value);
    expect(fixture).not.toBe(null);expect(fixture!.samples.length).toBeGreaterThanOrEqual(5);
    const statuses=new Set<string>();
    for(const sample of fixture!.samples) {
      const html=renderToStaticMarkup(createElement(RoleWishes,{snapshot:{evolution:sample.evolution,proposals:sample.proposals},memory:sample.memory,readOnly:true}));
      expect(html).toContain('形态兴趣与职业愿望');expect(html).not.toContain('确认方向');expect(html).not.toContain('试行反馈');
      for(const proposal of sample.proposals)if(proposal.practical_trial) {
        const trial=proposal.practical_trial;statuses.add(trial.status);
        expect(html).toContain(trial.variant_label);expect(html).toContain('不能从这次试做认定喜欢');
        if(trial.active_task)expect(html).toContain(trial.active_task.title);
        for(const result of trial.outcomes)expect(html).toContain(result.root_outcome_id);
        if(trial.status==='review'){expect(trial.review.ready).toBe(true);expect(trial.progress.primary_days.length).toBeGreaterThanOrEqual(2);expect(html).toContain(trial.review.summary);}
        if(trial.status==='exited')expect(proposal.status).toBe('withdrawn');
      }
    }
    expect(statuses).toEqual(new Set(['running','paused','blocked','review','exited']));expect(JSON.stringify(value)).toBe(before);
  });
  it('routes actual controls separately and keeps event IDs stable only for retries of the same failed body',async()=>{
    const calls:{url:string;body:any}[]=[];let fail=true,sequence=0;
    vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{calls.push({url,body:JSON.parse(String(init.body))});if(fail){fail=false;throw Error('connection interrupted');}return new Response(JSON.stringify({schema:'deskbot.practical-role-trial-action-response.v1',accepted:true,duplicate:false,proposal:proposal(),practical_trial:trial()}),{status:202});});
    const control=createPracticalTrialController('http://local',()=>`stable-${++sequence}`);
    await expect(control('wish/frog','adjust','waterside')).rejects.toThrow('connection interrupted');await control('wish/frog','adjust','waterside');await control('wish/frog','adjust','nursery');
    expect(calls[0]).toEqual(calls[1]);expect(calls[0]!.url).toBe('http://local/api/roles/proposals/wish%2Ffrog/practical-trial/adjust');expect(calls[2]!.body).toEqual({event_id:'stable-2',variant:'nursery'});expect(calls.some(value=>value.url.includes('/trial/'))).toBe(false);
  });
  it('research controls follow server actions and never route new practical work to the legacy trial',async()=>{
    const buttons=researchFunction('roleActionButtons',{escapeHtml:(value:unknown)=>String(value)}),p=proposal();
    expect(buttons(p)).toContain('data-role-operation="start"');p.practical_trial=trial();
    expect(buttons(p)).toContain('data-role-operation="pause"');expect(buttons(p)).not.toContain('data-role-operation="adjust"');expect(buttons(p)).not.toContain('data-role-action="complete"');
    const posts:{url:string;body:any}[]=[],messages:string[]=[];
    const state={roleBusy:false,roleProposals:[p],roleWishesEnabled:true};
    const handle=researchFunction('handleRoleAction',{state,crypto:{randomUUID:()=> 'fixed-id'},postJson:async(url:string,body:any)=>{posts.push({url,body});return {proposal:p,practical_trial:trial()};},refreshRoleLab:async()=>{},setRoleResult:(_kind:string,_title:string,message:string)=>messages.push(message)});
    await handle({disabled:false,dataset:{roleAction:'practical',roleOperation:'pause',roleId:p.proposal_id}});
    expect(posts).toEqual([{url:`/api/roles/proposals/${encodeURIComponent(p.proposal_id)}/practical-trial/pause`,body:{event_id:'role-practical-fixed-id'}}]);
    await handle({disabled:false,dataset:{roleAction:'complete',roleId:p.proposal_id,decision:'accepted'}});expect(posts).toHaveLength(1);expect(messages.join('')).toContain('不能用聊天试行代替');
  });
  it('research adjustment retries reuse a body and reject actions not currently allowed',async()=>{
    const p=proposal();p.practical_trial={...trial(),status:'paused',active_task:null,allowed_actions:['resume','adjust','exit']};
    const calls:any[]=[],state={roleBusy:false,roleProposals:[p]};let failing=true,ids=0;
    const handle=researchFunction('handleRoleAction',{state,crypto:{randomUUID:()=>String(++ids)},postJson:async(url:string,body:any)=>{calls.push({url,body});if(failing){failing=false;throw Error('lost');}return {practical_trial:p.practical_trial};},refreshRoleLab:async()=>{},setRoleResult:()=>{}});
    const target={disabled:false,dataset:{roleAction:'practical',roleOperation:'adjust',roleId:p.proposal_id},closest:()=>({querySelector:()=>({value:'waterside'})})};
    await handle(target);await handle(target);expect(calls).toHaveLength(2);expect(calls[0]).toEqual(calls[1]);expect(calls[1].body).toEqual({event_id:'role-practical-1',variant:'waterside'});
    await handle({disabled:false,dataset:{roleAction:'practical',roleOperation:'pause',roleId:p.proposal_id}});expect(calls).toHaveLength(2);
  });
});
