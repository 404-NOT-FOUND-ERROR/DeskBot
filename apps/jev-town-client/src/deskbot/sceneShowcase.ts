import type { Citizen } from "@shared/citizens.ts";
import type { Point } from "@shared/positions.ts";
import { canonicalPointForLocation } from "./canonicalGeometry.ts";
import { projectSceneActivities, sceneCitizenId, type SceneLifeActivity } from "./activityProjection.ts";
import type { DeskBotWorldMap } from "./types.ts";

/** Uses authored identities only. No dialogue/history becomes a published art fixture. */
export function sceneReviewCast(map:DeskBotWorldMap, mode:"actual"|"routine"|"gallery", minute:number, nightWork=false) {
  const identities=[{id:map.protagonist.character_id,name:"喵呜",role:"光粒凝聚的伴生生命",palette:4,place:map.protagonist.location_id},
    ...map.npcs.map(npc=>({id:npc.npc_id,name:npc.display_name,role:npc.role_label??npc.role,palette:npc.palette??0,place:npc.location_id}))];
  const citizens:Citizen[]=identities.map((identity,index)=>({id:sceneCitizenId(identity.id,index===0),name:identity.name,role:identity.role,
    residentStyle:identity.id,personality:mode==='actual'?'此刻的位置与活动来自正式世界。':'美术编排演示，不写入正式生活。',palette:identity.palette,
    homeId:'cottage_north',workId:'market',leaning:{}}));
  const positions=new Map<number,Point>();
  const activities:SceneLifeActivity[]=mode==='actual'?projectSceneActivities(map):[];
  const roles:Record<string,[string,string,string?,string?]>={
    'shaping-001':['moss-sprout-garden','care','water-bed','garden-bed'],
    'wetland-grower-001':['moss-sprout-garden','care','water-bed','garden-bed'],
    'pot-cook-001':['warm-pot-courtyard','craft','cook-moss','trial-stove'],
    'spare-mender-001':['spare-parts-house','craft','repair-bench','repair-bench'],
    'thread-tailor-001':['whisper-market','craft','stitch-canopy','market-canopy'],
    'lamp-keeper-001':['tidal-old-road','observe'],
    'shade-collector-001':['backlit-grove','observe'],
    'echo-postcarrier-001':['lamp-street-homes','observe'],
    'pathfinder-001':['tidal-old-road','observe'],
    'market-trader-001':['whisper-market','social'],
    'sound-player-001':['fog-lamp-square','social'],
    'town-reporter-001':['echo-waterside','observe'],
    'drifting-visitor-001':['backlit-grove','rest'],
  };
  const square=map.locations.find(p=>p.presentation?.model==='square')??map.locations[0]!;
  const center=square.presentation?.lot??canonicalPointForLocation(square);
  identities.forEach((identity,index)=>{
    const citizen=citizens[index]!;
    if(mode==='gallery') {
      positions.set(citizen.id,{x:center.x-6+(index%5)*3,y:center.y+4+Math.floor(index/5)*3});return;
    }
    let [locationId,kind,activityId,targetObjectId]=roles[identity.id]??[identity.place,'observe'];
    if(mode==='actual')locationId=identity.place;
    if(mode==='routine' && (minute>=1320 || minute<300) && identity.id!=='lamp-keeper-001' && !(nightWork && identity.id==='pot-cook-001')) {
      locationId=map.npcs.find(npc=>npc.npc_id===identity.id)?.home_location_id??'shaping-field-desk';
      kind='rest';activityId=undefined;targetObjectId=undefined;
    }
    const place=map.locations.find(p=>p.location_id===locationId)??map.locations[0]!;
    const point=canonicalPointForLocation(place);
    positions.set(citizen.id,{x:point.x+(index%3-1)*1.8,y:point.y+(index%3)*1.1});
    if(mode==='routine')activities.push({actorId:identity.id,citizenId:citizen.id,locationId:place.location_id,
      kind,lifeAction:kind,activityId,targetObjectId,taskId:'art-preview:'+identity.id,title:'动作编排演示 · '+(kind==='rest'?'休息':kind==='craft'?'制作':kind==='care'?'照料':'留意镇上的小事'),status:'running',
      dueAt:'2026-10-05T16:00:00Z',remainingMs:900000,durationMs:900000,realTime:false});
  });
  return {citizens,positions,activities,squareId:square.location_id};
}
