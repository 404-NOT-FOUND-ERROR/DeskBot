import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {DevelopmentEvidence} from '../src/deskbot/DevelopmentEvidence.tsx';
import {facetsReviewCounts,readDevelopmentFacetsReview} from '../src/developmentFacetsReview.ts';
import type {DevelopmentFacetsReviewFixture} from '../src/developmentFacetsReview.ts';
import type {DeskBotDevelopmentEvidence,DeskBotDevelopmentFacetTopic,DeskBotDevelopmentRecord,DeskBotLivedMemory} from '../src/deskbot/types.ts';

const at='2026-10-06T04:00:00Z';
const facet=():DeskBotDevelopmentFacetTopic=>({topic:'care',label:'照料',contact:{count:1,source_record_ids:['contact-1'],days:['2026-10-06']},
  interest:{status:'invited_practice',summary:'回应邀请做过，还不能说明自己喜欢。',active_roots:[],invited_roots:['task:water-once'],obligation_roots:[],unknown_roots:[],active_days:[],active_contexts:[],bonus:0},
  capability:{status:'observed_success',summary:'在这次条件下，实际完成过浇水。',success_roots:['task:water-once'],performance_failure_roots:[],condition_failure_roots:[],unknown_failure_roots:[],cancelled_roots:[],activities:[{activity_id:'water-bed',successes:1,failures:0,days:['2026-10-06'],status:'observed_success'}],root_outcome_ids:['task:water-once']},
  self_assessment:{status:'trying',summary:'先试过了，可以继续观察是否适合。',basis:'rules',root_outcome_ids:['task:water-once']},wish:{status:'not_established',automatic:false,stable_interest:false}});
const record=():DeskBotDevelopmentRecord=>({id:'development:task:water-once',root_outcome_id:'task:water-once',actor_ids:['own'],topic:'care',outcome:'completed',at,title:'给苗床浇水',activity_id:'water-bed',location_id:'moss-sprout-garden',project_ids:[],source:{kind:'canonical_task',task_id:'water-once',task_kind:'care'},
  causes:{source_record_ids:[],source_event_ids:[],sources:[],plan_id:'water-plan',decision:{source:'rules'},trigger:'invited',motivation:{kind:'invited'}},effect:{practice:true,relationship:false,legacy_interest_eligible:true,completion_effect:'living_activity'},views:{memory_ids:[],project_stages:[],commitment_ids:[],linked_task_roots:[]},failure:null,historical_import:false});
const development=():DeskBotDevelopmentEvidence=>({schema:'deskbot.development-evidence.v1',enabled:true,installed_at:at,revision:1,owner_id:'own',counts:{roots:1,practice:1,relationship:0,historical_import:0,completed:1,failed:0,cancelled:0},actors:[{actor_id:'own',display_name:'喵呜',roots:1,practice:1,relationship:0,topics:{care:{roots:1,practice:1,completed:1,failed:0,cancelled:0,own:0,invited:1,unknown_trigger:0}}},{actor_id:'other',display_name:'阿砾',roots:0,practice:0,relationship:0,topics:{}}],recent:[record()],coverage:{retention:{max_records:2048,counts_scope:'retained_unique_root_outcomes'},historical_import_roots:0,causality_unknown_roots:0,limitations:[]},facets:{schema:'deskbot.development-facets.v1',enabled:true,installed_at:at,revision:1,actors:[{actor_id:'own',display_name:'喵呜',topics:[facet()]}]}});
const render=(value:DeskBotDevelopmentEvidence,actorId='own')=>renderToStaticMarkup(createElement(DevelopmentEvidence,{development:value,actorId,journal:true}));
const fixture=():DevelopmentFacetsReviewFixture=>({schema:'deskbot.development-facets-review.v1',simulated:true,live_world_untouched:true,samples:[{id:'owner-practice',label:'主人促成',now:at,summary:'真实浇水留下一个结果。',memory:{schema:'deskbot.lived-memory.v1',owner_id:'own',installed_at:at,revision:1,identity_preserved:true,counts:{},actors:[{actor_id:'own',display_name:'喵呜',interests:{}}],own:[],recent:[],development:development(),planner:{enabled:false,policy:'bounded',limits:{per_hour:6,per_day:72,actor_cooldown_minutes:120},attempts_last_hour:0,requests:[],recent:[]}} satisfies DeskBotLivedMemory}]});

describe('three distinct development facets display shared factual roots',()=>{
  it('renders backend assessments separately and counts an owner-supported result only once',()=>{
    const value=development(),before=JSON.stringify(value),topic=value.facets!.actors[0]!.topics[0]!;
    topic.capability.success_roots.push('task:water-once');topic.interest.invited_roots.push('task:water-once');
    const staged=JSON.stringify(value),html=render(value);
    for(const text of ['喜欢','做得到','怎样看自己','回应邀请做过，还不能说明自己喜欢','实际完成过浇水','先试过了','1 件实际经历','主人促成的真实实践同样保留','这些经历为角色愿望提供依据','生活规则对这些经历的暂时归纳'])expect(html).toContain(text);
    expect(html).not.toContain('技能等级');expect(html).not.toContain('XP');expect(html).not.toContain('奖励');expect(JSON.stringify(value)).toBe(staged);expect(staged).not.toBe(before);
  });
  it('keeps contact visible without making practice, interest or capability mature',()=>{
    const value=development(),topic=value.facets!.actors[0]!.topics[0]!;
    value.actors[0]!.practice=0;value.recent=[];topic.interest.invited_roots=[];topic.capability.success_roots=[];topic.capability.root_outcome_ids=[];topic.capability.activities=[];topic.self_assessment.root_outcome_ids=[];
    topic.interest.summary='只是接触过，兴趣仍待观察。';topic.capability.summary='尚无实际练习的结果。';topic.self_assessment.summary='还没有做过，先不判断。';topic.contact.count=12;
    const html=render(value);for(const text of ['接触过 12 条相关消息','接触本身不算实践','0 件实际经历','只是接触过','尚无实际练习','还没有做过','这些经历为角色愿望提供依据'])expect(html).toContain(text);
    expect(html).not.toContain('兴趣已成熟');expect(html).not.toContain('实际完成过浇水');
  });
  it('shows environmental constraints separately from performance difficulties',()=>{
    const value=development(),entry=value.recent[0]!,topic=value.facets!.actors[0]!.topics[0]!;
    entry.outcome='failed';entry.failure={reason:'缺少一份清水，没能继续。',code:'resource_unavailable',classification:'resource'};
    topic.capability.success_roots=[];topic.capability.condition_failure_roots=[entry.root_outcome_id];topic.capability.summary='缺水影响了这次尝试，能力仍待观察。';
    let html=render(value);for(const text of ['缺少一份清水','受条件影响','不据此降低能力判断','缺水影响了这次尝试'])expect(html).toContain(text);expect(html).not.toContain('这次操作还有待练习');
    entry.failure={reason:'火候未掌握，这次没有做成。',code:'quality_failed',classification:'performance'};topic.capability.condition_failure_roots=[];topic.capability.performance_failure_roots=[entry.root_outcome_id];
    html=render(value);expect(html).toContain('这次操作还有待练习');expect(html).toContain('不据此推断讨厌');expect(html).not.toContain('不据此降低能力判断');
  });
  it('distinguishes doing a necessary task from returning to an interest',()=>{
    const value=development(),entry=value.recent[0]!;entry.causes.trigger='own';entry.causes.motivation={kind:'need'};
    let html=render(value);expect(html).toContain('先照顾生活需要');expect(html).not.toContain('自己又选择继续这个方向');
    entry.causes.motivation={kind:'self_continuation',facet_root_ids:['task:earlier-practice']};html=render(value);expect(html).toContain('结合已有实践，自己又选择继续这个方向');
  });
  it('keeps missing facets compatible and does not reveal another resident assessments',()=>{
    const value=development();let html=render(value,'other');expect(html).not.toContain('实际完成过浇水');expect(html).not.toContain('task:water-once');
    value.facets!.enabled=false;html=render(value);expect(html).toContain('愿望与能力还要靠后续实践看');expect(html).not.toContain('怎样看自己');
    delete value.facets;html=render(value);expect(html).toContain('愿望与能力还要靠后续实践看');
  });
  it('does not fill the live view with untouched default topics or legacy maturity cards',()=>{
    const value=development(),topic=value.facets!.actors[0]!.topics[0]!;topic.contact.count=0;topic.contact.source_record_ids=[];topic.interest.invited_roots=[];topic.capability.success_roots=[];topic.capability.root_outcome_ids=[];topic.self_assessment.root_outcome_ids=[];
    const html=render(value);expect(html).toContain('还没有足够依据来判断');expect(html).not.toContain('回应邀请做过，还不能说明自己喜欢');expect(html).not.toContain('life-development__facet"');
  });
  it('escapes assessment text and preserves supplied claims without turning them into controls',()=>{
    const value=development(),topic=value.facets!.actors[0]!.topics[0]!;topic.interest.summary='<script>becomeChef()</script>';topic.self_assessment.summary='<img onerror=changeIdentity()>';
    const html=render(value);expect(html).toContain('&lt;script&gt;');expect(html).toContain('&lt;img');expect(html).not.toContain('<script>');expect(html).not.toContain('<button');
  });
});

describe('public facets review consumes isolated factual samples',()=>{
  it('validates the isolation marker and deduplicates roots across facets',()=>{
    const value=fixture(),before=JSON.stringify(value);expect(readDevelopmentFacetsReview(value)).toBe(value);
    const topics=value.samples[0]!.memory.development!.facets!.actors[0]!.topics;topics.push({...facet(),topic:'craft',label:'制作'});
    expect(facetsReviewCounts(value.samples[0]!)).toEqual({actual:1,contact:1,successful:1,conditions:0,performance:0,ongoing:false});
    expect(value.samples[0]!.memory.development!.facets!.actors[0]!.topics).toHaveLength(2);expect(before).not.toBe(JSON.stringify(value));
    const stable=JSON.stringify(value);facetsReviewCounts(value.samples[0]!);expect(JSON.stringify(value)).toBe(stable);
  });
  it('rejects unsupported, incomplete or non-isolated samples',()=>{
    for(const value of [null,{},[],{...fixture(),schema:'future'},{...fixture(),simulated:false},{...fixture(),live_world_untouched:false},{...fixture(),samples:[]}])expect(readDevelopmentFacetsReview(value)).toBeNull();
    let value=fixture();value.samples[0]!.now='unknown-time';expect(readDevelopmentFacetsReview(value)).toBeNull();
    value=fixture();value.samples.push(structuredClone(value.samples[0]!));expect(readDevelopmentFacetsReview(value)).toBeNull();
    value=fixture();delete value.samples[0]!.memory.development!.facets;expect(readDevelopmentFacetsReview(value)).toBeNull();
    value=fixture();value.samples[0]!.memory.development!.facets!.actors[0]!.actor_id='other';expect(readDevelopmentFacetsReview(value)).toBeNull();
  });
});
