import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const flatten = values => Array.isArray(values?.[0]) ? values.flat(Infinity) : values;
const textureLoader = new THREE.TextureLoader();

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`资源读取失败：${url} (${response.status})`);
  const text = await response.text();
  if (text.trimStart().startsWith('<')) throw new Error(`尚未提供资源：${url}`);
  return JSON.parse(text);
}

export function geometryFromUnity(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(flatten(data.positions), 3));
  if (data.normals?.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(flatten(data.normals), 3));
  if (data.uv?.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(flatten(data.uv), 2));
  const indices = [];
  for (let i = 0; i < data.submeshes.length; i++) {
    const submesh = flatten(data.submeshes[i]);
    geometry.addGroup(indices.length, submesh.length, i);
    indices.push(...submesh);
  }
  geometry.setIndex(indices);
  if (!data.normals?.length) geometry.computeVertexNormals();
  if (data.boneIndices?.length) {
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(flatten(data.boneIndices), 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(flatten(data.boneWeights), 4));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function hermiteTrack(source, step = 1 / 120) {
  // Unity legacy curves are component-wise cubic Hermite. Resample with original
  // in/out tangents and normalize quaternions; Three then interpolates samples.
  const times = [], values = [], duration = source.times.at(-1);
  const samples = Math.max(1, Math.ceil(duration / step));
  let key = 0;
  for (let index = 0; index <= samples; index++) {
    const time = Math.min(duration, index * duration / samples);
    while (key < source.times.length - 2 && source.times[key + 1] < time) key++;
    const next = Math.min(key + 1, source.times.length - 1);
    const interval = source.times[next] - source.times[key];
    const t = interval > 0 ? Math.max(0, Math.min(1, (time - source.times[key]) / interval)) : 0;
    const value = source.values[key].map((a, dimension) => {
      const b = source.values[next][dimension];
      const out = source.outTangents?.[key]?.[dimension];
      const incoming = source.inTangents?.[next]?.[dimension];
      if (!Number.isFinite(out) || !Number.isFinite(incoming)) return a + (b - a) * t;
      return (2 * t ** 3 - 3 * t ** 2 + 1) * a
        + (t ** 3 - 2 * t ** 2 + t) * interval * out
        + (-2 * t ** 3 + 3 * t ** 2) * b
        + (t ** 3 - t ** 2) * interval * incoming;
    });
    if (source.property === 'quaternion') {
      const magnitude = Math.hypot(...value) || 1;
      for (let i = 0; i < 4; i++) value[i] /= magnitude;
    }
    times.push(time); values.push(...value);
  }
  return { times, values };
}

function clipFromUnity(data, nodesByPath) {
  const tracks = [], skippedTracks = [];
  for (const track of data.tracks) {
    const node = nodesByPath.get(track.path);
    if (!node) { skippedTracks.push({ path: track.path, property: track.property }); continue; }
    const sampled = hermiteTrack(track);
    const Class = track.property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Class(`${node.uuid}.${track.property}`, sampled.times, sampled.values));
  }
  const clip = new THREE.AnimationClip(data.name, data.duration, tracks);
  clip.userData = { skippedTracks, sourceTrackCount: data.tracks.length };
  return clip;
}

function characterFromUnity(meshes, rig, texture, animations) {
  const native = new THREE.Group(); native.name = 'RecoveredJake';
  const byId = new Map(), byPath = new Map();
  for (const source of rig.nodes) {
    const node = new THREE.Bone();
    node.name = source.name;
    node.position.fromArray(source.position);
    node.quaternion.fromArray(source.quaternion);
    node.scale.fromArray(source.scale);
    byId.set(source.id, node); byPath.set(source.path, node);
  }
  for (const source of rig.nodes) (byId.get(source.parentId) ?? native).add(byId.get(source.id));
  native.updateMatrixWorld(true);
  const bones = rig.bones.map(bone => byId.get(bone.nodeId));
  if (bones.some(bone => !bone)) throw new Error('角色骨骼引用不完整');
  for (const [name, data] of Object.entries(meshes)) {
    const geometry = geometryFromUnity(data);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    const materialCount = data.submeshes.length;
    const mesh = new THREE.SkinnedMesh(geometry, Array.from({ length: materialCount }, () => material));
    mesh.name = name;
    const node = byPath.get(name === 'jake_head' ? rig.headNodePath : rig.meshNodePath) ?? native;
    node.add(mesh);
    native.updateMatrixWorld(true);
    const inverses = data.inverseBindMatrices.map(values => new THREE.Matrix4().set(...values));
    const skeleton = new THREE.Skeleton(bones, inverses);
    mesh.bind(skeleton, mesh.matrixWorld.clone());
    mesh.normalizeSkinWeights();
    mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
  }
  const clips = Object.fromEntries(Object.entries(animations).map(([name, data]) => [name, clipFromUnity(data, byPath)]));
  const wrapper = new THREE.Group();
  // Match source geometry's 9.84-unit height to browser play space. Z reflection
  // converts Unity handedness once around the whole skeleton and all meshes.
  native.scale.set(0.195, 0.195, -0.195);
  wrapper.add(native);
  const mixer = new THREE.AnimationMixer(native);
  const actions = Object.fromEntries(Object.entries(clips).map(([name, clip]) => [name, mixer.clipAction(clip)]));
  let current = null;
  function setAnimation(name, duration) {
    if (!actions[name]) name = 'run';
    if (current === name) return;
    const next = actions[name];
    if (!next) return;
    next.reset();
    if (name === 'run') { next.setLoop(THREE.LoopRepeat); next.timeScale = 1; }
    else { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; next.setDuration(duration || clips[name].duration); }
    next.play();
    if (current && actions[current]) actions[current].crossFadeTo(next, 0.08, false);
    current = name;
  }
  setAnimation('run');
  return { object: wrapper, mixer, setAnimation, native, source: 'apk', name: 'Jake', animationNames: Object.keys(clips), animationDiagnostics: Object.fromEntries(Object.entries(clips).map(([name, clip]) => [name, clip.userData])) };
}

function sourceMaterials(data, records, textures) {
  return data.submeshes.map((_, index) => {
    const record = records[index];
    const textureInfo = record?.textures?._MainTex;
    let map = textures[textureInfo?.name] ?? null;
    const name = record?.name?.toLowerCase() ?? '';
    if (name.includes('shadow') || name.includes('glow gold')) return new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    if (map && (textureInfo.scale?.some(v => v !== 1) || textureInfo.offset?.some(v => v !== 0))) {
      map = map.clone();
      map.repeat.fromArray(textureInfo.scale ?? [1, 1]); map.offset.fromArray(textureInfo.offset ?? [0, 0]);
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
    }
    const color = record?.colors?._Color;
    return new THREE.MeshStandardMaterial({ map, color: color ? new THREE.Color().fromArray(color) : 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
  });
}

function prefabFromUnity(data, meshData, textures) {
  const native = new THREE.Group(), byId = new Map();
  for (const source of data.nodes) {
    const node = new THREE.Group(); node.name = source.name;
    node.position.fromArray(source.position); node.quaternion.fromArray(source.quaternion); node.scale.fromArray(source.scale);
    node.visible = source.active !== false;
    if (source.mesh && source.rendererEnabled !== false && meshData[source.mesh]) {
      const geometry = geometryFromUnity(meshData[source.mesh]);
      const mesh = new THREE.Mesh(geometry, sourceMaterials(meshData[source.mesh], source.materials ?? [], textures));
      mesh.castShadow = true; mesh.receiveShadow = true; node.add(mesh);
    }
    node.userData.sourceNodeId = source.id; byId.set(source.id, node);
  }
  for (const source of data.nodes) (byId.get(source.parentId) ?? native).add(byId.get(source.id));
  native.scale.set(0.1, 0.1, -0.1);
  const wrapper = new THREE.Group(); wrapper.name = data.name; wrapper.add(native); return wrapper;
}

export async function loadRecoveredPack(base = '/assets/recovered/') {
  const manifest = await fetchJson(`${base}manifest.json`);
  const meshEntries = Object.entries(manifest.meshes);
  const textures = Object.fromEntries(await Promise.all(Object.entries(manifest.textures).map(async ([name, info]) => {
    const texture = await textureLoader.loadAsync(base + info.file);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return [name, texture];
  })));
  const meshData = Object.fromEntries(await Promise.all(meshEntries.map(async ([name, info]) => [name, await fetchJson(base + info.file)])));
  const rig = await fetchJson(base + manifest.rig.file);
  const animations = Object.fromEntries(await Promise.all(Object.entries(manifest.animations).map(async ([name, info]) => [name, await fetchJson(base + info.file)])));
  const prefabData = Object.fromEntries(await Promise.all(Object.entries(manifest.prefabs ?? {}).map(async ([name, info]) => [name, await fetchJson(base + info.file)])));
  const character = characterFromUnity({ jake_Mesh: meshData.jake_Mesh, jake_head: meshData.jake_head }, rig, textures.jake_tex_low, animations);
  const props = {};
  for (const [name, data] of Object.entries(meshData)) {
    if (name.startsWith('jake')) continue;
    // Use verified material records if available. Unverified pairings retain a
    // neutral material rather than silently presenting guessed texture links.
    const info = manifest.meshes[name];
    const mapped = info.materials ?? [];
    const materials = data.submeshes.map((_, index) => {
      const materialInfo = mapped[index];
      // The extracted coin's second submesh is a hidden sentinel triangle at
      // y=-80, not a second visible coin surface (verified in source mesh).
      if (name === 'currency_coin' && index > 0) return new THREE.MeshBasicMaterial({ visible: false });
      const textureName = materialInfo?.textures?._MainTex?.name ?? materialInfo?.texture ?? info.texture;
      const map = textureName ? textures[textureName] : null;
      if (materialInfo?.name?.toLowerCase().includes('shadow')) {
        return new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      }
      return new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : name === 'track' ? 0x7e8381 : 0xd2cbb5, roughness: 0.85, side: THREE.DoubleSide });
    });
    const mesh = new THREE.Mesh(geometryFromUnity(data), materials);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    const wrapper = new THREE.Group();
    mesh.scale.set(0.1, 0.1, -0.1); wrapper.add(mesh);
    props[name] = wrapper;
  }
  const prefabs = Object.fromEntries(Object.entries(prefabData).map(([name, data]) => [name, prefabFromUnity(data, meshData, textures)]));
  return { manifest, character, props, prefabs, prefabData, textures, meshData, cloneProp: name => props[name]?.clone(true), clonePrefab: name => prefabs[name]?.clone(true) };
}

export async function characterFromGLB(buffer) {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const wrapper = new THREE.Group(), native = gltf.scene;
  native.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(native), size = box.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y < 0.0001) throw new Error('模型缺少有效几何');
  const scale = 1.95 / size.y;
  native.scale.multiplyScalar(scale);
  native.position.set(-(box.min.x + box.max.x) / 2 * scale, -box.min.y * scale, -(box.min.z + box.max.z) / 2 * scale);
  native.rotation.y = Math.PI;
  native.traverse(object => { if (object.isMesh) { object.castShadow = true; object.frustumCulled = false; } });
  wrapper.add(native);
  const mixer = new THREE.AnimationMixer(native);
  const actions = new Map();
  for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
  let playing = null;
  function setAnimation(name) {
    const match = [...actions.keys()].find(key => key.toLowerCase().includes(name)) ?? [...actions.keys()][0];
    if (!match || playing === match) return;
    const action = actions.get(match); action.reset().play();
    if (playing) actions.get(playing).crossFadeTo(action, 0.15, false);
    playing = match;
  }
  setAnimation('run');
  return { object: wrapper, native, mixer, setAnimation, source: 'import', name: '自定义角色', animationNames: gltf.animations.map(c => c.name) };
}

export { cloneSkeleton };
