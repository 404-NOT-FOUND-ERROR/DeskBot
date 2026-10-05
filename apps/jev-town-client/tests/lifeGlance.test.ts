import {describe,expect,it} from 'vitest';
import {activeActorTask,dayPhaseLabel,taskDisplayTitle,taskTimeLabel,worldGlance} from '../src/deskbot/lifeGlance.ts';
import type {DeskBotWorldMap,DeskBotWorldTask} from '../src/deskbot/types.ts';

const task:DeskBotWorldTask={task_id:'road',actor_id:'own',kind:'travel',title:'沿水路走走',status:'running',due_at:'2026-10-05T15:15:00Z',remaining_ms:900000,destination_location_id:'river'};
const map:DeskBotWorldMap={schema:'deskbot.world-map.v0.1',world_id:'sample',world_revision:1,logical_time:{day:1,minute_of_day:1380,tick:1,date:'2026-10-05'},protagonist:{character_id:'own',location_id:'home'},npcs:[],locations:[{location_id:'river',name:'回声水岸',description:'',x:0,y:0,neighbors:[],current:false,reachable:true,arrival_text:''}],tasks:[task]};

describe('factual living-world glance',()=>{
  it('distinguishes dusk, night and midnight with the scene daylight boundaries',()=>{
    expect([dayPhaseLabel(1019),dayPhaseLabel(1020),dayPhaseLabel(1140),dayPhaseLabel(1320),dayPhaseLabel(0),dayPhaseLabel(330)]).toEqual(['白昼','傍晚','入夜','深夜','午夜','晨光']);
  });
  it('uses the world clock and never fabricates weather or temperature when missing or stale',()=>{
    expect(worldGlance(map,0)).toMatchObject({clock:'23:00',phase:'深夜',weather:'天气暂未接入',temperature:null});
    const sample=structuredClone(map);
    sample.environment={schema:'deskbot.world-environment.v1',projected_at:'2026-10-05T14:59:00Z',time:{mode:'real_time',time_zone:'Asia/Shanghai',minute_of_day:1379,phase:'night',synced_at:'2026-10-05T14:59:00Z',lighting_convention:'presentation'},weather:{status:'fresh',location:'上海',condition:'小雨',provider:'sample',observed_at:'2026-10-05T14:00:00Z',expires_at:'2026-10-05T14:30:00Z',temperature_c:18,wind_mps:3,precipitation:'rain',cloud_cover:.8,intensity:.2}};
    expect(worldGlance(sample,Date.parse('2026-10-05T15:00:00Z'))).toMatchObject({clock:'23:00',weather:'等待新天气',weatherState:'stale',temperature:null});
  });
  it('shows actual destination, paused remainder and Shanghai completion without invented travel arrival',()=>{
    expect(activeActorTask(map,'own')).toBe(task);
    expect(taskDisplayTitle(map,task)).toBe('前往回声水岸');
    expect(taskTimeLabel(task)).toBe('预计 23:15 完成');
    expect(taskTimeLabel({...task,status:'paused',remaining_ms:61000})).toBe('暂时停下 · 还需约 2 分钟');
    expect(activeActorTask({...map,tasks:[{...task,status:'completed'}]},'own')).toBeUndefined();
  });
});
