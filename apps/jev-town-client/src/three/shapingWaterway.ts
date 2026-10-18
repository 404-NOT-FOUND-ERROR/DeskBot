import blueprint from '../../../../world-content/companion-world/windleaf-region.v1.json';
type Point={x:number;y:number};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
/** A visual tributary within the existing region. No water stock or new travel
 * edge is created. The two bridges follow already admitted forest passages. */
export const SHAPING_CROSSINGS=[
  {passageId:blueprint.passages[0]!.passage_id,points:blueprint.passages[0]!.presentation_points.slice(-2)},
  {passageId:blueprint.passages[1]!.passage_id,points:blueprint.passages[1]!.presentation_points.slice(2,6)},
] as const;
export function shapingChannelAt(x:number,y:number){
  const center=116+2.2*Math.sin(y*.046),width=3.1+.65*Math.sin(y*.081+.8);
  const level=y<38?-1.8:y<82?-3.1:-4.5;
  return {center,width,level,distance:Math.abs(x-center),active:y>=-8&&y<=137};
}
export function shapingChannelGround(x:number,y:number,land:number){
  const river=shapingChannelAt(x,y);if(!river.active)return land;
  const bank=smooth((river.distance-river.width)/3.8);
  return (river.level-.85)* (1-bank)+land*bank;
}
export function shapingBridgeAt(x:number,y:number){
  const candidates:{distance:number;t:number;passageId:string}[]=[];
  for(const bridge of SHAPING_CROSSINGS){
    const lengths=bridge.points.slice(1).map((p,i)=>Math.hypot(p.x-bridge.points[i]!.x,p.y-bridge.points[i]!.y));
    const total=lengths.reduce((a,b)=>a+b,0);let before=0;
    for(let i=1;i<bridge.points.length;i++){
      const a=bridge.points[i-1]!,b=bridge.points[i]!,length=lengths[i-1]!,dx=b.x-a.x,dy=b.y-a.y;
      const t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(length*length));
      const distance=Math.hypot(x-a.x-dx*t,y-a.y-dy*t);
      if(distance<2.8)candidates.push({distance,t:(before+length*t)/total,passageId:bridge.passageId});
      before+=length;
    }
  }
  const closest=candidates.reduce<typeof candidates[number]|null>((a,b)=>!a||b.distance<a.distance?b:a,null);
  if(!closest||closest.distance>=2.35)return null;
  // Blend the two nearest segments at bent bridge joints. Picking a single
  // segment makes elevation jump along the angle bisector after Float32 upload.
  let sum=0,t=0;
  for(const p of candidates){if(p.passageId!==closest.passageId)continue;const weight=Math.exp(-Math.pow((p.distance-closest.distance)/.18,2));sum+=weight;t+=p.t*weight;}
  return {...closest,t:t/sum};
}
export function shapingCrossingSamples(points:readonly Point[]){
  const samples:Point[]=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!,n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.6);
    for(let k=0;k<n;k++)samples.push({x:a.x+(b.x-a.x)*k/n,y:a.y+(b.y-a.y)*k/n});
  }
  samples.push(points.at(-1)!);return samples;
}
