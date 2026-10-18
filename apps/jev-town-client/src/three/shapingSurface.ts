import {shapingCoastDistance} from './shapingLandform.ts';
export type SurfacePoint={x:number;y:number};
/** Identical jitter on either side of the town/forest seam. Facets follow
 * natural triangles, without the appearance of square grass tiles. */
export function shapingTerrainVertex(x:number,y:number):SurfacePoint{
  return {x:x+Math.sin(x*37.1+y*13.7)*.58,y:y+Math.cos(y*31.3-x*17.9)*.58};
}
export function clipShapingCoast(points:SurfacePoint[]):SurfacePoint[][]{
  const polygon:SurfacePoint[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i]!,b=points[(i+1)%points.length]!,da=shapingCoastDistance(a.x,a.y),db=shapingCoastDistance(b.x,b.y);
    if(da>=0)polygon.push(a);
    if((da>=0)!==(db>=0)){
      const t=da/(da-db);polygon.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    }
  }
  const triangles:SurfacePoint[][]=[];
  for(let i=1;i<polygon.length-1;i++)triangles.push([polygon[0]!,polygon[i]!,polygon[i+1]!]);
  return triangles;
}
