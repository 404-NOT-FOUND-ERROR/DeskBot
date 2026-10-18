import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import samples from '../src/deskbot/windleafReviewFixtures.json';
import type {DeskBotWorldMap} from '../src/deskbot/types.ts';
import {createWindleafScene} from '../src/three/windleafScene.ts';
import {forestArrivalAnchors,forestIdleArrivalAt} from '../src/three/forestArrival.ts';
import {createCitizenFigure,disposeObject} from '../src/three/buildScene.ts';
import {captureFigureGrounding} from '../src/three/sceneGrounding.ts';
import {sceneReviewCast} from '../src/deskbot/sceneShowcase.ts';

describe('forest idle arrival positions',()=>{
  it('stands beside the return table and bench without changing saved coordinates or inventing a task',()=>{
    const map=(samples as unknown as {samples:Record<string,{map:DeskBotWorldMap}>}).samples.packed!.map,before=JSON.stringify(map);
    const scene=createWindleafScene(map.locations)!,anchors=forestArrivalAnchors(scene.objects,map.locations),point={x:145,y:95};
    const standing=forestIdleArrivalAt(anchors,point,false,false)!;
    expect(standing.x+60).toBeCloseTo(149.7);expect(standing.z+60).toBeCloseTo(96.3);
    const figure=createCitizenFigure(0,1,'shaping-001'),reference=captureFigureGrounding(figure);
    figure.group.position.copy(standing);figure.group.position.y-=reference.footY;
    scene.root.updateWorldMatrix(true,true);figure.group.updateWorldMatrix(true,true);
    const body=new THREE.Box3().setFromObject(figure.body),table=new THREE.Box3().setFromObject(scene.objects.get('windleaf-return-table')!.getObjectByName('return-table')!);
    expect(body.intersectsBox(table)).toBe(false);
    expect(forestIdleArrivalAt(anchors,point,true,false)).toBeUndefined();
    expect(forestIdleArrivalAt(anchors,point,false,true)).toBeUndefined();
    expect(forestIdleArrivalAt(anchors,{x:148.2,y:95},false,false)).toBeUndefined();
    expect(JSON.stringify(map)).toBe(before);expect(point).toEqual({x:145,y:95});
    disposeObject(scene.root);disposeObject(figure.group);
  });
  it('provides safe named-place arrivals, including the shelter deck, without affecting old town',()=>{
    const map=(samples as unknown as {samples:Record<string,{map:DeskBotWorldMap}>}).samples.installed!.map,scene=createWindleafScene(map.locations)!;
    const anchors=forestArrivalAnchors(scene.objects,map.locations);expect(anchors).toHaveLength(4);
    const shelter=forestIdleArrivalAt(anchors,{x:190,y:65},false,false)!;
    expect(shelter.z+60).toBeCloseTo(68.3);expect(shelter.y).toBeCloseTo(scene.objects.get('windleaf-rack')!.position.y+.18,5);
    const lowland=forestIdleArrivalAt(anchors,{x:150,y:30},false,false)!;expect(lowland.x+60).toBe(153);expect(lowland.z+60).toBe(32);
    expect(forestIdleArrivalAt(anchors,{x:90,y:50},false,false)).toBeUndefined();disposeObject(scene.root);
  });
  it('resolves the packed replay through its real resident projection, including display spacing',()=>{
    const map=(samples as unknown as {samples:Record<string,{map:DeskBotWorldMap}>}).samples.packed!.map;
    const scene=createWindleafScene(map.locations)!,cast=sceneReviewCast(map,'actual',840);
    const actor=cast.citizens.find(p=>p.residentStyle==='shaping-001')!,point=cast.positions.get(actor.id)!;
    expect(point).toEqual({x:143.2,y:95});
    const standing=forestIdleArrivalAt(forestArrivalAnchors(scene.objects,map.locations),point,false,false)!;
    expect(standing).toBeDefined();expect(standing.x+60).toBeCloseTo(149.7);expect(standing.z+60).toBeCloseTo(96.3);
    disposeObject(scene.root);
  });
});
