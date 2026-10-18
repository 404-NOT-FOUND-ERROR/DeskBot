import * as THREE from 'three';

/** Three light bands and geometry silhouettes shared by the inhabited world.
 * Original colour objects / deformation hooks remain shared with life effects. */
export function createShapingRender() {
  const gradient = new THREE.DataTexture(new Uint8Array([65, 164, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  gradient.name = 'shaping-three-light-bands';
  const converted = new Map<THREE.Material, THREE.MeshToonMaterial>();
  const silhouettes = new Set<THREE.Mesh>();
  const instances: { source: THREE.InstancedMesh; outline: THREE.InstancedMesh }[] = [];
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x263d42, side: THREE.BackSide });
  outlineMaterial.name = 'shaping-ink-silhouette';

  function material(source: THREE.Material) {
    if (!(source instanceof THREE.MeshLambertMaterial || source instanceof THREE.MeshStandardMaterial) || source.transparent) return source;
    const existing = converted.get(source); if (existing) return existing;
    const toon = new THREE.MeshToonMaterial({
      gradientMap: gradient, vertexColors: source.vertexColors,
      side: source.side, map: source.map, alphaTest: source.alphaTest,
      depthWrite: source.depthWrite, polygonOffset: source.polygonOffset,
      polygonOffsetFactor: source.polygonOffsetFactor, polygonOffsetUnits: source.polygonOffsetUnits,
    });
    toon.color = source.color;
    toon.emissive = source.emissive;
    toon.emissiveIntensity = source.emissiveIntensity;
    toon.name = `${source.name || 'surface'}:shaping-toon`;
    toon.onBeforeCompile = source.onBeforeCompile;
    const shaderKey = source.customProgramCacheKey();
    toon.customProgramCacheKey = () => `shaping-toon-v1:${shaderKey}`;
    converted.set(source, toon); return toon;
  }

  function attach(root: THREE.Object3D, character = false) {
    const meshes: THREE.Mesh[] = [];
    root.traverse(object => { if (object instanceof THREE.Mesh && !object.userData.shapingOutline) meshes.push(object); });
    for (const mesh of meshes) {
      const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = Array.isArray(mesh.material) ? sources.map(material) : material(sources[0]!);
      if (silhouettes.has(mesh) || mesh.userData.noOutline || sources.every(source => source.transparent || source instanceof THREE.MeshBasicMaterial)) continue;
      // A terrain mesh needs its external shoreline, not an outline around each
      // triangle. Flat paths, water, soil beds and light pools stay unoutlined.
      if (/terrain|route-surface|clearing|creek|soil|water|ground|path|shore|light-pool|work-surface/.test(mesh.name)) continue;
      mesh.geometry.computeBoundingBox();
      const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      if (!character && Math.max(size.x,size.y,size.z) < .85) continue;
      const geometry = smoothOutlineGeometry(mesh.geometry, character ? .035 : .065);
      // Preserve instanced foliage motion by sharing the same matrix attribute.
      let outline: THREE.Mesh;
      if (mesh instanceof THREE.InstancedMesh) {
        const instanced = new THREE.InstancedMesh(geometry, outlineMaterial, mesh.count);
        instanced.instanceMatrix = mesh.instanceMatrix;
        instances.push({ source: mesh, outline: instanced }); outline = instanced;
      } else outline = new THREE.Mesh(geometry, outlineMaterial);
      // Batched town canopies deform in their vertex shader. Apply precisely
      // the same hook to their hull so foliage does not escape its silhouette.
      if (sources[0]!.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
        const ink = outlineMaterial.clone();
        ink.onBeforeCompile = sources[0]!.onBeforeCompile;
        const key = sources[0]!.customProgramCacheKey();
        ink.customProgramCacheKey = () => `shaping-outline:${key}`;
        outline.material = ink;
      }
      outline.name = `ink:${mesh.name || 'form'}`;
      outline.userData.shapingOutline = true;
      outline.castShadow = false; outline.receiveShadow = false;
      outline.frustumCulled = false;
      outline.raycast = () => {};
      mesh.add(outline); silhouettes.add(mesh);
    }
  }
  function update() {
    for (const [source, target] of converted) {
      target.opacity = source.opacity; target.visible = source.visible;
      if ('emissiveIntensity' in source) target.emissiveIntensity = Number(source.emissiveIntensity);
    }
    for (const pair of instances) { pair.outline.count = pair.source.count; pair.outline.instanceMatrix = pair.source.instanceMatrix; }
  }
  function dispose() {
    // Rendered materials and outline geometries are owned by the scene's normal
    // disposal path. Retained source materials and the shared ramp belong here.
    for (const source of converted.keys()) source.dispose();
    gradient.dispose(); outlineMaterial.dispose(); converted.clear(); silhouettes.clear(); instances.length = 0;
  }
  return { attach, update, dispose, gradient };
}

/** Weld normals by position solely for the hull. The visible surface keeps its
 * flat facet normals; exploding every individual triangle would leave cracks. */
export function smoothOutlineGeometry(source: THREE.BufferGeometry, width: number) {
  const result = source.clone(), position = result.getAttribute('position');
  if (!result.getAttribute('normal')) result.computeVertexNormals();
  const normal = result.getAttribute('normal');
  const sums = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${Math.round(position.getX(i)*10000)},${Math.round(position.getY(i)*10000)},${Math.round(position.getZ(i)*10000)}`;
  for (let i=0;i<position.count;i++) {
    const k=key(i), sum=sums.get(k)??new THREE.Vector3();
    sum.add(new THREE.Vector3(normal.getX(i),normal.getY(i),normal.getZ(i)));sums.set(k,sum);
  }
  for (const vector of sums.values()) vector.normalize();
  for (let i=0;i<position.count;i++) {
    const n=sums.get(key(i))!;
    position.setXYZ(i,position.getX(i)+n.x*width,position.getY(i)+n.y*width,position.getZ(i)+n.z*width);
  }
  result.computeBoundingBox(); result.computeBoundingSphere(); return result;
}
