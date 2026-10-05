import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {ResidentProject,residentProjectFor} from '../src/deskbot/ResidentProject.tsx';
import {ProjectFacilityState} from '../src/deskbot/ProjectFacilityState.tsx';
import type {DeskBotResidentProject,DeskBotWorldMap,DeskBotObjectState} from '../src/deskbot/types.ts';

const fixtures=JSON.parse(readFileSync(new URL('../public/living-review-fixtures.json',import.meta.url),'utf8'));
const world=():DeskBotWorldMap=>structuredClone(fixtures.samples.initial.map);
const project=():DeskBotResidentProject=>({project_id:'floating-seedbed',owner_id:'wetland-grower-001',name:'水岸浮圃',goal:'让浮框上也能育苗',status:'active',attempt:1,stage_id:'inspect',stage_title:'等一次真实检查',stage_started_at:'2026-10-05T12:00:00Z',target_object_id:'floating-frame',location_id:'echo-waterside',ready_at:'2026-10-06T00:00:00Z',blocked_reason:'还需扣扣来检查',last_outcome:null,evidence:[],history:[],completed_at:null,retry_count:0});
describe('read-only resident project UI',()=>{
  it('uses canonical progress over a stale resident card and never turns elapsed waiting into completion',()=>{
    const map=world(),p=project();p.attempt=6;map.projects={schema:'projects-test',version:'test',installed_at:'2026-10-05T12:00:00Z',revision:1,projects:[p]};
    map.npcs.push({npc_id:p.owner_id,display_name:'苔团',role:'grower',location_id:'echo-waterside',status:'在苗圃忙着',bio:'惦记自己的浮圃',temperament:'仔细',speech_style:'慢慢说',last_action:null,project:{goal:p.goal,status:'completed',progress:{stage_id:'done',attempt:6,ready_at:null,completed_at:'2026-10-06T00:00:00Z',last_outcome:null}}});
    expect(residentProjectFor(map,p.owner_id)).toBe(p);
    const html=renderToStaticMarkup(createElement(ResidentProject,{project:p,map,onPlace:()=>{}}));
    expect(html).toContain('等一次真实检查');expect(html).toContain('还需扣扣来检查');expect(html).toContain('时间到了，还要实际接着做');
    expect(html).not.toContain('已经做成');expect(html).not.toContain('<progress');
    expect(html).toContain('初次推进，尚未返工');expect(html).not.toContain('已返工 6 次');expect(html).not.toContain('第 6 次');
    map.projects=null;expect(residentProjectFor(map,p.owner_id)).toBeNull();
  });
  it('shows actual setbacks, work history and accepted outcome without rewriting them',()=>{
    const map=world(),p=project();p.status='setback';p.attempt=6;p.retry_count=2;p.last_outcome={at:'2026-10-05T13:00:00Z',text:'这次苗木枯萎了，先重新育苗',success:false,kind:'setback',task_id:'failed-inspection',activity_id:'seedbed-inspect',actor_id:'spare-mender-001',stage_id:'inspect',attempt:1};p.history=[p.last_outcome];
    const before=JSON.stringify(p),html=renderToStaticMarkup(createElement(ResidentProject,{project:p,map,onPlace:()=>{}}));
    expect(html).toContain('遇到波折');expect(html).toContain('先重新育苗');expect(html).toContain('已返工 2 次');expect(html).not.toContain('已返工 6 次');expect(JSON.stringify(p)).toBe(before);
    p.status='completed';p.completed_at='2026-10-06T02:00:00Z';p.target_object_id=null;p.location_id=null;expect(renderToStaticMarkup(createElement(ResidentProject,{project:p,map,onPlace:()=>{}}))).toContain('做成于');
  });
  it('keeps the compact place summary empty until real assets exist and shows their exact state',()=>{
    const state:DeskBotObjectState={object_id:'floating-frame',kind:'facility',updated_at:'2026-10-05T12:00:00Z'};
    const render=()=>renderToStaticMarkup(createElement(ProjectFacilityState,{state,compact:true}));
    expect(render()).toBe('');
    state.project_assets={floating_seedbed:{project_id:'floating-seedbed',status:'prototype',installed_at:state.updated_at,quantity:6,growth:.04,health:.9,moisture:.58},small_water_pump:{project_id:'small-water-pump',status:'installed_trial',installed_at:state.updated_at,condition:.92,use_count:0}};
    let html=render();expect(html).toContain('6 株');expect(html).toContain('生长 4%');expect(html).toContain('苗况 90%');expect(html).toContain('尚未验收');expect(html).toContain('完好 92%');expect(html).toContain('实际汲水 0 次');
    state.project_assets=undefined;state.project_batches={'leaf-signature-soup':{batch_id:'real-cooked-batch',status:'carried',prepared_at:state.updated_at,expires_at:'2026-10-06T12:00:00Z',remaining_portions:2}};
    html=render();expect(html).toContain('尚未端到长桌');expect(html).toContain('剩下 2 份');expect(html).not.toContain('已存入配方簿');
  });
  it('distinguishes a recorded draft from an accepted recipe and presents the real batch portions',()=>{
    const state:DeskBotObjectState={object_id:'trial-stove',kind:'facility',updated_at:'2026-10-05T12:00:00Z',project_drafts:{'leaf-signature-soup':{project_id:'leaf-signature-soup',recorded_at:'2026-10-05T12:00:00Z',inputs:[{resource:'moss',count:2}],yield_count:3}},project_batches:{'leaf-signature-soup':{batch_id:'actual-batch',status:'awaiting_taste',prepared_at:'2026-10-05T12:00:00Z',expires_at:'2026-10-06T12:00:00Z',remaining_portions:2}}};
    const props={state,names:{moss:'鲜苔芽'}};
    let html=renderToStaticMarkup(createElement(ProjectFacilityState,props));expect(html).toContain('计划每锅 3 份');expect(html).toContain('剩下 2 份');expect(html).not.toContain('已存入配方簿');
    state.recipe_book={'leaf-signature-soup':{project_id:'leaf-signature-soup',name:'正式叶香汤',accepted_at:'2026-10-06T02:00:00Z',inputs:[{resource:'moss',count:2}],yield_count:3}};
    html=renderToStaticMarkup(createElement(ProjectFacilityState,props));expect(html).toContain('正式叶香汤');expect(html).toContain('已存入配方簿');expect(html).not.toContain('计划每锅');
  });
});
