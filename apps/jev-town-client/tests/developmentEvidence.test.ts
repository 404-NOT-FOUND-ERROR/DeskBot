import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {DevelopmentEvidence} from '../src/deskbot/DevelopmentEvidence.tsx';
import {LivedMemory} from '../src/deskbot/LivedMemory.tsx';
import type {DeskBotDevelopmentEvidence,DeskBotDevelopmentRecord,DeskBotLivedMemory} from '../src/deskbot/types.ts';

const at='2026-10-05T12:00:00Z';
const record=():DeskBotDevelopmentRecord=>({id:'development:task:water-once',root_outcome_id:'task:water-once',actor_ids:['own'],topic:'care',outcome:'completed',at,
  title:'给苗床浇水',activity_id:'water-bed',location_id:'moss-sprout-garden',project_ids:['floating-seedbed'],
  source:{kind:'canonical_task',task_id:'water-once',task_kind:'care'},
  causes:{source_record_ids:['owner-suggestion'],source_event_ids:['suggestion-event'],sources:[{record_id:'owner-suggestion',event_id:'suggestion-event',origin_id:'suggestion-event',category:'user',input_category:'dialogue',attested:true}],plan_id:'real-plan',decision:{source:'model',model:'fixture-model',request_id:'model-request',memory_ids:[]},trigger:'invited'},
  effect:{practice:true,relationship:false,legacy_interest_eligible:true,completion_effect:'living_activity'},
  views:{memory_ids:['actual-task-memory','same-project-memory'],project_stages:[{project_id:'floating-seedbed',stage_id:'care'}],commitment_ids:[],linked_task_roots:[]},failure:null,historical_import:false});
const development=():DeskBotDevelopmentEvidence=>({schema:'deskbot.development-evidence.v1',enabled:true,installed_at:at,revision:1,owner_id:'own',
  counts:{roots:101,practice:99,relationship:2,historical_import:0,completed:98,failed:2,cancelled:1},
  actors:[{actor_id:'own',display_name:'喵呜',roots:1,practice:1,relationship:0,topics:{care:{roots:1,practice:1,completed:1,failed:0,cancelled:0,own:1,invited:0,unknown_trigger:0}}},
    {actor_id:'other',display_name:'阿砾',roots:0,practice:0,relationship:0,topics:{}}],recent:[record()],
  coverage:{retention:{max_records:2048,counts_scope:'retained_unique_root_outcomes'},historical_import_roots:0,causality_unknown_roots:0,limitations:['只表示实际经历，不自动解锁能力。']}});
const memory=():DeskBotLivedMemory=>({schema:'memory-test',owner_id:'own',installed_at:at,revision:1,identity_preserved:true,counts:{world_fact:2},actors:[{actor_id:'own',display_name:'喵呜',interests:{}}],
  own:[{id:'actual-task-memory',root_outcome_id:'task:water-once',kind:'world_fact',actor_ids:['own'],at,text:'实际浇水完成',topic:'care',outcome:'completed',independent_evidence:true,source:{kind:'canonical_task',task_id:'water-once'}},
    {id:'same-project-memory',root_outcome_id:'task:water-once',kind:'world_fact',actor_ids:['own'],at,text:'浮圃照料结果记在项目里',topic:'care',outcome:'completed',independent_evidence:false,source:{kind:'resident_project',task_id:'water-once'}}],recent:[],development:development(),
  planner:{enabled:true,policy:'bounded',limits:{per_hour:6,per_day:72,actor_cooldown_minutes:120},attempts_last_hour:0,requests:[],recent:[]}});
const render=(value:DeskBotDevelopmentEvidence|undefined|null,actorId='own',journal=false)=>renderToStaticMarkup(createElement(DevelopmentEvidence,{development:value,actorId,journal}));

describe('development evidence follows actual roots, not interest maturity',()=>{
  it('shows only actor counts and connects a suggestion, a real practice and its outcome under one root',()=>{
    const value=development(),before=JSON.stringify(value),html=render(value,'own',true);
    for(const text of ['>1</strong>','次实际实践','>0</strong>','次约定结果','参考了主人这边的输入','关联主人输入','自己的安排','给苗床浇水','做完了','task:water-once','owner-suggestion','real-plan','任务和项目记的是同一段经历，只计一次结果','愿望与能力还要靠后续实践看'])expect(html).toContain(text);
    expect(html).not.toContain('>99</strong>');expect(html).not.toContain('技能等级');expect(html).not.toContain('能力已成熟');expect(JSON.stringify(value)).toBe(before);
  });
  it('keeps multiple projections of one outcome in one trail and grouped memory entry',()=>{
    const value=development();value.recent.push({...record(),id:'duplicate-project-projection'});
    const html=render(value);expect(html.match(/class="life-development__trail life-development__trail--completed"/g)).toHaveLength(1);
    const state=memory(),view=renderToStaticMarkup(createElement(LivedMemory,{memory:state,actorId:'own',journal:true}));
    expect(view).toContain('同一经历的多个视角');expect(view).toContain('浮圃照料结果记在项目里');expect(view.match(/共同经历编号：task:water-once/g)).toHaveLength(1);
    expect(view).toContain('多个记录视角只计一次结果');
  });
  it('renders real failure and cancellation without describing an unfinished activity as completed practice',()=>{
    const value=development(),failed=record();failed.outcome='failed';failed.failure={reason:'苗床已被别人占用，未能继续。',code:'object_busy'};value.recent=[failed];value.actors[0]!.topics.care!.completed=0;value.actors[0]!.topics.care!.failed=1;
    let html=render(value);expect(html).toContain('苗床已被别人占用');expect(html).toContain('遇到困难 1 次');expect(html).toContain('曾尝试');expect(html).not.toContain('实际做了「给苗床浇水」');
    failed.outcome='cancelled';failed.failure=null;html=render(value);expect(html).toContain('这次停下了');expect(html).toContain('中途停下');expect(html).not.toContain('做完了，保留');
  });
  it('marks missing historical causality and never attributes an unconfirmed input to the owner',()=>{
    const value=development(),old=record();old.causes.trigger='unknown';old.causes.decision=null;old.causes.sources[0]!.attested=false;old.causes.plan_id=null;old.historical_import=true;value.recent=[old];
    const html=render(value);expect(html).toContain('前因没有记全');expect(html).toContain('没有补写当时未记录的选择');expect(html).toContain('关联主人输入 · 来源未确认');expect(html).not.toContain('参考了主人这边的输入，再结合自己的安排');
  });
  it('handles old saves, disabled modules and incompatible responses without fabricating records',()=>{
    expect(render(null)).toContain('还没有可追溯的实践结果');expect(render(undefined)).toContain('还没有可追溯的实践结果');
    const disabled=development();disabled.enabled=false;expect(render(disabled)).not.toContain('给苗床浇水');
    const incompatible={...development(),schema:'future-schema'} as unknown as DeskBotDevelopmentEvidence;expect(render(incompatible)).toContain('实践记录暂时不可用');
    const state=memory();delete state.development;expect(renderToStaticMarkup(createElement(LivedMemory,{memory:state,actorId:'own',journal:true}))).toContain('实际浇水完成');
    expect(renderToStaticMarkup(createElement(LivedMemory,{memory:null,actorId:'own'}))).toBe('');
  });
  it('does not show another resident the owner roots, suggestions, or totals',()=>{
    const value=development();let html=render(value,'other');expect(html).toContain('>0</strong>');for(const text of ['task:water-once','owner-suggestion','给苗床浇水','>99</strong>'])expect(html).not.toContain(text);
    html=render(value,'unknown');expect(html).toContain('还没有可追溯的实践结果');expect(html).not.toContain('task:water-once');
    const state=memory();state.own.push({...state.own[0]!,id:'wrongly-routed',actor_ids:['other'],text:'其他居民的私有记录'});
    expect(renderToStaticMarkup(createElement(LivedMemory,{memory:state,actorId:'own'}))).not.toContain('其他居民的私有记录');
  });
  it('separates non-practice activity and relationship results from practice cards and counts',()=>{
    const value=development(),entry=record();entry.effect.practice=false;entry.effect.relationship=true;entry.topic='connection';entry.outcome='declined';entry.title='实际约定结果';value.recent=[entry];
    value.actors[0]!.practice=0;value.actors[0]!.relationship=1;value.actors[0]!.topics={connection:{roots:1,practice:0,completed:0,failed:0,cancelled:0,own:0,invited:1,unknown_trigger:0}};
    let html=render(value);expect(html).toContain('次约定结果');expect(html).toContain('没有参加');expect(html).not.toContain('做完 0 次');expect(html).not.toContain('次实际来往');expect(html).toContain('<span>约定</span>');
    entry.effect.relationship=false;entry.title='实际出行结果';entry.source.task_kind='travel';entry.outcome='completed';html=render(value);expect(html).toContain('<span>实际活动</span>');expect(html).not.toContain('<span>实践</span>');
    entry.source.task_kind='care';entry.topic='explore';entry.effect.completion_effect='record_activity_only';html=render(value);expect(html).toContain('<span>观察事实</span>');expect(html).toContain('的活动结果');expect(html).not.toContain('<span>实践</span>');
  });
  it('escapes source details and preserves uncertain timestamps without invalid dates or action controls',()=>{
    const value=development(),entry=value.recent[0]!;entry.title='<script>becomeFrog()</script>';entry.failure={reason:'<img onerror=changeIdentity()>',code:null};entry.at='unknown-time';entry.causes.source_record_ids=['javascript:execute()'];
    const html=render(value);expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('&lt;img');expect(html).toContain('时间未记全');expect(html).not.toContain('Invalid Date');expect(html).not.toContain('<button');
  });
});
