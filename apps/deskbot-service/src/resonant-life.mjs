// Two authored laws extend the same task/inventory engine. No model writes these measurements.
export const RESONANT_LAW='shaping-resonant-life-v1';
const copy=structuredClone,clamp=x=>Math.min(1,Math.max(0,x));
const input=(container,resource,count)=>({container,resource,count});
const recipe=(activity_id,title,target,seconds,inputs=[],output=null)=>({activity_id,title,target,seconds,inputs,kind:activity_id.includes('craft')||activity_id.includes('mount')?'craft':'care',resonant_rule:RESONANT_LAW,...(output?{output}:{})});
export const RESONANT_ACTIVITIES=Object.freeze([
 recipe('echo-craft-bell','制作一只回声浮铃','repair-bench',1200,[input('parts-drawers','wood',1),input('parts-drawers','fasteners',1),input('parts-drawers','cloth',1)],input('bag','echo_bell',1)),
 recipe('echo-set-bell','在浮框旁悬起自己的回声浮铃','floating-frame',600,[input('bag','echo_bell',1)]),
 recipe('echo-read-bell','测记自己的浮铃回声与水位','floating-frame',240),
 recipe('echo-raise-bell','把浮铃的悬点升高一格','floating-frame',300),
 recipe('echo-lower-bell','把浮铃的悬点降下一格','floating-frame',300),
 recipe('echo-dampen-bell','展开浮铃自带的缓风布','floating-frame',180),
 recipe('echo-open-bell','收拢浮铃的缓风布','floating-frame',180),
 recipe('echo-pack-bell','收回自己的浮铃，下次继续','floating-frame',300,[],input('bag','echo_bell',1)),
 recipe('glow-take-study','取下自己的余辉标本带去灯下','seedling-rack',180,[],input('bag','glow_lens',1)),
 recipe('glow-recycle-study','收起旧标本并回收它的托盘','seedling-rack',300,[],input('bag','trays',1)),
 recipe('night-mount-lantern','把余辉标本装成告示板旁的小灯','square-noticeboard',600,[input('bag','glow_lens',1)]),
 recipe('night-read-lantern','测记自己小灯的余辉','square-noticeboard',180),
 recipe('night-close-shutter','合上自己小灯的遮光片','square-noticeboard',120),
 recipe('night-open-shutter','打开自己小灯的遮光片','square-noticeboard',120),
 recipe('night-pack-lantern','拆下自己的小灯，回收托盘','square-noticeboard',300,[],input('bag','trays',1)),
]);
export function installResonantLife(w,at){
 if(w.resonant_life?.version===RESONANT_LAW||!w.fantasy_inquiry)return false;
 if(!w.map_catalog?.objects?.some(o=>o.object_id==='square-noticeboard'))return false;
 w.resonant_life={version:RESONANT_LAW,installed_at:at,notes:{},carried_studies:{}};
 w.living.objects['floating-frame'].echo_bells??=[];
 w.living.objects['square-noticeboard']??={object_id:'square-noticeboard',kind:'facility',condition:1,updated_at:at};
 w.living.objects['square-noticeboard'].night_lanterns??=[];
 return true;
}
const bellFor=(w,id)=>w.living.objects['floating-frame'].echo_bells?.find(b=>b.owner_id===id);
const lampFor=(w,id)=>w.living.objects['square-noticeboard']?.night_lanterns?.find(b=>b.owner_id===id);
const studyFor=(w,id)=>w.living.objects['seedling-rack'].glow_studies?.find(s=>s.owner_id===id);
export function bellMeasurement(bell,frame,{wind=0,rain=0}={}){
 const immersion=clamp(frame.water_level-bell.height+.4),noise=clamp(wind/15+rain*2)*(bell.dampened?.3:1);
 return {water_level:frame.water_level,immersion,wind_mps:wind,noise,
  resonance:clamp(1-Math.abs(immersion-.25)*3)*(1-noise)*frame.condition,
  tone:Math.round(220+immersion*440),height:bell.height,dampened:bell.dampened};
}
export function advanceResonantLife(w,start,end,env){
 const state=w.resonant_life;if(!state)return;
 const hours=Math.max(0,end-Math.max(start,Date.parse(state.installed_at)))/3600000;if(!hours)return;
 const frame=w.living.objects['floating-frame'];
 for(const bell of frame.echo_bells??[]){bell.measurement=bellMeasurement(bell,frame,env);bell.updated_at=new Date(end).toISOString();}
 for(const lamp of w.living.objects['square-noticeboard'].night_lanterns){
  // Closed shutters retain charge but cannot recharge or illuminate the square.
  lamp.charge=clamp(lamp.charge+hours*(env.daylight&&!lamp.closed?.09:lamp.closed?-.008:-.045));
  lamp.brightness=lamp.closed?0:lamp.charge*lamp.cohesion;lamp.updated_at=new Date(end).toISOString();
 }
 for(const study of Object.values(state.carried_studies)){study.charge=clamp(study.charge-hours*.012);study.brightness=study.charge*study.cohesion;}
}
export function resonantActivityReason(w,r,id,at,{completion=false,task=null}={}){
 if(!r.resonant_rule)return null;if(w.resonant_life?.version!==RESONANT_LAW)return '回声与夜灯规则尚未安装';
 const a=r.activity_id,frame=w.living.objects['floating-frame'],bell=bellFor(w,id),lamp=lampFor(w,id);
 if(a==='echo-craft-bell')return w.living.objects['repair-bench'].condition<.4?'先修好工作台':null;
 if(a.startsWith('glow-')){
  const study=studyFor(w,id);
  if(!study)return '陈列架上没有自己的余辉标本';
  if(completion&&task.resonant_asset_id!==study.study_id)return '选中的标本已经变化';
  if(a==='glow-take-study'&&w.resonant_life.carried_studies[id])return '先安置随身已有的标本';
  return null;
 }
 if(a.startsWith('echo-')){
  if(frame.condition<.4||frame.water_level>.9||frame.water_level<.1)return '先等水位回到安全范围，或修好浮框';
  if(a==='echo-set-bell')return bell?'先收回自己的浮铃':frame.echo_bells.length>=3?'浮铃悬点已满':null;
  if(!bell||completion&&task.resonant_asset_id!==bell.bell_id)return '没有与本次活动匹配的自己的浮铃';
  if(a==='echo-read-bell'&&Date.parse(at)-Date.parse(bell.last_read_at??bell.changed_at)<1800000)return '至少留出半小时再测记';
  if(a==='echo-raise-bell'&&bell.height>=.8)return '悬点已经足够高';
  if(a==='echo-lower-bell'&&bell.height<=.2)return '悬点不能再低';
  if(a==='echo-dampen-bell'&&bell.dampened)return '缓风布已经展开';
  if(a==='echo-open-bell'&&!bell.dampened)return '缓风布已经收拢';
  return null;
 }
 if(a==='night-mount-lantern')return lamp?'先收回自己已有的小灯':w.living.objects['square-noticeboard'].night_lanterns.length>=4?'灯架已满':!w.resonant_life.carried_studies[id]?'需要亲自带来有出处的余辉标本':completion&&task.resonant_asset_id!==w.resonant_life.carried_studies[id].study_id?'携带的标本已经变化':null;
 if(!lamp||completion&&task.resonant_asset_id!==lamp.lantern_id)return '没有与本次活动匹配的自己的小灯';
 if(a==='night-read-lantern'&&Date.parse(at)-Date.parse(lamp.last_read_at??lamp.changed_at)<1800000)return '至少留出半小时再测记';
 if(a==='night-close-shutter'&&lamp.closed)return '遮光片已经合上';
 if(a==='night-open-shutter'&&!lamp.closed)return '遮光片已经打开';
 return null;
}
export function resonantActivityBinding(w,r,id){
 if(!r.resonant_rule)return {};
 const asset=r.activity_id.startsWith('glow-')?studyFor(w,id):r.activity_id.startsWith('echo-')?bellFor(w,id):r.activity_id==='night-mount-lantern'?w.resonant_life.carried_studies[id]:lampFor(w,id);
 return {resonant_rule:RESONANT_LAW,resonant_asset_id:asset?.bell_id??asset?.lantern_id??asset?.study_id??null};
}
export function applyResonantActivity(w,r,task,at){
 if(!r.resonant_rule)return null;
 const a=r.activity_id,id=task.actor_id,state=w.resonant_life,frame=w.living.objects['floating-frame'],board=w.living.objects['square-noticeboard'];
 const root=`task:${task.task_id}`,result={rule_version:RESONANT_LAW,root_outcome_id:root,method:a};
 if(a==='echo-craft-bell')return result;
 if(a==='glow-take-study'||a==='glow-recycle-study'){
  const study=studyFor(w,id);w.living.objects['seedling-rack'].glow_studies=w.living.objects['seedling-rack'].glow_studies.filter(s=>s!==study);
  if(a==='glow-take-study')state.carried_studies[id]={...copy(study),carried_root:root};
  return {...result,study_id:study.study_id,observation_root:study.observation_root};
 }
 if(a==='echo-set-bell'){
  const bell={bell_id:`bell:${task.task_id}`,owner_id:id,height:.5,dampened:false,changed_at:at,created_at:at,setup_root:root};bell.measurement=bellMeasurement(bell,frame);frame.echo_bells.push(bell);return {...result,bell:copy(bell)};
 }
 if(a==='night-mount-lantern'){
  const study=state.carried_studies[id],lamp={lantern_id:`lantern:${task.task_id}`,owner_id:id,study_id:study.study_id,observation_root:study.observation_root,setup_root:root,charge:study.charge,cohesion:study.cohesion,brightness:study.brightness,closed:false,changed_at:at,created_at:at};
  board.night_lanterns.push(lamp);delete state.carried_studies[id];return {...result,lantern:copy(lamp)};
 }
 const bell=bellFor(w,id),lamp=lampFor(w,id);
 if(a==='echo-pack-bell'){frame.echo_bells=frame.echo_bells.filter(b=>b!==bell);return {...result,recovered_bell:bell.bell_id};}
 if(a==='night-pack-lantern'){board.night_lanterns=board.night_lanterns.filter(b=>b!==lamp);return {...result,recycled_lantern:lamp.lantern_id,observation_root:lamp.observation_root};}
 if(a==='echo-read-bell'||a==='night-read-lantern'){
  const asset=a==='echo-read-bell'?bell:lamp;
  const record={...result,at,asset_id:asset.bell_id??asset.lantern_id,setup_root:asset.setup_root,reading:a==='echo-read-bell'?copy(bell.measurement):{charge:lamp.charge,brightness:lamp.brightness,closed:lamp.closed}};
  state.notes[id]=[...(state.notes[id]??[]),record].slice(-32);asset.last_read_at=at;return {...result,observation:record};
 }
 if(a==='echo-raise-bell')bell.height=Math.min(.8,bell.height+.15);
 if(a==='echo-lower-bell')bell.height=Math.max(.2,bell.height-.15);
 if(a==='echo-dampen-bell')bell.dampened=true;if(a==='echo-open-bell')bell.dampened=false;
 if(a==='night-close-shutter')lamp.closed=true;if(a==='night-open-shutter')lamp.closed=false;
 const asset=a.startsWith('echo-')?bell:lamp;asset.changed_at=at;asset.last_read_at=null;
 if(bell&&a.startsWith('echo-'))bell.measurement=bellMeasurement(bell,frame,{wind:bell.measurement?.wind_mps??0});
 if(lamp&&a.startsWith('night-'))lamp.brightness=lamp.closed?0:lamp.charge*lamp.cohesion;
 return {...result,state:copy(asset)};
}
export function resonantPersonalContext(w,id){
 return w.resonant_life?{law_version:RESONANT_LAW,notes:copy(w.resonant_life.notes[id]??[]),carried_study:copy(w.resonant_life.carried_studies[id]??null),rule:'浮铃的入水深度与风共同影响回声；遮光片能留住余辉，也会挡住充光和照明。实际测记才留下读数，不预设研究结论。'}:null;
}
