import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {RoleWishes,RoleWishCard} from '../src/deskbot/RoleWishes.tsx';
import {RoleStageCard,RoleStageRecord,RoleStagesSummary} from '../src/deskbot/RoleStages.tsx';
import {RoleStagesReviewPanel} from '../src/RoleStagesReviewPanel.tsx';
import {fetchRoleStagePreview,createRoleStageController} from '../src/deskbot/bridge.ts';
import {isRoleStages,isRoleStagePreview,readRoleStagesReview} from '../src/roleStagesReview.ts';
import type {RoleStagesReviewFixture} from '../src/roleStagesReview.ts';

const fixture=JSON.parse(readFileSync(new URL('../public/role-stages-review.json',import.meta.url),'utf8')) as RoleStagesReviewFixture;
const sample=(id:string)=>structuredClone(fixture.samples.find(value=>value.id===id)!);
const source=readFileSync(new URL('../../deskbot-web/public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function researchFunction(name:string,context:Record<string,unknown>){const start=source.indexOf(`function ${name}(`),from=source.slice(start-6,start)==='async '?start-6:start,end=source.indexOf('\n}\n',start)+3;return runInNewContext(`${source.slice(from,end)};${name}`,context);}
afterEach(()=>vi.unstubAllGlobals());
describe('actual life becomes a reviewed, reversible virtual stage',()=>{
  it('renders every authoritative isolated stage without changing data, promoting a preview or reopening consumed practical work',()=>{
    const before=JSON.stringify(fixture),parsed=readRoleStagesReview(fixture);expect(parsed).not.toBe(null);expect(parsed!.samples.length).toBeGreaterThanOrEqual(8);
    for(const value of parsed!.samples){
      expect(isRoleStages(value.evolution.role_stages),value.id).toBe(true);expect(isRoleStagePreview(value.preview),value.id).toBe(true);
      const html=renderToStaticMarkup(createElement(RoleStagesReviewPanel,{sample:value}));
      expect(html).toContain('正式世界仍按上海现实时间');expect(html).toContain('现实身体');
      for(const proposal of value.proposals)if(proposal.role_stage){const card=renderToStaticMarkup(createElement(RoleWishCard,{proposal,readOnly:true}));expect(card).toContain(proposal.role_stage.stage_id);expect(card).not.toContain('调整试做安排');expect(card).not.toContain('按这个做法继续试做');expect(card).not.toContain('退出这次试做');}
    }
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it('distinguishes an insufficient actual basis, a pure candidate preview and an actually adopted combination',()=>{
    const one=sample('first-result'),ready=sample('ready-preview'),adopted=sample('adopted-combination');
    const firstP=one.proposals.find(value=>value.role_stage_preview?.proposal_id===one.preview.proposal_id)!;
    const first=renderToStaticMarkup(createElement(RoleStageCard,{proposal:firstP,readOnly:true}));
    expect(one.preview.eligible).toBe(false);expect(first).not.toContain('采用这个虚拟形态</button>');
    const readyP=ready.proposals.find(value=>value.proposal_id===ready.preview.proposal_id)!;
    const before=JSON.stringify(ready),html=renderToStaticMarkup(createElement(RoleStageCard,{proposal:readyP,readOnly:true}));
    expect(html).toContain('独立预览');expect(html).toContain('此刻');expect(html).toContain('若采用');expect(html).toMatch(/disabled="">采用这个虚拟形态/);expect(html).toContain('现实外壳、声音和单轴身体能力保持当前');
    expect(ready.evolution.role_stages!.appearance.form).toBe(null);expect(JSON.stringify(ready)).toBe(before);
    const combined=renderToStaticMarkup(createElement(RoleWishes,{snapshot:{evolution:adopted.evolution,proposals:adopted.proposals},readOnly:true}));
    expect(combined).toContain('荷叶青蛙');expect(adopted.evolution.role_stages!.current.vocation).not.toBe(null);expect(combined).toContain('现实外壳保持当前');expect(combined).not.toContain('已经获得职业资格');
  });
  it('only offers rollback for the current axis version, and preserves the other axis plus history in read-only samples',()=>{
    const adopted=sample('adopted-combination'),rolled=sample('rollback-form'),stage=adopted.evolution.role_stages!.current.form!;
    const active=renderToStaticMarkup(createElement(RoleStageRecord,{stage,onControl:()=>{}}));expect(active).toContain('回退这个虚拟形态');expect(active).not.toMatch(/disabled="">回退/);
    const old=rolled.evolution.role_stages!.history.find(value=>value.stage_id===stage.stage_id)!;
    expect(renderToStaticMarkup(createElement(RoleStageRecord,{stage:old,onControl:()=>{}}))).not.toContain('<button');
    expect(rolled.evolution.role_stages!.current.form).toBe(null);expect(rolled.evolution.role_stages!.current.vocation!.stage_id).toBe(adopted.evolution.role_stages!.current.vocation!.stage_id);
    expect(renderToStaticMarkup(createElement(RoleStagesSummary,{stages:rolled.evolution.role_stages}))).toContain('已回退');
  });
  it('rejects fixtures with mismatched world/proposal/visual axes, reopened trial controls or unsupported claims',()=>{
    for(const alter of [
      (value:any)=>value.live_world_untouched=false,
      (value:any)=>value.samples.find((s:any)=>s.id==='adopted-form').appearance.role_stage.form.stage_id='invented',
      (value:any)=>delete value.samples.find((s:any)=>s.id==='adopted-form').map.protagonist.appearance.role_stage,
      (value:any)=>value.samples.find((s:any)=>s.id==='adopted-form').evolution.role_stages.current.form.actor_id='another',
      (value:any)=>value.samples.find((s:any)=>s.id==='adopted-form').proposals.find((p:any)=>p.role_stage).practical_trial.allowed_actions=['adjust'],
      (value:any)=>value.samples.find((s:any)=>s.id==='ready-preview').preview.qualification_proven=true,
      (value:any)=>value.samples.find((s:any)=>s.id==='ready-preview').preview.appearance_preview.form.figure_form='arbitrary-model',
    ]){const bad=structuredClone(fixture);alter(bad);expect(readRoleStagesReview(bad)).toBe(null);}
  });
  it('reads previews with GET alone and binds writes/retries to a reviewed fingerprint or current stage, never arbitrary geometry',async()=>{
    const ready=sample('ready-preview'),calls:{url:string;init?:RequestInit;body?:unknown}[]=[];let fail=true,ids=0;
    vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{calls.push({url,init,body:init?.body?JSON.parse(String(init.body)):undefined});if(init?.method!=='POST')return new Response(JSON.stringify({preview:ready.preview}));if(fail){fail=false;throw Error('response lost');}return new Response(JSON.stringify({accepted:true,role_stage:sample('adopted-form').evolution.role_stages!.current.form}));});
    const preview=await fetchRoleStagePreview(ready.preview.proposal_id,'http://local');expect(calls).toHaveLength(1);expect(calls[0]!.init?.method??'GET').toBe('GET');expect(calls[0]!.body).toBeUndefined();expect(preview).toEqual(ready.preview);
    const control=createRoleStageController('http://local',()=>`retry-${++ids}`);
    await expect(control('wish/frog','accept',preview.preview_fingerprint)).rejects.toThrow('response lost');await control('wish/frog','accept',preview.preview_fingerprint);await control('wish/frog','rollback','actual-stage');
    expect(calls[1]!.body).toEqual(calls[2]!.body);expect(calls[1]!.url).toBe('http://local/api/roles/proposals/wish%2Ffrog/stage/accept');expect(calls[3]!.body).toEqual({event_id:'retry-2',stage_id:'actual-stage'});expect(Object.keys(calls[1]!.body!)).toEqual(['event_id','preview_fingerprint']);
  });
  it('research controls require a preview and current rollback version, retain retry bodies and do not route to legacy trials',async()=>{
    const ready=sample('ready-preview'),proposal=ready.proposals.find(value=>value.proposal_id===ready.preview.proposal_id)!;
    const state={roleBusy:false,roleProposals:[proposal],roleStagePreviews:{} as Record<string,unknown>},posts:any[]=[],messages:string[]=[];let failing=true;
    const handle=researchFunction('handleRoleAction',{state,crypto:{randomUUID:()=> 'fixed'},getJson:async()=>({preview:ready.preview}),postJson:async(url:string,body:unknown)=>{posts.push({url,body});if(failing){failing=false;throw Error('lost');}return {role_stage:sample('adopted-form').evolution.role_stages!.current.form};},refreshRoleLab:async()=>{},setRoleResult:(_kind:string,_title:string,message:string)=>messages.push(message)});
    const target=(operation:string,stageId?:string)=>({disabled:false,dataset:{roleAction:'stage',roleOperation:operation,roleId:proposal.proposal_id,stageId}});
    await handle(target('accept'));expect(posts).toHaveLength(0);await handle(target('preview'));expect(posts).toHaveLength(0);await handle(target('accept'));await handle(target('accept'));expect(posts).toHaveLength(2);expect(posts[0]).toEqual(posts[1]);
    const adopted=sample('adopted-form').proposals.find(value=>value.role_stage)!;state.roleProposals=[adopted];await handle({...target('rollback','stale'),dataset:{roleAction:'stage',roleOperation:'rollback',roleId:adopted.proposal_id,stageId:'stale'}});expect(posts).toHaveLength(2);
    const buttons=researchFunction('roleActionButtons',{state,escapeHtml:(value:unknown)=>String(value)});expect(buttons(adopted)).toContain('data-stage-id');expect(buttons(adopted)).not.toContain('practical');expect(messages.join('')).toContain('先重新查看');
  });
});
