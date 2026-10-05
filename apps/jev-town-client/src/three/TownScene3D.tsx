import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { ACTION_GLYPH, ACTION_LABEL, type Action } from "@shared/actions.ts";
import type { Citizen } from "@shared/citizens.ts";
import type { Point } from "@shared/positions.ts";
import { routeBetween, routeLength, sampleRoute, type RoutePoint } from "@shared/routes.ts";
import { getPlace, MAP_H, MAP_W } from "@shared/town.ts";
import { mapToWorld } from "@shared/world.ts";
import {
  actionColor,
  CITIZEN_HEAD_HEIGHT,
  buildTownScenery,
  createCitizenFigure,
  disposeObject,
  updateFountainJets,
  type CitizenFigure,
} from "./buildScene.ts";
import { toCssHex } from "./palette.ts";
import { LABEL_SPECS, type LabelKind, type LabelSpec } from "./sceneSpec.ts";
import type { DeskBotRoutePreview, DeskBotTravelVisual } from "../deskbot/routeVisual.ts";
import type { DeskBotEnvironment, DeskBotLocation } from "../deskbot/types.ts";
import { createEnvironmentEffects } from "./environmentEffects.ts";
import { activityProgressAt, type SceneLifeActivity } from "../deskbot/activityProjection.ts";
import { sceneEnvironmentAt } from "./sceneEnvironment.ts";
import { sceneWorkAnchor } from './sceneWorkplace.ts';

export interface TownScene3DProps {
  sceneLocations?: readonly DeskBotLocation[];
  environment?: DeskBotEnvironment;
  activities?: readonly SceneLifeActivity[];
  focusLocationId?: string | null;
  focusRequest?: number;
  citizens: readonly Citizen[];
  labels?: readonly LabelSpec[];
  positions: Map<number, Point>;
  durations: Map<number, number>;
  actions: Map<number, Action | null>;
  focusedAction: Action | null;
  showDecisions: boolean;
  /** Looks up the accessible HTML hotspot for a citizen, positioned over its figure every frame. */
  getHotspot: (citizenId: number) => HTMLElement | null;
  onPlaceClick?: (locationId: string) => void;
  travelVisual?: DeskBotTravelVisual | null;
  routePreview?: DeskBotRoutePreview | null;
  /** Called with the zoom level (1 = the default framing) whenever it changes. */
  onZoomChange: (zoom: number) => void;
  onContextLost: () => void;
}

export interface TownScene3DHandle {
  zoomBy: (factor: number) => void;
  fitTown: () => void;
  resetView: () => void;
  rotateBy: (radians: number) => void;
  focusPlace: (locationId: string) => void;
}

const DEFAULT_AZIMUTH = Math.PI / 4;
const DEFAULT_ELEVATION = THREE.MathUtils.degToRad(38);
const MIN_ELEVATION = THREE.MathUtils.degToRad(22);
const MAX_ELEVATION = THREE.MathUtils.degToRad(72);
/** Zoom is relative to "the whole town fits"; the default view is a closer, street-level framing. */
const DEFAULT_ZOOM = 2;
const FIT_ZOOM = 1;
const MIN_ZOOM = 0.85;
const MAX_ZOOM = 9;
const CAMERA_DISTANCE = 220;
const ROTATE_SPEED = 0.006;
const VIEW_TWEEN_MS = 420;
const PULSE_MS = 760;

/**
 * On-screen scale (pixels per map unit) at which each kind of label appears,
 * so small screens and zoomed-out views aren't a wall of overlapping pills.
 */
const LABEL_MIN_SCALE: Record<LabelKind, number> = {
  quarter: 0,
  plaza: 6,
  landmark: 6,
  work: 7.5,
  home: 12,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function disposeRoutePreview(group: THREE.Group): void {
  for (const child of [...group.children]) {
    child.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    });
    group.remove(child);
  }
}

function renderRoutePreview(group: THREE.Group, preview: DeskBotRoutePreview | null | undefined): void {
  disposeRoutePreview(group);
  if (!preview || preview.points.length < 2) return;

  const worldPoints = preview.points.map((point) => {
    const world = mapToWorld(point.x, point.y);
    return new THREE.Vector3(world.x, 0.35, world.z);
  });
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(worldPoints),
    new THREE.LineBasicMaterial({ color: 0x2f7f87, transparent: true, opacity: 0.92, depthWrite: false }),
  );
  line.name = "deskbot-route-line";
  line.renderOrder = 4;
  group.add(line);

  const locationWorldPoints = preview.locationPoints.map((point) => {
    const world = mapToWorld(point.x, point.y);
    return new THREE.Vector3(world.x, 0.5, world.z);
  });
  for (let index = 1; index < preview.locationIds.length; index += 1) {
    const isDestination = index === preview.locationIds.length - 1;
    const markerPoint = locationWorldPoints[index] ?? worldPoints[worldPoints.length - 1]!;
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(isDestination ? 1.7 : 1.15, isDestination ? 1.7 : 1.15, 0.22, 24),
      new THREE.MeshBasicMaterial({
        color: isDestination ? 0xd47a3f : 0xd1a443,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    marker.name = isDestination ? "deskbot-route-destination" : "deskbot-route-transfer";
    marker.position.copy(markerPoint);
    marker.position.y = 0.5;
    marker.renderOrder = 5;
    group.add(marker);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(isDestination ? 2.1 : 1.45, isDestination ? 2.35 : 1.7, 24),
      new THREE.MeshBasicMaterial({
        color: isDestination ? 0xd47a3f : 0xd1a443,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.name = "deskbot-route-marker-ring";
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(markerPoint);
    ring.position.y = 0.62;
    ring.renderOrder = 5;
    group.add(ring);
  }
}

interface ViewState {
  azimuth: number;
  elevation: number;
  zoom: number;
  targetX: number;
  targetZ: number;
}

interface CitizenEntry {
  citizen: Citizen;
  figure: CitizenFigure;
  badgeEl: HTMLSpanElement;
  route: RoutePoint[];
  routeLength: number;
  startedAt: number;
  duration: number;
  /** Where the figure is right now, in map space. */
  current: RoutePoint;
  target: RoutePoint;
  action: Action | null;
  pulseAt: number | null;
  phase: number;
  workOffset: THREE.Vector3;
}

/**
 * Owns the Three.js scene graph and render loop for the town: a WebGL canvas
 * with an orthographic, isometric-style camera (drag to pan, right-drag or
 * Shift-drag to rotate, wheel/pinch to zoom), the merged static scenery, and
 * one figure per citizen that walks the street grid to wherever its latest
 * Jev decision sends it.
 *
 * Citizens' accessible hotspots are positioned by writing transforms directly
 * onto their DOM nodes each frame, so camera motion never re-renders React.
 */
export const TownScene3D = forwardRef<TownScene3DHandle, TownScene3DProps>(function TownScene3D(
  { citizens, labels = LABEL_SPECS, sceneLocations, environment, activities, focusLocationId, focusRequest, positions, durations, actions, focusedAction, showDecisions, getHotspot, onPlaceClick, travelVisual, routePreview, onZoomChange, onContextLost },
  ref,
) {
  // World revisions replace object identities frequently. Scene construction is
  // keyed by the actual actors/places instead, so a map refresh cannot reset a
  // citizen halfway through an authoritative travel segment.
  const citizenKey = citizens.map((citizen) => `${citizen.id}:${citizen.palette}:${citizen.residentStyle??""}`).join(",");
  const labelKey = labels.map((label) => `${label.id}:${label.label}:${label.x}:${label.z}:${label.height}`).join("|");
  const sceneryKey=JSON.stringify(sceneLocations?.map(place=>[place.location_id,place.presentation,place.areas?.map(a=>a.objects?.map(o=>o.object_id))]));
  const sceneLocationsRef=useRef(sceneLocations);sceneLocationsRef.current=sceneLocations;
  const environmentRef=useRef(environment);environmentRef.current=environment;
  const activitiesRef=useRef(activities);activitiesRef.current=activities;
  const focusLocationRef=useRef(focusLocationId);focusLocationRef.current=focusLocationId;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ getHotspot, onPlaceClick, onZoomChange, onContextLost });
  callbacksRef.current = { getHotspot, onPlaceClick, onZoomChange, onContextLost };

  const apiRef = useRef<TownScene3DHandle | null>(null);
  const entriesRef = useRef<Map<number, CitizenEntry> | null>(null);
  const routePreviewGroupRef = useRef<THREE.Group | null>(null);
  const routePreviewRef = useRef<DeskBotRoutePreview | null | undefined>(routePreview);
  routePreviewRef.current = routePreview;
  const requestFrameRef = useRef<() => void>(() => {});
  const initialPositionsRef = useRef(positions);

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => apiRef.current?.zoomBy(factor),
    fitTown: () => apiRef.current?.fitTown(),
    resetView: () => apiRef.current?.resetView(),
    rotateBy: (radians) => apiRef.current?.rotateBy(radians),
    focusPlace: (locationId) => apiRef.current?.focusPlace(locationId),
  }));

  // Mount-only: builds the scene, starts the loop, wires input. Citizens are keyed by
  // stable id and never re-created; the effects below mutate them in place.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    const handleReducedMotion = () => {
      reducedMotion = reducedMotionQuery.matches;
    };
    reducedMotionQuery.addEventListener("change", handleReducedMotion);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      callbacksRef.current.onContextLost();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Filmic response keeps the sunlit roofs from clipping to flat white.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    const canvas = renderer.domElement;
    canvas.className = "town-map__canvas";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      callbacksRef.current.onContextLost();
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = "town-map__labels";
    container.appendChild(labelRenderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);

    // --- Lighting: soft sky fill plus a warm low sun for readable shadows ---
    const sky=new THREE.HemisphereLight(0xfffaf0, 0x8fb07a, 1.15);scene.add(sky);
    // A dim fill from the opposite side keeps shadowed walls readable.
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
    fill.position.set(60, 45, -70);
    scene.add(fill);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    sun.position.set(-45, 90, 55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const shadowSpan = Math.max(MAP_W, MAP_H) * 0.72;
    Object.assign(sun.shadow.camera, {
      left: -shadowSpan,
      right: shadowSpan,
      top: shadowSpan,
      bottom: -shadowSpan,
      near: 10,
      far: 600,
    });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.radius = 2.5;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    scene.add(sun.target);

    // --- Static scenery ---
    const scenery = buildTownScenery(sceneLocations);
    let appliedSceneLocations=sceneLocations;
    scene.add(scenery.root);
    const environmentEffects=createEnvironmentEffects(scene,sky,sun,fill,scenery.companion,scenery.updateVegetation);

    const routePreviewGroup = new THREE.Group();
    routePreviewGroup.name = "deskbot-route-preview";
    routePreviewGroupRef.current = routePreviewGroup;
    scene.add(routePreviewGroup);
    renderRoutePreview(routePreviewGroup, routePreviewRef.current);

    const labelObjects: Array<{ id: string; object: CSS2DObject; kind: LabelKind }> = [];
    for (const label of labels) {
      const el = document.createElement(onPlaceClick ? "button" : "div");
      if (el instanceof HTMLButtonElement) {
        el.type = "button";
        el.setAttribute("aria-label", `查看地点：${label.label}`);
        el.addEventListener("click", () => callbacksRef.current.onPlaceClick?.(label.id));
      }
      el.className = `place-label place-label--${label.kind}${onPlaceClick ? " place-label--interactive" : ""}`;
      el.textContent = label.label;
      const object = new CSS2DObject(el);
      object.position.set(label.x, label.height, label.z);
      object.center.set(0.5, 1);
      scene.add(object);
      labelObjects.push({ id: label.id, object, kind: label.kind });
    }

    // --- Citizens ---
    initialPositionsRef.current = positions;
    const entries = new Map<number, CitizenEntry>();
    const now0 = performance.now();
    for (const citizen of citizens) {
      const figure = createCitizenFigure(citizen.palette, citizen.id,citizen.residentStyle);
      const start = initialPositionsRef.current.get(citizen.id) ?? { x: MAP_W / 2, y: MAP_H / 2 };
      const world = mapToWorld(start.x, start.y);
      figure.group.position.set(world.x, 0, world.z);
      scene.add(figure.group);

      const badgeEl = document.createElement("span");
      badgeEl.className = "citizen-badge";
      badgeEl.hidden = true;
      const badge = new CSS2DObject(badgeEl);
      badge.position.set(0, CITIZEN_HEAD_HEIGHT + 0.45, 0);
      badge.center.set(0.5, 1);
      figure.group.add(badge);

      entries.set(citizen.id, {
        citizen,
        figure,
        badgeEl,
        route: [start],
        routeLength: 0,
        startedAt: now0,
        duration: 0,
        current: { ...start },
        target: { ...start },
        action: null,
        pulseAt: null,
        phase: (citizen.id * 0.618) % 1,
        workOffset: new THREE.Vector3(),
      });
    }
    entriesRef.current = entries;

    // --- Camera ---
    const view: ViewState = {
      azimuth: DEFAULT_AZIMUTH,
      elevation: DEFAULT_ELEVATION,
      zoom: DEFAULT_ZOOM,
      targetX: 0,
      targetZ: 0,
    };
    let fitHalfHeight = 60;
    let viewport = { width: 1, height: 1 };
    let cameraDirty = true;
    let tween: { from: ViewState; to: ViewState; startedAt: number } | null = null;
    let lastReportedZoom = -1;

    const corner = new THREE.Vector3();
    function computeFitHalfHeight() {
      // Frame the whole slab (plus the tallest roofs) for the current angle and aspect.
      applyCamera(1, 0, 0);
      const aspect = viewport.width / viewport.height;
      let maxX = 0;
      let maxY = 0;
      for (const x of [-MAP_W / 2, MAP_W / 2]) {
        for (const z of [-MAP_H / 2, MAP_H / 2]) {
          for (const y of [-4, 14]) {
            corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
            maxX = Math.max(maxX, Math.abs(corner.x));
            maxY = Math.max(maxY, Math.abs(corner.y));
          }
        }
      }
      fitHalfHeight = Math.max(maxY, maxX / aspect) * 1.03;
    }

    function applyCamera(halfHeight: number, targetX: number, targetZ: number) {
      const aspect = viewport.width / viewport.height;
      const offset = new THREE.Vector3(
        Math.cos(view.elevation) * Math.sin(view.azimuth),
        Math.sin(view.elevation),
        Math.cos(view.elevation) * Math.cos(view.azimuth),
      ).multiplyScalar(CAMERA_DISTANCE);
      camera.position.set(targetX + offset.x, offset.y, targetZ + offset.z);
      camera.lookAt(targetX, 0, targetZ);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }

    function clampTarget() {
      const limit = Math.max(MAP_W, MAP_H) / 2;
      view.targetX = clamp(view.targetX, -limit, limit);
      view.targetZ = clamp(view.targetZ, -limit, limit);
    }

    function updateCamera() {
      clampTarget();
      computeFitHalfHeight();
      applyCamera(fitHalfHeight / view.zoom, view.targetX, view.targetZ);
      cameraDirty = true;
      const zoomLevel = view.zoom / DEFAULT_ZOOM;
      if (Math.abs(zoomLevel - lastReportedZoom) > 0.001) {
        lastReportedZoom = zoomLevel;
        callbacksRef.current.onZoomChange(zoomLevel);
      }
      const pixelsPerUnit = viewport.height / (2 * camera.top);
      for (const { object, kind } of labelObjects) object.visible = pixelsPerUnit >= LABEL_MIN_SCALE[kind];
      requestFrame();
    }

    function animateTo(next: Partial<ViewState>) {
      if (reducedMotion) {
        Object.assign(view, next);
        updateCamera();
        return;
      }
      tween = { from: { ...view }, to: { ...view, ...next }, startedAt: performance.now() };
      requestFrame();
    }

    apiRef.current = {
      zoomBy: (factor) => animateTo({ zoom: clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM) }),
      fitTown: () => animateTo({ zoom: FIT_ZOOM, targetX: 0, targetZ: 0 }),
      resetView: () =>
        animateTo({ azimuth: DEFAULT_AZIMUTH, elevation: DEFAULT_ELEVATION, zoom: DEFAULT_ZOOM, targetX: 0, targetZ: 0 }),
      rotateBy: (radians) => animateTo({ azimuth: view.azimuth + radians }),
      focusPlace: (locationId) => {
        const place = labelObjects.find((item) => item.id === locationId)?.object.position;
        if (!place) return;
        animateTo({ zoom: clamp(Math.max(view.zoom, 4.4), MIN_ZOOM, MAX_ZOOM), targetX: place.x, targetZ: place.z });
      },
    };

    const handleResize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      viewport = { width: clientWidth, height: clientHeight };
      renderer.setSize(clientWidth, clientHeight, false);
      labelRenderer.setSize(clientWidth, clientHeight);
      updateCamera();
      requestFrame();
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // --- Input: drag to pan, right/shift-drag to rotate, wheel/pinch to zoom ---
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    function groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(groundPlane, hit) ? hit.clone() : null;
    }

    function zoomAround(clientX: number, clientY: number, factor: number) {
      const before = groundAt(clientX, clientY);
      view.zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      updateCamera();
      const after = groundAt(clientX, clientY);
      if (before && after) {
        view.targetX += before.x - after.x;
        view.targetZ += before.z - after.z;
        updateCamera();
      }
    }

    function panByPixels(dx: number, dy: number) {
      const worldPerPixel = (2 * camera.top) / viewport.height;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      up.y = 0;
      up.normalize();
      const stretch = 1 / Math.sin(view.elevation);
      view.targetX += -right.x * dx * worldPerPixel + up.x * dy * worldPerPixel * stretch;
      view.targetZ += -right.z * dx * worldPerPixel + up.z * dy * worldPerPixel * stretch;
      updateCamera();
    }

    const pointers = new Map<number, { x: number; y: number }>();
    let dragMode: "pan" | "rotate" | null = null;
    let lastPinch: { distance: number; midX: number; midY: number } | null = null;

    function pinchState() {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return null;
      return { distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
    }

    const handlePointerDown = (event: PointerEvent) => {
      tween = null;
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      dragMode = event.button === 2 || event.shiftKey ? "rotate" : "pan";
      lastPinch = pointers.size === 2 ? pinchState() : null;
      container.classList.add("town-map__scene--dragging");
    };

    const handlePointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        const pinch = pinchState();
        if (pinch && lastPinch) {
          zoomAround(pinch.midX, pinch.midY, pinch.distance / Math.max(1, lastPinch.distance));
          panByPixels(pinch.midX - lastPinch.midX, pinch.midY - lastPinch.midY);
        }
        lastPinch = pinch;
        return;
      }

      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      if (dragMode === "rotate") {
        view.azimuth -= dx * ROTATE_SPEED;
        view.elevation = clamp(view.elevation + dy * ROTATE_SPEED, MIN_ELEVATION, MAX_ELEVATION);
        updateCamera();
      } else {
        panByPixels(dx, dy);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      lastPinch = pointers.size === 2 ? pinchState() : null;
      if (pointers.size === 0) {
        dragMode = null;
        container.classList.remove("town-map__scene--dragging");
      }
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      tween = null;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomAround(event.clientX, event.clientY, Math.exp(-delta * 0.0015));
    };

    const handleContextMenu = (event: MouseEvent) => event.preventDefault();

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", handleContextMenu);

    // --- Per-frame updates ---
    const projected = new THREE.Vector3();
    function positionHotspots() {
      for (const [id, entry] of entries) {
        const el = callbacksRef.current.getHotspot(id);
        if (!el) continue;
        projected.set(entry.figure.group.position.x, CITIZEN_HEAD_HEIGHT * 0.75, entry.figure.group.position.z).project(camera);
        const x = (projected.x * 0.5 + 0.5) * viewport.width;
        const y = (1 - (projected.y * 0.5 + 0.5)) * viewport.height;
        const offscreen = x < -20 || y < -20 || x > viewport.width + 20 || y > viewport.height + 20;
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        el.style.visibility = offscreen ? "hidden" : "visible";
      }
    }

    const plaza = mapToWorld(getPlace("plaza").x, getPlace("plaza").y);
    const tower = mapToWorld(getPlace("watchtower").x, getPlace("watchtower").y);
    const workAnchors = new Map<string, THREE.Vector3>();
    let previousCitizenFrame = performance.now();

    function updateCitizens(now: number): boolean {
      let moving = false;
      const t = now / 1000;
      const wallNow = Date.now();
      const activityById = new Map(activitiesRef.current?.map((activity) => [activity.citizenId, activity]));
      const night = environmentRef.current ? sceneEnvironmentAt(environmentRef.current,wallNow).night : 0;
      const blend = reducedMotion ? 1 : 1 - Math.exp(-Math.min(.1, Math.max(0,(now-previousCitizenFrame)/1000))*3);
      previousCitizenFrame = now;
      for (const entry of entries.values()) {
        const { figure } = entry;
        const activity = activityById.get(entry.citizen.id);
        const admittedTravel = activity?.kind === "travel" && activity.route && activity.route.length > 1 ? activity : undefined;
        const progress = admittedTravel ? activityProgressAt(admittedTravel,wallNow) : entry.duration > 0 ? clamp((now - entry.startedAt) / entry.duration, 0, 1) : 1;
        const walking = admittedTravel ? admittedTravel.status === "running" : progress < 1;
        if (walking) moving = true;

        const route = admittedTravel?.route ?? entry.route;
        const sampleDistance = admittedTravel ? progress * routeLength(route) : easeInOutCubic(progress) * entry.routeLength;
        const sample = sampleRoute(route, sampleDistance);
        entry.current = { x: sample.x, y: sample.y };
        const world = mapToWorld(sample.x, sample.y);
        figure.group.position.set(world.x, 0, world.z);
        let workAnchor:THREE.Vector3|undefined;
        if(activity && !admittedTravel && activity.targetObjectId) {
          workAnchor = workAnchors.get(activity.taskId);
          const object = scenery.companion?.objects.get(activity.targetObjectId);
          if(!workAnchor && object) {
            workAnchor = sceneWorkAnchor(object, new THREE.Vector3(world.x,0,world.z));
            workAnchors.set(activity.taskId,workAnchor);
            if(workAnchors.size>64)workAnchors.delete(workAnchors.keys().next().value!);
          }
        }
        const targetOffset = workAnchor ? new THREE.Vector3(workAnchor.x-world.x,0,workAnchor.z-world.z) : new THREE.Vector3();
        if(entry.workOffset.distanceToSquared(targetOffset)>.0001)moving=true;
        entry.workOffset.lerp(targetOffset,blend);
        figure.group.position.add(entry.workOffset);

        // Face the direction of travel; once arrived, face what the decision is about.
        let facing = figure.group.rotation.y;
        if (walking) facing = Math.PI / 2 - sample.heading;
        else if(workAnchor) facing = Math.atan2(world.x-workAnchor.x,world.z-workAnchor.z)+Math.PI;
        else if (entry.action === "INVESTIGATE" || entry.action === "JOIN")
          facing = Math.atan2(plaza.x - world.x, plaza.z - world.z);
        else if (entry.action === "WARN") facing = Math.atan2(tower.x - world.x, tower.z - world.z);
        figure.group.rotation.y = facing;

        const { armLeft, armRight, legLeft, legRight } = figure.limbs;
        let lift = 0;
        let lean = 0;
        let swing = 0;
        let armLeftAngle = 0;
        let armRightAngle = 0;

        if (reducedMotion) {
          armLeft.rotation.x = 0;
          armRight.rotation.x = 0;
          legLeft.rotation.x = 0;
          legRight.rotation.x = 0;
          figure.body.position.y = 0;
          figure.body.rotation.x = 0;
        } else {
          const phase = entry.phase * Math.PI * 2;
          if (walking) {
            // Drive the cycle off distance covered, so strides match the ground.
            const stride = sampleDistance * 1.15 + phase;
            swing = Math.sin(stride) * 0.72;
            armLeftAngle = -swing * 0.8;
            armRightAngle = swing * 0.8;
            lift = Math.abs(Math.cos(stride)) * 0.08;
            lean = 0.1;
          } else if (entry.action === "JOIN") {
            // Cheering in the square: hands up, bouncing on the spot.
            const beat = Math.sin(t * 5 + phase);
            lift = Math.max(0, beat) * 0.35;
            armLeftAngle = -2.5 + beat * 0.25;
            armRightAngle = -2.5 - beat * 0.25;
          } else if (entry.action === "WARN") {
            // One arm waving at the tower.
            armLeftAngle = -2.6 + Math.sin(t * 9 + phase) * 0.45;
            armRightAngle = 0.15;
            lift = Math.max(0, Math.sin(t * 9 + phase)) * 0.12;
          } else {
            const idle = Math.sin(t * 1.5 + phase);
            lift = idle * 0.02;
            armLeftAngle = idle * 0.07;
            armRightAngle = -idle * 0.07;
          }

          armLeft.rotation.x = armLeftAngle;
          armRight.rotation.x = armRightAngle;
          legLeft.rotation.x = swing;
          legRight.rotation.x = -swing;
          figure.body.position.y = lift;
          figure.body.rotation.x = lean;
        }
        figure.updateLife?.(t, activity?.status === "paused" ? "idle" : activity?.kind ?? "idle", walking, reducedMotion,night,activity?.activityId);
        if(sceneLocationsRef.current) {
          const glyph = activity?.status === "paused" ? "Ⅱ" : activity?.kind === "travel" ? "↗" : activity?.kind === "rest" ? "☾" : activity?.kind === "craft" ? "✦" : activity?.kind === "care" ? "♧" : activity?.kind === "eat" ? "◡" : activity ? "⋯" : "";
          entry.badgeEl.textContent = glyph;
          entry.badgeEl.title = activity?.title ?? "";
          entry.badgeEl.className = `citizen-badge citizen-badge--life${activity?.status === "paused" ? " is-paused" : ""}`;
          entry.badgeEl.hidden = !activity || viewport.height / (2 * camera.top) < 8;
        }

        if (entry.pulseAt !== null) {
          const age = now - entry.pulseAt;
          const ring = figure.pulseRing;
          if (age >= 0 && age <= PULSE_MS && !reducedMotion) {
            const k = age / PULSE_MS;
            ring.visible = true;
            ring.scale.setScalar(1 + easeOutQuad(k) * 2.6);
            ring.material.opacity = 0.85 * (1 - k);
            moving = true;
          } else if (age > PULSE_MS || reducedMotion) {
            ring.visible = false;
            entry.pulseAt = null;
          } else {
            moving = true;
          }
        }
      }
      return moving;
    }

    let frameRequested = false;
    let visible = true;
    function requestFrame() {
      if (frameRequested || !visible) return;
      frameRequested = true;
      rafId = requestAnimationFrame(render);
    }
    requestFrameRef.current = requestFrame;

    let rafId = 0;
    function render(now: number) {
      frameRequested = false;

      if (tween) {
        const k = clamp((now - tween.startedAt) / VIEW_TWEEN_MS, 0, 1);
        const e = easeInOutCubic(k);
        view.azimuth = tween.from.azimuth + (tween.to.azimuth - tween.from.azimuth) * e;
        view.elevation = tween.from.elevation + (tween.to.elevation - tween.from.elevation) * e;
        view.zoom = tween.from.zoom * (tween.to.zoom / tween.from.zoom) ** e;
        view.targetX = tween.from.targetX + (tween.to.targetX - tween.from.targetX) * e;
        view.targetZ = tween.from.targetZ + (tween.to.targetZ - tween.from.targetZ) * e;
        updateCamera();
        if (k >= 1) tween = null;
      }

      const citizensMoving = updateCitizens(now);

      const warnCount = [...entries.values()].filter((e) => e.action === "WARN").length;
      if (scenery.bell) {
        scenery.bell.rotation.z = warnCount > 0 && !reducedMotion ? Math.sin(now / 180) * 0.45 : 0;
      }
      if (!reducedMotion && scenery.fountainJets.visible) updateFountainJets(scenery.fountainJets, now / 1000);
      if(sceneLocationsRef.current && sceneLocationsRef.current!==appliedSceneLocations){scenery.companion?.applyState(sceneLocationsRef.current);appliedSceneLocations=sceneLocationsRef.current;}
      environmentEffects.update(environmentRef.current,now/1000,reducedMotion,Date.now(),activitiesRef.current);
      if (environmentRef.current) {
        const lighting = sceneEnvironmentAt(environmentRef.current);
        scenery.updateDomesticLights?.(lighting.minute, lighting.night);
      }

      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      if (cameraDirty || citizensMoving || tween) positionHotspots();
      cameraDirty = false;

      // The fountain and idle crowd animate continuously; with reduced motion we only
      // render when something actually changes.
      if (!reducedMotion || citizensMoving || tween) requestFrame();
    }

    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) requestFrame();
    });
    intersection.observe(container);

    handleResize();
    if(focusLocationRef.current)apiRef.current?.focusPlace(focusLocationRef.current);
    updateFountainJets(scenery.fountainJets, 0);
    requestFrame();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      intersection.disconnect();
      reducedMotionQuery.removeEventListener("change", handleReducedMotion);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("contextmenu", handleContextMenu);

      environmentEffects.dispose();
      scenery.dispose();
      disposeRoutePreview(routePreviewGroup);
      routePreviewGroupRef.current = null;
      for (const entry of entries.values()) disposeObject(entry.figure.group);
      scene.clear();
      renderer.dispose();
      container.removeChild(canvas);
      container.removeChild(labelRenderer.domElement);
      apiRef.current = null;
      entriesRef.current = null;
      requestFrameRef.current = () => {};
    };
  }, [citizenKey, labelKey, sceneryKey, onPlaceClick]);

  useEffect(()=>{if(focusLocationId)apiRef.current?.focusPlace(focusLocationId);},[focusLocationId,focusRequest,citizenKey,labelKey,sceneryKey]);
  // An expired observation or a minute change still updates a reduced-motion view.
  useEffect(()=>{requestFrameRef.current();const timer=setInterval(()=>requestFrameRef.current(),15000);return()=>clearInterval(timer);},[environment]);

  // The route preview is a separate, static overlay. Keeping it out of the
  // mount-only scene effect lets a selected destination update without
  // rebuilding the town or interrupting a citizen's animation.
  useEffect(() => {
    const group = routePreviewGroupRef.current;
    if (!group) return;
    renderRoutePreview(group, routePreview);
    requestFrameRef.current();
  }, [routePreview]);

  // Walk each citizen along the streets to their new position whenever the game moves them.
  useEffect(() => {
    const entries = entriesRef.current;
    if (!entries) return;
    const now = performance.now();
    for (const [id, entry] of entries) {
      const target = positions.get(id);
      if (!target) continue;
      if (Math.abs(target.x - entry.target.x) < 0.01 && Math.abs(target.y - entry.target.y) < 0.01) continue;
      const route = routeBetween(entry.current, target);
      entry.route = route;
      entry.routeLength = routeLength(route);
      entry.startedAt = now;
      entry.duration = durations.get(id) ?? 1200;
      entry.target = { ...target };
    }
    requestFrameRef.current();
  }, [positions, durations]);

  // A DeskBot route step is authoritative for the protagonist's visual segment.
  // Keep the normal Jev Town street routing for every other citizen.
  useEffect(() => {
    const entries = entriesRef.current;
    if (!entries || !travelVisual) return;
    const entry = entries.get(travelVisual.citizenId);
    if (!entry) return;
    const target = travelVisual.to;
    // Keep each server-authorized hop separate, while reusing the town's
    // street-grid renderer so a hop does not visually cut through buildings.
    entry.route = travelVisual.route.length >= 2
      ? travelVisual.route.map((point) => ({ ...point }))
      : routeBetween(travelVisual.from, target);
    entry.routeLength = routeLength(entry.route);
    entry.startedAt = performance.now();
    entry.duration = travelVisual.durationMs;
    entry.current = { ...travelVisual.from };
    entry.target = { ...target };
    requestFrameRef.current();
  }, [travelVisual]);

  // A new set of decisions: every citizen who got one pulses, staggered a little so
  // the whole town visibly "lights up" at once.
  useEffect(() => {
    const entries = entriesRef.current;
    if (!entries) return;
    const now = performance.now();
    let index = 0;
    for (const [id, entry] of entries) {
      const action = actions.get(id) ?? null;
      entry.action = action;
      if (action) {
        entry.pulseAt = now + (index % 25) * 14;
        entry.figure.pulseRing.material.color.set(actionColor(action));
        entry.badgeEl.textContent = ACTION_GLYPH[action];
        entry.badgeEl.style.background = toCssHex(actionColor(action));
        entry.badgeEl.title = ACTION_LABEL[action];
        entry.badgeEl.classList.remove("citizen-badge--pop");
        void entry.badgeEl.offsetWidth; // restart the pop animation
        entry.badgeEl.classList.add("citizen-badge--pop");
      }
      index += 1;
    }
    requestFrameRef.current();
  }, [actions]);

  // Badge visibility and the focus highlight from the reaction legend.
  useEffect(() => {
    const entries = entriesRef.current;
    if (!entries) return;
    for (const [id, entry] of entries) {
      const action = actions.get(id) ?? null;
      entry.badgeEl.hidden = !action || !showDecisions;
      const highlighted = focusedAction !== null && action === focusedAction;
      entry.figure.focusRing.visible = highlighted;
      if (highlighted) entry.figure.focusRing.material.color.set(actionColor(action));
      entry.figure.upper.material.emissive.set(highlighted ? actionColor(action) : 0x000000);
      entry.figure.upper.material.emissiveIntensity = highlighted ? 0.3 : 0;
    }
    requestFrameRef.current();
  }, [actions, focusedAction, showDecisions]);

  return <div ref={containerRef} className="town-map__canvas-host" />;
});
