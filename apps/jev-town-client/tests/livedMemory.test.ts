import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {LivedMemory} from '../src/deskbot/LivedMemory.tsx';
import type {DeskBotLivedMemory} from '../src/deskbot/types.ts';
const memory:DeskBotLivedMemory={schema:'test',owner_id:'own',installed_at:'2026-10-05T04:00:00Z',revision:1,identity_preserved:true,counts:{world_fact:1,hearsay:1,personal_interpretation:1},actors:[{actor_id:'own',display_name:'喵呜',interests:{care:{topic:'care',days:['2026-10-03','2026-10-04','2026-10-05'],stage:'trying',successes:5,setbacks:1,bonus:6,evidence_ids:['done']}}},{actor_id:'other',display_name:'阿砾',interests:{}}],own:[
  {id:'done',kind:'world_fact',actor_ids:['own'],at:'2026-10-05T04:00:00Z',text:'实际浇水完成',topic:'care',outcome:'completed',source:{kind:'canonical_task',task_id:'water-task'},independent_evidence:true},
  {id:'heard',kind:'hearsay',actor_ids:['own'],at:'2026-10-05T04:00:00Z',text:'读到森林新闻',topic:null,outcome:'received',source:{kind:'external',label:'NASA Science',url:'https://science.nasa.gov/story'},independent_evidence:false},
  {id:'thought',kind:'personal_interpretation',actor_ids:['own'],at:'2026-10-05T04:00:00Z',text:'我想多照料一会儿',topic:null,outcome:'intended',source:{kind:'model_choice'},evidence_ids:['done'],independent_evidence:false}
],recent:[],planner:{enabled:true,policy:'bounded',limits:{per_hour:6,per_day:72,actor_cooldown_minutes:120},attempts_last_hour:1,requests:[{id:'pending',actor_id:'own',status:'calling'}],recent:[]}};
describe('lived memory views',()=>{
 it('shows slow, reversible interests and actual setbacks without claiming a new form',()=>{const html=renderToStaticMarkup(createElement(LivedMemory,{memory,actorId:'own'}));for(const text of ['想继续试试','3 天的经历','遇到困难 1 次','身份一直是自己','正在结合经历'])expect(html).toContain(text);expect(html).not.toContain('已经换壳');});
 it('distinguishes fact, interpretation and hearsay with evidence and publisher links',()=>{const html=renderToStaticMarkup(createElement(LivedMemory,{memory,actorId:'own',journal:true}));for(const text of ['实际经历','当时的想法','听来的消息','来自实际任务','行动尚需看结果','NASA Science','https://science.nasa.gov/story','参考了 1 条已有记忆'])expect(html).toContain(text);});
 it('never leaks the protagonist memories into another resident view',()=>{const html=renderToStaticMarkup(createElement(LivedMemory,{memory,actorId:'other'}));expect(html).not.toContain('实际浇水完成');expect(html).not.toContain('读到森林新闻');expect(html).toContain('还没有足够的实际经历');});
 it('escapes account text and suppresses unsafe source URLs',()=>{const state=structuredClone(memory);state.own[1]!.text='<script>swapIdentity()</script>';state.own[1]!.source.url='javascript:alert(1)';const html=renderToStaticMarkup(createElement(LivedMemory,{memory:state,actorId:'own',journal:true}));expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('javascript:');});
});
