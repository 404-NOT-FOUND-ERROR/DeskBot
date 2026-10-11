import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {LifeRhythm} from '../src/deskbot/LifeRhythm.tsx';
import type {DeskBotLifeRhythm} from '../src/deskbot/types.ts';
describe('life rhythm visibility',()=>{
 it('keeps one resident’s intentions separate from actual completed follow-up evidence',()=>{
  const rhythm:DeskBotLifeRhythm={schema:'deskbot.life-rhythm.v1',installed_at:'2026-10-05T04:00:00Z',revision:1,
   actors:[{actor_id:'own',primary_topic:'care',side_topics:[],topics:{care:{topic:'care',label:'照料',status:'held',summary:'投入还在',reason:'先处理吃饭与补给',formed_at:'2026-10-05T04:00:00Z',last_active_at:'2026-10-05T04:00:00Z',root_outcome_ids:['task:one']}}}],
   opportunities:[{id:'a',actor_id:'own',topic:'care',kind:'review',title:'回来看看昨天留下的变化',location_id:'garden',activity_id:'water-bed',source_root_id:'task:one',created_at:'2026-10-05T04:00:00Z',not_before:'2026-10-06T00:00:00Z',expires_at:'2026-10-09T00:00:00Z',status:'available',reason:'有空时再去',result_root_id:null},
    {id:'b',actor_id:'other',topic:'cook',kind:'retry',title:'另一位居民的私人后续',location_id:'kitchen',activity_id:'cook-moss',source_root_id:'task:other',created_at:'2026-10-05T04:00:00Z',not_before:'2026-10-06T00:00:00Z',expires_at:'2026-10-09T00:00:00Z',status:'completed',reason:'完成',result_root_id:'task:private'}],
   policy:{primary_limit:1,side_limit:2,quiet_after_days:3,park_after_days:7,followups_per_day:1,automatic_role_change:false}};
  const pending=renderToStaticMarkup(<LifeRhythm rhythm={rhythm} actorId="own"/>);
  expect(pending).toContain('先顾眼前');expect(pending).toContain('安排只是意图');expect(pending).not.toContain('task:private');expect(pending).not.toContain('实际任务完成了');
  rhythm.opportunities[0]!.status='completed';rhythm.opportunities[0]!.result_root_id='task:followup';
  const completed=renderToStaticMarkup(<LifeRhythm rhythm={rhythm} actorId="own"/>);
  expect(completed).toContain('实际任务完成了');expect(completed).toContain('task:followup');expect(completed).toContain('task:one');
 });
});
