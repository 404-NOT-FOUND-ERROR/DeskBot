import {readFileSync} from 'node:fs';

// This is authored fiction with explicit epistemic labels, never a fabricated
// event, quotation, task, inventory item or resident private memory.
export const WINDLEAF_STORY_VERSION='windleaf-old-light-v1';
export const WIND_TRACE_LAW=Object.freeze({wind_threshold_mps:3,charge_threshold:.2,leaf_threshold:1,
  formation_seconds:600,lifetime_seconds:1800,cooldown_seconds:7200});
const content=JSON.parse(readFileSync(new URL('../../../world-content/companion-world/windleaf-old-light.v1.json',import.meta.url),'utf8'));
if(content.schema!=='deskbot.place-story-content.v1'||content.content_id!==WINDLEAF_STORY_VERSION
  ||content.objects.some(o=>o.entries.some(e=>!['authored_background','authored_viewpoint','hypothesis'].includes(e.epistemic))))throw new Error('Invalid authored windleaf story content');
const clamp=n=>Math.max(0,Math.min(1,n));
const iso=n=>new Date(n).toISOString();
const ms=value=>Number.isFinite(Date.parse(value??''))?Date.parse(value):null;

export function installWindleafStory(world,at){
  const rule=world.windleaf_life;
  if(!rule||rule.story_version===WINDLEAF_STORY_VERSION||!world.resonant_life)return false;
  for(const item of content.objects){
    const object=world.living.objects[item.object_id];
    if(!object)throw new Error(`Missing windleaf story object: ${item.object_id}`);
    object.place_story={schema:'deskbot.place-story.v1',content_id:content.content_id,location_id:item.location_id,
      entries:item.entries.map(e=>({...structuredClone(e),source:structuredClone(content.source)})),interpretation:content.interpretation};
  }
  const canopy=world.living.objects['windleaf-canopy'];
  canopy.wind_trace={rule_version:WINDLEAF_STORY_VERSION,active:false,intensity:0,formed_at:null,expires_at:null,
    weather_event_id:null,last_sample_at:at,eligible_seconds:0,cooldown_until:null,generation:0};
  rule.story_version=WINDLEAF_STORY_VERSION;rule.story_installed_at=at;
  world.living.revision++;return true;
}

// The clock cursor and formation time live in the same save as the source. A
// restart cannot recreate an expired trace. Unknown weather only allows decay.
// Callers must explicitly provide the trusted weather event, not merely wind.
export function advanceWindTrace(world,start,end,{wind=0,weather_source=null}={}){
  const rule=world.windleaf_life,source=world.living?.objects['windleaf-canopy'],trace=source?.wind_trace;
  if(rule?.story_version!==WINDLEAF_STORY_VERSION||!trace)return;
  const installed=ms(rule.story_installed_at),last=ms(trace.last_sample_at);
  const from=Math.max(start,installed??end,last??end);
  if(end<=from)return;
  if(last!==null&&from>last)trace.eligible_seconds=0;
  const expiry=ms(trace.expires_at),formed=ms(trace.formed_at);
  if(expiry!==null&&formed!==null){trace.intensity=clamp((expiry-end)/(expiry-formed));trace.active=trace.intensity>0;}
  const trusted=weather_source?.trusted===true&&typeof weather_source.event_id==='string'
    &&ms(weather_source.from)!==null&&ms(weather_source.until)!==null
    &&from>=ms(weather_source.from)&&end<=ms(weather_source.until);
  const eligible=trusted&&Number.isFinite(wind)&&wind>=WIND_TRACE_LAW.wind_threshold_mps
    &&source.charge>=WIND_TRACE_LAW.charge_threshold&&source.stock.light_leaf>=WIND_TRACE_LAW.leaf_threshold;
  const readyFrom=Math.max(from,ms(trace.cooldown_until)??from);
  if(!eligible||trace.active||end<=readyFrom)trace.eligible_seconds=0;
  else {
    const remaining=Math.max(0,WIND_TRACE_LAW.formation_seconds-trace.eligible_seconds);
    const seconds=(end-readyFrom)/1000;
    if(seconds>=remaining){
      const formedAt=readyFrom+remaining*1000,expiresAt=formedAt+WIND_TRACE_LAW.lifetime_seconds*1000;
      Object.assign(trace,{formed_at:iso(formedAt),expires_at:iso(expiresAt),weather_event_id:weather_source.event_id,
        cooldown_until:iso(formedAt+WIND_TRACE_LAW.cooldown_seconds*1000),generation:trace.generation+1,eligible_seconds:0,
        intensity:clamp((expiresAt-end)/(WIND_TRACE_LAW.lifetime_seconds*1000)),active:end<expiresAt});
    } else trace.eligible_seconds+=seconds;
  }
  trace.last_sample_at=iso(end);
}

export function localWindleafLore(world,locationId){
  return Object.values(world.living?.objects??{}).filter(o=>o.place_story?.location_id===locationId)
    .map(o=>({object_id:o.object_id,...structuredClone(o.place_story)}));
}
