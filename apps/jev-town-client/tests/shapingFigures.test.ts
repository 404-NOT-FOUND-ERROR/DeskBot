import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createCitizenFigure, disposeObject } from "../src/three/buildScene.ts";
import { SHAPING_FORMS } from "../src/three/shapingFigures.ts";

describe("light-condensed town inhabitants", () => {
  it("uses thirteen stable identity silhouettes without replacing generic Jev citizens", () => {
    expect(Object.keys(SHAPING_FORMS)).toHaveLength(13);
    expect(new Set(Object.values(SHAPING_FORMS).map(form => form.feature)).size).toBe(13);
    for (const [style, form] of Object.entries(SHAPING_FORMS)) {
      // An unrelated palette must not turn the mail carrier into the cook.
      const figure = createCitizenFigure(4, 20, style);
      expect(figure.group.userData.shaping_form, style).toBe(form.feature);
      expect(figure.group.getObjectByName("seed-eyes")).toBeDefined();
      expect(figure.group.getObjectByName("condensed-light-core")).toBeDefined();
      expect(Object.values(figure.limbs).every(limb => limb.parent === figure.body)).toBe(true);
      const bounds = new THREE.Box3().setFromObject(figure.body);
      expect(bounds.max.y, style).toBeGreaterThan(2.8);
      expect(bounds.max.y, style).toBeLessThan(4);
      const positions = figure.upper.geometry.getAttribute("position");
      expect([...positions.array].every(Number.isFinite), style).toBe(true);
      expect(figure.upper.geometry.getAttribute("color").count).toBe(positions.count);
      disposeObject(figure.group);
    }
    const generic = createCitizenFigure(4, 20);
    expect(generic.updateLife).toBeUndefined();
    expect(generic.group.getObjectByName("condensed-light-core")).toBeUndefined();
    disposeObject(generic.group);
  });

  it("preserves actual travel gait and renders distinct admitted stationary actions", () => {
    const figure = createCitizenFigure(4, 7, "shaping-001");
    const update = figure.updateLife!;
    update(6, "social", false, false, .8, "shared-meal");
    expect(figure.limbs.armRight.rotation.x).toBeLessThan(-.3);
    expect(figure.group.userData.life_pose).toBe("social");
    expect(figure.group.userData.activity_id).toBe("shared-meal");
    figure.limbs.armLeft.rotation.x = .52;
    figure.limbs.armRight.rotation.x = -.52;
    figure.limbs.legLeft.rotation.x = -.66;
    update(7, "social", true, false);
    expect(figure.limbs.armLeft.rotation.x).toBe(.52);
    expect(figure.limbs.armRight.rotation.x).toBe(-.52);
    expect(figure.limbs.legLeft.rotation.x).toBe(-.66);
    expect(figure.limbs.armLeft.rotation.z).toBe(0);
    expect(figure.group.userData.life_pose).toBe("travel");
    update(7, "rest", false, false);
    expect(figure.group.getObjectByName("seed-eyes")!.scale.y).toBe(.16);
    expect(figure.limbs.legLeft.rotation.x).toBe(0);
    update(7, "eat", false, false);
    expect(figure.limbs.armRight.rotation.x).toBeLessThan(-.65);
    disposeObject(figure.group);
  });

  it("freezes idle motion and blinking in reduced motion while retaining semantic poses", () => {
    const figure = createCitizenFigure(0, 1, "shade-collector-001");
    const motes = figure.group.getObjectByName("settling-light-grains") as THREE.InstancedMesh;
    expect(motes.count).toBe(7);
    figure.updateLife!(10, "idle", false, true, .5);
    const frozen = [...motes.instanceMatrix.array];
    figure.updateLife!(33, "idle", false, true, .5);
    expect([...motes.instanceMatrix.array]).toEqual(frozen);
    expect(figure.upper.scale.y).toBe(1);
    expect(figure.group.getObjectByName("seed-eyes")!.scale.y).toBe(1);
    figure.updateLife!(34, "care", false, true, .5);
    expect(figure.limbs.armRight.rotation.x).toBe(-.65);
    figure.updateLife!(35, "idle", false, false, .5);
    expect([...motes.instanceMatrix.array]).not.toEqual(frozen);
    disposeObject(figure.group);
  });

  it("keeps its own light anchor independent of focus highlight and frees instance resources", () => {
    const figure = createCitizenFigure(4, 1, "lamp-keeper-001");
    const core = figure.group.getObjectByName("condensed-light-core") as THREE.Mesh;
    const motes = figure.group.getObjectByName("settling-light-grains") as THREE.InstancedMesh;
    expect(core.material).not.toBe(figure.upper.material);
    figure.upper.material.emissiveIntensity = 0;
    const disposeGeometry = vi.spyOn(motes.geometry, "dispose");
    const disposeMaterial = vi.spyOn(motes.material as THREE.Material, "dispose");
    const disposeInstances = vi.spyOn(motes, "dispose");
    figure.updateLife!(20, "idle", false, true, 1);
    const atNight = (core.material as THREE.MeshBasicMaterial).opacity;
    figure.updateLife!(20, "idle", false, true, 0);
    expect(atNight).toBeGreaterThan((core.material as THREE.MeshBasicMaterial).opacity);
    disposeObject(figure.group);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeInstances).toHaveBeenCalledOnce();
  });
  it('carries a water prop only for actual water inventory on an admitted trip and keeps the hand stable', () => {
    const figure = createCitizenFigure(0, 1, 'shaping-001');
    const bucket = figure.group.getObjectByName('carried-water-bucket')!;
    figure.updateCarry!({ water: 4 }, false); expect(bucket.visible).toBe(false);
    figure.updateCarry!({ water: 0, moss: 2 }, true); expect(bucket.visible).toBe(false);
    figure.updateCarry!({ water: Number.NaN, raw_water: Infinity }, true); expect(bucket.visible).toBe(false);
    figure.updateCarry!({ water: 4 }, true); expect(bucket.visible).toBe(true); expect(bucket.userData.stock.water).toBe(4);
    figure.limbs.armRight.rotation.x = .8; figure.updateLife!(5, 'travel', true, false); expect(figure.limbs.armRight.rotation.x).toBe(.15);
    // A paused trip retains its real cargo without a walking animation.
    figure.updateLife!(5, 'idle', false, true); expect(bucket.visible).toBe(true); expect(figure.group.userData.life_pose).toBe('idle');
    figure.updateCarry!(undefined, false); expect(bucket.visible).toBe(false);
    disposeObject(figure.group);
  });
  it('has distinct collection and seed-sifting gestures, and clears them when paused', () => {
    const figure = createCitizenFigure(0, 1, 'wetland-grower-001');
    figure.updateLife!(5, 'care', false, true, 0, 'collect-water');
    expect(figure.limbs.armRight.rotation.x).toBe(-.36); expect(figure.limbs.armLeft.rotation.z).toBe(-.15);
    figure.updateLife!(5, 'care', false, true, 0, 'save-seeds');
    expect(figure.limbs.armRight.rotation.x).toBe(-.72); expect(figure.limbs.armLeft.rotation.y).toBe(.26);
    figure.updateLife!(5, 'idle', false, true, 0, 'save-seeds');
    expect(figure.limbs.armRight.rotation.x).toBe(0); expect(figure.limbs.armLeft.rotation.y).toBe(0);
    disposeObject(figure.group);
  });
});
