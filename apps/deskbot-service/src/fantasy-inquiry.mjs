// Authored fictional physics. Models may propose hypotheses, never rewrite this law.
export const FANTASY_RULE = 'shaping-glow-moss-v1';
export const GLOW_LAW = Object.freeze({charge_per_light_hour:.18, night_decay_per_hour:.035,
  saturation_threshold:.65, wet_quenching:2, wind_threshold_mps:3, wind_loss_per_hour:.012,
  recovery_per_hour:.025, comparison_seconds:7200, maximum_trials:3});
const clamp = n => Math.min(1,Math.max(0,n));
const copy = structuredClone;
const recipe = (id,title,target,seconds,inputs=[],output=null) => ({activity_id:id,title,target,seconds,inputs,
  kind:id==='glow-craft-hood'||id==='glow-press-study'?'craft':'care',fantasy_rule:FANTASY_RULE,...(output?{output}:{})});
const bagInput = (resource,count) => ({container:'bag',resource,count});
const bagOutput = bagInput;
export const FANTASY_ACTIVITIES = Object.freeze([
  recipe('glow-take-cuttings','从健康苗床分取两份苔芽','garden-bed',600,[],bagOutput('moss',2)),
  recipe('glow-craft-hood','制作可拆的遮风罩','repair-bench',900,[{container:'parts-drawers',resource:'wood',count:1},{container:'parts-drawers',resource:'cloth',count:1}],bagOutput('shade_hood',1)),
  recipe('glow-set-pair','用两份苔芽摆设明暗对照','seedling-rack',600,[bagInput('moss',2),bagInput('trays',2)]),
  recipe('glow-read-pair','测记自己的两盘凝光苔','seedling-rack',180),
  recipe('glow-water-pair','给自己的两盘苔芽等量补水','seedling-rack',180,[{container:'seedling-rack',resource:'water',count:1}]),
  recipe('glow-drain-pair','给自己的两盘苔芽排湿','seedling-rack',300),
  recipe('glow-shelter-pair','给自己的试盘装上遮风罩','seedling-rack',300,[bagInput('shade_hood',1)]),
  recipe('glow-unshelter-pair','取下自己的试盘遮风罩','seedling-rack',180,[],bagOutput('shade_hood',1)),
  recipe('glow-swap-pair','对调自己试盘的明暗位置','seedling-rack',180),
  recipe('glow-press-study','把实测苔样封成余辉标本','seedling-rack',900,[],bagOutput('trays',1)),
  recipe('glow-clear-pair','收起试验并回收两个托盘','seedling-rack',300,[],bagOutput('trays',2)),
]);

export function installFantasyInquiry(world,at) {
  const bed=world.living?.objects['garden-bed'],rack=world.living?.objects['seedling-rack'];
  if(!bed||!rack||world.fantasy_inquiry?.rule_version===FANTASY_RULE)return false;
  world.fantasy_inquiry={rule_version:FANTASY_RULE,installed_at:at,notes:{},completed:[]};
  bed.glow_moss={rule_version:FANTASY_RULE,charge:0,cohesion:.8,brightness:0,updated_at:at};
  rack.glow_trials=[];rack.glow_studies=[];
  return true;
}
export function glowBrightness(sample) {
  return clamp(sample.charge*sample.cohesion*(1-Math.min(.9,Math.max(0,sample.moisture-GLOW_LAW.saturation_threshold)*GLOW_LAW.wet_quenching)));
}
export function evolveGlow(sample,hours,{daylight,rain,evaporation,wind=0}, {light=1,sheltered=false,externalMoisture=null}={}) {
  sample.moisture=externalMoisture??clamp(sample.moisture+hours*((sheltered?0:rain)-evaporation*(daylight?1:.55)-Math.max(0,sample.moisture-.72)*.12));
  sample.charge=clamp(sample.charge+hours*(daylight?GLOW_LAW.charge_per_light_hour*light:-GLOW_LAW.night_decay_per_hour));
  const exposedWind=sheltered?0:Math.max(0,wind-GLOW_LAW.wind_threshold_mps)*GLOW_LAW.wind_loss_per_hour;
  sample.cohesion=clamp(sample.cohesion+hours*(GLOW_LAW.recovery_per_hour-exposedWind));
  sample.brightness=glowBrightness(sample);
}
export function advanceFantasyInquiry(world,start,end,environment) {
  const state=world.fantasy_inquiry;if(state?.rule_version!==FANTASY_RULE)return;
  const hours=Math.max(0,end-Math.max(start,Date.parse(state.installed_at)))/3600000;if(!hours)return;
  const bed=world.living.objects['garden-bed'],rack=world.living.objects['seedling-rack'];
  if(bed?.glow_moss){evolveGlow(bed.glow_moss,hours,environment,{externalMoisture:bed.moisture});bed.glow_moss.brightness*=bed.quantity>0?bed.health:0;bed.glow_moss.updated_at=new Date(end).toISOString();}
  for(const trial of rack?.glow_trials??[]) {
    for(const sample of trial.samples)evolveGlow(sample,hours,environment,{light:sample.light,sheltered:trial.sheltered});
    trial.updated_at=new Date(end).toISOString();
  }
  for(const study of rack?.glow_studies??[]) {
    study.charge=clamp(study.charge-hours*.012);study.brightness=study.charge*study.cohesion;
  }
}
const trialFor=(world,id)=>world.living?.objects['seedling-rack']?.glow_trials?.find(t=>t.owner_id===id);
export function fantasyActivityReason(world,recipe,actorId,at,{completion=false,task=null}={}) {
  if(!recipe.fantasy_rule)return null;
  if(world.fantasy_inquiry?.rule_version!==recipe.fantasy_rule)return '凝光苔规则尚未安装';
  const id=recipe.activity_id,bed=world.living.objects['garden-bed'],rack=world.living.objects['seedling-rack'],trial=trialFor(world,actorId);
  if(task?.fantasy_rule&&task.fantasy_rule!==FANTASY_RULE)return '试验规则发生变更';
  if(id==='glow-take-cuttings')return bed.quantity<4||bed.health<.6?'保留至少两株母苗，只从健康苗床取样':null;
  if(id==='glow-craft-hood')return world.living.objects['repair-bench'].condition<.4?'工作台需要先修好':null;
  if(rack.condition<.4)return '育苗架损坏，需要先修好';
  if(id==='glow-set-pair')return trial?'先结束自己已有的试验':rack.glow_trials.length>=GLOW_LAW.maximum_trials?'试验架没有空位，最多三组':null;
  if(!trial||completion&&task?.fantasy_trial_id!==trial.trial_id)return '没有与本次活动匹配的自己的试盘';
  if(id==='glow-read-pair'){
    const reference=Math.max(Date.parse(trial.changed_at),Date.parse(trial.last_read_at??trial.started_at));
    if(Date.parse(at)-reference<GLOW_LAW.comparison_seconds*1000)return '等实际两小时后再测记；刚改变条件要重新等待';
  }
  if(id==='glow-water-pair'&&trial.samples.some(s=>s.moisture>.75))return '至少一盘已经很湿，不宜继续补水';
  if(id==='glow-drain-pair'&&trial.samples.every(s=>s.moisture<=.65))return '两盘目前都不需要排湿';
  if(id==='glow-shelter-pair'&&trial.sheltered)return '遮风罩已经装好';
  if(id==='glow-unshelter-pair'&&!trial.sheltered)return '尚未装遮风罩';
  if(['glow-clear-pair','glow-press-study'].includes(id)&&trial.sheltered)return '先收回可拆的遮风罩';
  if(id==='glow-press-study'){
    if(!trial.read_count)return '先完成至少一次实际测记';
    if(rack.glow_studies.length>=6)return '标本陈列已满，先选择收起试验而不是继续制作';
  }
  return null;
}
export function fantasyActivityBinding(world,recipe,actorId) {
  return recipe.fantasy_rule?{fantasy_rule:FANTASY_RULE,fantasy_trial_id:trialFor(world,actorId)?.trial_id??null}:{};
}
const readings=trial=>trial.samples.map(s=>({sample_id:s.id,light:s.light,charge:s.charge,moisture:s.moisture,cohesion:s.cohesion,brightness:s.brightness}));
export function applyFantasyActivity(world,recipe,task,at) {
  if(!recipe.fantasy_rule)return null;
  const bed=world.living.objects['garden-bed'],rack=world.living.objects['seedling-rack'],state=world.fantasy_inquiry;
  const id=recipe.activity_id,root=`task:${task.task_id}`;
  let trial=trialFor(world,task.actor_id),result={rule_version:FANTASY_RULE,root_outcome_id:root,method:id};
  if(id==='glow-take-cuttings'){bed.quantity-=2;return {...result,mother_plants_remaining:bed.quantity};}
  if(id==='glow-craft-hood')return result;
  if(id==='glow-set-pair') {
    trial={trial_id:`glow:${task.task_id}`,owner_id:task.actor_id,started_at:at,changed_at:at,updated_at:at,
      setup_root:root,sheltered:false,read_count:0,samples:[1,.2].map((light,i)=>({id:i?'B':'A',light,charge:0,moisture:.5,cohesion:.8,brightness:0}))};
    trial.baseline=readings(trial);rack.glow_trials.push(trial);
    return {...result,trial_id:trial.trial_id,baseline:copy(trial.baseline),text:'两盘同样制备，A放明处、B放遮光格；尚无对照结论。'};
  }
  result.trial_id=trial.trial_id;
  if(id==='glow-read-pair') {
    const record={at,root_outcome_id:root,trial_id:trial.trial_id,setup_root:trial.setup_root,
      from_at:trial.last_read_at??trial.started_at,changed_at:trial.changed_at,sheltered:trial.sheltered,
      baseline:copy(trial.baseline),readings:readings(trial),interpretation:'实际读数；相关差异不自动等于因果结论。'};
    trial.last_read_at=at;trial.read_count++;trial.last_read_root=root;trial.baseline=copy(record.readings);
    state.notes[task.actor_id]=[...(state.notes[task.actor_id]??[]),record].slice(-24);
    return {...result,observation:record};
  }
  if(['glow-press-study','glow-clear-pair'].includes(id)) {
    const final=readings(trial);
    if(id==='glow-press-study'){
      const charge=trial.samples.reduce((n,s)=>n+s.charge,0)/2,cohesion=trial.samples.reduce((n,s)=>n+s.cohesion,0)/2;
      rack.glow_studies.push({study_id:`study:${task.task_id}`,owner_id:task.actor_id,created_at:at,root_outcome_id:root,
        trial_id:trial.trial_id,setup_root:trial.setup_root,observation_root:trial.last_read_root,charge,cohesion,brightness:charge*cohesion,title:'余辉标本'});
    }
    rack.glow_trials=rack.glow_trials.filter(t=>t!==trial);
    state.completed=[...state.completed,{trial_id:trial.trial_id,owner_id:task.actor_id,finished_at:at,root_outcome_id:root,method:id,read_count:trial.read_count,final_readings:final}].slice(-48);
    return {...result,final_readings:final,text:id==='glow-press-study'?'两份苔样和一个托盘成为余辉标本，另一个托盘回收；余辉会消退。':'试验结束，苔样归入堆肥，两个托盘回收。'};
  }
  if(id==='glow-water-pair')for(const sample of trial.samples)sample.moisture=clamp(sample.moisture+.22);
  if(id==='glow-drain-pair')for(const sample of trial.samples)sample.moisture=Math.max(.45,sample.moisture-.3);
  if(id==='glow-shelter-pair')trial.sheltered=true;
  if(id==='glow-unshelter-pair')trial.sheltered=false;
  if(id==='glow-swap-pair')trial.samples.reverse();
  // A/B labels stay with samples, while physical left/right light conditions swap.
  trial.samples.forEach((s,i)=>{s.light=i===0?1:.2;s.brightness=glowBrightness(s);});
  trial.changed_at=at;trial.baseline=readings(trial);
  return {...result,readings:copy(trial.baseline),sheltered:trial.sheltered};
}
export function fantasyPersonalContext(world,actorId) {
  if(!world.fantasy_inquiry)return null;
  return {law_version:FANTASY_RULE,notes:copy(world.fantasy_inquiry.notes[actorId]??[]),
    own_trial:(world.protagonist.character_id===actorId?world.protagonist:world.npcs.find(p=>p.npc_id===actorId))?.location_id==='moss-sprout-garden'?copy(trialFor(world,actorId)??null):null,
    rule:'可尝试光照、排湿、遮风等方法；世界依固定规律结算。自己的测记只说明当时读数。其他人的私人解释不在这里。'};
}
