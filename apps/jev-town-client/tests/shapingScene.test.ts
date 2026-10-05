import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SceneLifeActivity } from '../src/deskbot/activityProjection.ts';
import type { DeskBotEnvironment, DeskBotLocation } from '../src/deskbot/types.ts';
import { buildCompanionScenery } from '../src/three/companionScenery.ts';
import { sceneOperationAt, sceneTimePhaseAt, hasSceneTaskEffect } from '../src/three/sceneLife.ts';
import { sceneEnvironmentAt } from '../src/three/sceneEnvironment.ts';

const content = JSON.parse(readFileSync(new URL('../../../world-content/companion-world/map.v1.json', import.meta.url), 'utf8'));
const locations: DeskBotLocation[] = content.locations.map((p: DeskBotLocation) => ({ ...p, areas: content.areas.filter((a: { location_id: string }) => a.location_id === p.location_id).map((a: { area_id: string }) => ({ ...a, objects: content.objects.filter((o: { area_id: string }) => o.area_id === a.area_id) })) }));
const task = (overrides: Partial<SceneLifeActivity> = {}): SceneLifeActivity => ({ actorId: 'cook-001', citizenId: 101, locationId: 'warm-pot-courtyard', taskId: 'task-live', title: '试做苔芽餐', kind: 'craft', activityId: 'cook-moss', targetObjectId: 'trial-stove', status: 'running', dueAt: '2026-10-05T22:00:00Z', remainingMs: 9000, ...overrides });

describe('Shaping Field local lighting and lived task effects', () => {
  it('distinguishes dawn, dusk, late-night and midnight, including wrapped interpolated time', () => {
    expect(sceneTimePhaseAt(360).id).toBe('dawn');
    expect(sceneTimePhaseAt(1080).id).toBe('dusk');
    expect(sceneTimePhaseAt(1200).id).toBe('evening');
    expect(sceneTimePhaseAt(1380).id).toBe('late-night');
    expect(sceneTimePhaseAt(1470).id).toBe('midnight');
    expect(sceneTimePhaseAt(-30).id).toBe('late-night');
  });
  it('shop signs smoothly close before household windows while safety lights remain overnight', () => {
    const early = sceneOperationAt('market', 1120, .9), middle = sceneOperationAt('market', 1160, .9), closed = sceneOperationAt('market', 1250, 1);
    expect(early.sign).toBeGreaterThan(middle.sign); expect(middle.sign).toBeGreaterThan(closed.sign);
    expect(closed.sign).toBe(0); expect(closed.public).toBe(1);
    expect(sceneOperationAt('homes', 1200, 1).window).toBeGreaterThan(.9);
    expect(sceneOperationAt('homes', 1380, 1).window).toBeLessThan(.5);
    expect(sceneOperationAt('homes', 60, 1).window).toBe(0);
    // Different rooms dim at slightly different times without random timer drift.
    expect(sceneOperationAt('homes', 1350, 1, [], 0).window).not.toBe(sceneOperationAt('homes', 1350, 1, [], 3).window);
  });
  it('an overnight committed task retains its workspace and room without reopening the shop sign', () => {
    const working = sceneOperationAt('workshop', 60, 1, [task({ locationId: 'spare-parts-house', activityId: 'repair-bench' })]);
    expect(working.active).toBe(true); expect(working.work).toBe(1); expect(working.window).toBeGreaterThan(.9); expect(working.sign).toBe(0);
    expect(sceneOperationAt('workshop', 60, 1, [task({ status: 'paused' })]).work).toBe(0);
    expect(sceneOperationAt('workshop', 60, 1, [task({ kind: 'travel' })]).active).toBe(false);
  });
  it('sleep turns off household room light while public lamps stay on, and daytime lamps dim', () => {
    const asleep = sceneOperationAt('homes', 1200, 1, [task({ lifeAction: 'rest' })]);
    expect(asleep.sleeping).toBe(true); expect(asleep.window).toBe(0); expect(asleep.public).toBe(1);
    const day = sceneOperationAt('workshop', 720, 0);
    expect(day.public).toBe(0); expect(day.window).toBe(0); expect(day.sign).toBe(0);
  });
  it('recipe effects use exact committed activity ids, never titles, paused tasks or generic craft', () => {
    expect(hasSceneTaskEffect('steam', [task()])).toBe(true);
    expect(hasSceneTaskEffect('steam', [task({ status: 'paused' })])).toBe(false);
    expect(hasSceneTaskEffect('steam', [task({ kind: 'travel' })])).toBe(false);
    expect(hasSceneTaskEffect('steam', [task({ activityId: undefined, title: '我想煮饭' })])).toBe(false);
    expect(hasSceneTaskEffect('steam', [task({ targetObjectId: undefined })])).toBe(false);
    expect(hasSceneTaskEffect('irrigation', [task({ activityId: 'water-bed' })])).toBe(true);
    expect(hasSceneTaskEffect('sparks', [task({ activityId: 'craft-frame-kit' })])).toBe(true);
  });
  it('expired weather stops wind and rain without changing the actual local lighting phase', () => {
    const now = Date.parse('2026-10-05T16:15:00Z');
    const environment: DeskBotEnvironment = { schema: 'deskbot.world-environment.v1', projected_at: new Date(now).toISOString(), time: { mode: 'real_time', time_zone: 'Asia/Shanghai', minute_of_day: 15, phase: 'night', synced_at: new Date(now).toISOString(), lighting_convention: 'fixed-local-dawn-dusk-v1' }, weather: { status: 'fresh', location: '上海', condition: '雨', provider: 'fixture', observed_at: new Date(now - 600000).toISOString(), expires_at: new Date(now - 1000).toISOString(), temperature_c: 20, wind_mps: 12, precipitation: 'rain', cloud_cover: .9, intensity: .8 } };
    const view = sceneEnvironmentAt(environment, now);
    expect(view.phase.id).toBe('midnight'); expect(view.night).toBe(1); expect(view.weatherStatus).toBe('stale'); expect(view.precipitation).toBe('none'); expect(view.wind).toBe(0);
  });
  it('updates local task steam and lighting without creating it in other locations or growing meshes', () => {
    const scenery = buildCompanionScenery(locations);
    const courtyard = scenery.root.getObjectByName('location:warm-pot-courtyard')!;
    const steam = courtyard.getObjectByName('cook-task-steam')!;
    const work = courtyard.getObjectByName('active-task-light') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    let count = 0; scenery.root.traverse(() => count++);
    scenery.update(10, 1, 4, .5, false, { minute: 60, daylight: 0, activities: [task()] });
    expect(steam.visible).toBe(true); expect(work.material.opacity).toBeGreaterThan(0);
    scenery.update(11, 1, 4, .5, true, { minute: 60, daylight: 0, activities: [task({ locationId: 'echo-waterside' })] });
    expect(steam.visible).toBe(false); expect(work.material.opacity).toBe(0);
    let after = 0; scenery.root.traverse(() => after++); expect(after).toBe(count);
    expect(scenery.trees.every(tree => tree.rotation.z === 0)).toBe(true);
  });
  it('ripples follow persisted water height and harvested seedlings lose their halo', () => {
    const fixtures = JSON.parse(readFileSync(new URL('../public/living-review-fixtures.json', import.meta.url), 'utf8'));
    const scenery = buildCompanionScenery(fixtures.samples.initial.map.locations);
    const water = scenery.root.getObjectByName('water-level:floating-frame')!;
    const ripple = scenery.root.getObjectByName('water-ripple:0')!;
    scenery.applyState(fixtures.samples.storm.map.locations); scenery.update(20, .5, 0, .4, true);
    expect(ripple.position.y).toBeCloseTo(water.position.y + .065);
    scenery.applyState(fixtures.samples.harvested.map.locations); scenery.update(21, 1, 0, 0, true);
    const nursery = scenery.root.getObjectByName('location:moss-sprout-garden')!;
    expect(nursery.getObjectByName('light-condensation-motes')!.visible).toBe(false);
  });
});
