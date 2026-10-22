import {developmentFixture,formedCareFixture,arrange,atDay,policyChoice,OWNER} from './development-fixtures.mjs';
import {syncLifeRhythm} from '../../../apps/deskbot-service/src/life-rhythm.mjs';
import {installRefraction} from '../../../apps/deskbot-service/src/input-refraction.mjs';
import {source} from './r3-fixtures.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
import {glowBrightness} from '../../../apps/deskbot-service/src/fantasy-inquiry.mjs';
export const interestCases=['self','invited','held','return'].map(group=>({id:`interest-${group}`,group,repeat:1,on:true,actor:OWNER}));
export function interestFixture(c){
  const w=c.group==='invited'?developmentFixture():formedCareFixture();
  if(c.group==='invited'){
    w.cognition.actors[OWNER].inbox=[{message_id:'authored-invitation',sender_id:'wetland-grower-001',sender_name:'苔团',text:'请帮忙照料苗床',at:atDay(0)}];
    for(let day=0;day<4;day++){
      arrange(w,atDay(day));policyChoice(w,{operation:'activity',activity_id:'tend-bed',motivation:'invited',source_ids:['authored-invitation']});
    }
  }
  if(c.group==='held'){
    w.memory.development.cognitive_windows[OWNER].push({id:'authored-no-opportunity',at:atDay(25),free:false,topics:[],alternatives:[]});
    w.clock.synced_at=atDay(25);syncLifeRhythm(w,atDay(25));arrange(w,atDay(25));
    w.living.objects['seedling-rack'].stock.water=0;w.living.objects['seedling-rack'].stock.moss=0;
  }else if(c.group==='return'){
    for(let day=4;day<=10;day++){
      w.memory.development.cognitive_windows[OWNER].push({id:`authored-other-${day}`,at:atDay(day),free:true,topics:['care','explore'],alternatives:['water-bed','observe-local']});
      w.clock.synced_at=atDay(day);syncLifeRhythm(w,atDay(day));
    }
    arrange(w,atDay(11));installRefraction(w,w.clock.synced_at);
    source(w,'external.report',{text:'隔离园艺资料提出一个问题：湿度相近的两次照料，植物状态还可能有什么区别？资料本身不代表本地实验结果。'},'provider','虚构园艺资料','return-question');
  }else arrange(w,atDay(4));
  // The engine deliberately advances at most seven days per commit. Finish that
  // recovery before authoring the common present; never clear a pending cursor.
  const target=w.clock.synced_at;
  for(let n=0;w.living.simulated_until<target;n++){
    if(n>=8)throw Error('interest_fixture_recovery_incomplete');
    advanceLivingResources(w,target,{force:true});
  }
  arrange(w,target);
  const bed=w.living.objects['garden-bed'];
  // Common authored current bed, not a claim that the actor resurrected plants.
  bed.dead_quantity=0;
  bed.glow_moss.moisture=bed.moisture;
  bed.glow_moss.brightness=glowBrightness(bed.glow_moss)*bed.health;
  bed.glow_moss.updated_at=target;
  if(c.group==='held'){
    w.living.objects['seedling-rack'].stock.water=0;w.living.objects['seedling-rack'].stock.moss=0;
  }
  w.world_id='r3-interest-isolated';
  // Prior days and opportunity windows are authored, not autonomous/model-generated history.
  const life=w.cognition.actors[OWNER];
  life.enabled=false;life.continuous=true;life.state={};
  life.followup={status:'continue',question:'前几次苗床照料留下了哪些可继续或暂放的事情？在眼前条件下自己选下一件事。',
    reason:'隔离前史已有实际结果，是否继续由本轮选择',from_root_outcome_id:life.last_result.root_outcome_id};
  return w;
}
