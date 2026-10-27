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
    if (['run', 'roll', 'flight', 'board_run', 'board_roll'].includes(name) || /^run\d/.test(name)) {
      next.setLoop(THREE.LoopRepeat); next.clampWhenFinished = false;
      if (name === 'roll') next.setDuration(duration || clips[name].duration);
      else next.timeScale = 1;
    }
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

// Unlike Jake, these exported meshes are in the Animation-root bind frame.
// Parenting them to the original renderer's bone node would apply its TRS twice.
export function chaserFromUnity(name, info, rig, meshData, animations, textures = {}) {
  const native = new THREE.Group(); native.name = `Recovered_${name}`;
  const byId = new Map(), byPath = new Map([['', native]]);
  for (const source of rig.nodes) {
    const node = new THREE.Bone(); node.name = source.name;
    node.position.fromArray(source.position); node.quaternion.fromArray(source.quaternion); node.scale.fromArray(source.scale);
    byId.set(source.id, node); byPath.set(source.path, node);
  }
  for (const source of rig.nodes) (byId.get(source.parentId) ?? native).add(byId.get(source.id));
  native.updateMatrixWorld(true);
  for (const binding of info.meshes) {
    if (binding.browserMeshParent !== 'animationRoot') throw new Error(`追逐角色绑定坐标未验证：${name}`);
    const data = meshData[binding.key], bones = binding.bones.map(id => byId.get(id));
    if (bones.some(b => !b)) throw new Error(`追逐角色骨骼缺失：${name}`);
    const mesh = new THREE.SkinnedMesh(geometryFromUnity(data), sourceMaterials(data, binding.materials, textures));
    mesh.name = binding.key; native.add(mesh);
    new THREE.Matrix4().set(...binding.browserMeshLocalMatrix).decompose(mesh.position, mesh.quaternion, mesh.scale);
    native.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones, data.inverseBindMatrices.map(m => new THREE.Matrix4().set(...m))), new THREE.Matrix4().set(...binding.bindMatrix));
    mesh.castShadow = true; mesh.frustumCulled = false;
  }
  const clips = Object.fromEntries(Object.entries(animations).map(([key, data]) => [key, clipFromUnity(data, byPath)]));
  const mixer = new THREE.AnimationMixer(native);
  const actions = Object.fromEntries(Object.entries(clips).map(([key, clip]) => [key, mixer.clipAction(clip)]));
  let current = null, currentToken = null;
  function setAnimation(key, duration, token = null) {
    if (!actions[key]) key = 'run';
    if (key === current && token === currentToken) return;
    const action = actions[key]; action.reset();
    action.setLoop(key === 'run' ? THREE.LoopRepeat : THREE.LoopOnce, key === 'run' ? Infinity : 1);
    action.clampWhenFinished = key !== 'run'; action.setDuration(duration ?? clips[key].duration); action.play();
    if (current && current !== key) actions[current].crossFadeTo(action, .08, false);
    current = key; currentToken = token;
  }
  const root = info.rootTransform;
  native.position.fromArray(root.position); native.quaternion.fromArray(root.quaternion); native.scale.fromArray(root.scale);
  const conversion = new THREE.Group(); conversion.add(native);
  // Browser presentation fit beside the 1.95m replacement player, not a native gameplay constant.
  conversion.scale.set(.15, .15, -.15);
  const wrapper = new THREE.Group(); wrapper.add(conversion); setAnimation('run');
  return { object: wrapper, native, mixer, setAnimation, source: 'apk', animationNames: Object.keys(clips),
    animationDiagnostics: Object.fromEntries(Object.entries(clips).map(([key, clip]) => [key, clip.userData])) };
}

function prefabFromUnity(data, meshData, textures, manifest) {
  const native = new THREE.Group(), byId = new Map();
  for (const source of data.nodes) {
    const node = new THREE.Group(); node.name = source.name;
    node.position.fromArray(source.position); node.quaternion.fromArray(source.quaternion); node.scale.fromArray(source.scale);
    node.visible = source.active !== false;
    if (source.mesh && source.rendererEnabled !== false && meshData[source.mesh]) {
      const geometry = geometryFromUnity(meshData[source.mesh]);
      const mesh = new THREE.Mesh(geometry, sourceMaterials(meshData[source.mesh], source.materials ?? [], textures));
      for (const index of manifest.meshes[source.mesh]?.renderHints?.skipSubmeshes ?? []) if (mesh.material[index]) mesh.material[index].visible = false;
      mesh.castShadow = true; mesh.receiveShadow = true; node.add(mesh);
    }
    node.userData.sourceNodeId = source.id; byId.set(source.id, node);
  }
  for (const source of data.nodes) (byId.get(source.parentId) ?? native).add(byId.get(source.id));
  for (const source of data.nodes) for (const script of source.scripts ?? []) {
    if (script.class !== 'PickupRotate') continue;
    const fields = script.decodedFields, target = byId.get(fields?._target?.pathId);
    if (target) target.userData.pickupRotator = { speed: fields._speed, phase: fields._rotatePhase };
  }
  native.scale.set(0.1, 0.1, -0.1);
  const wrapper = new THREE.Group(); wrapper.name = data.name; wrapper.add(native); return wrapper;
}

export async function loadRecoveredPack(base = '/assets/recovered/', { includeChasers = true } = {}) {
  const manifest = await fetchJson(`${base}manifest.json`);
  const oldChaserMeshes = new Set(Object.values(manifest.chaserActors ?? {}).flatMap(actor => actor.meshes.map(mesh => mesh.key)));
  const meshEntries = Object.entries(manifest.meshes).filter(([name]) => includeChasers || !oldChaserMeshes.has(name));
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
  const routeLibraryPath = typeof manifest.routeLibrary === 'string' ? manifest.routeLibrary : manifest.routeLibrary?.file;
  const routeLibrary = routeLibraryPath ? await fetchJson(base + routeLibraryPath) : null;
  if (routeLibrary && manifest.classicCollisionIndex) routeLibrary.collisionTags = await fetchJson(base + manifest.classicCollisionIndex);
  if (routeLibrary?.modelBindingsFile) {
    routeLibrary.modelBindings = await fetchJson(base + routeLibrary.modelBindingsFile);
    for (const binding of Object.values(routeLibrary.modelBindings.byDefinitionRef ?? {})) {
      if (!prefabData[binding.prefabKey]) throw new Error(`关卡模型缺失：${binding.prefabKey}`);
    }
  }
  const environmentPath = manifest.environmentBindings ?? routeLibrary?.environmentBindingsFile;
  const environmentBindings = environmentPath ? await fetchJson(base + (typeof environmentPath === 'string' ? environmentPath : environmentPath.file)) : null;
  const classicBindings = manifest.classicAnimationParameters ? await fetchJson(base + manifest.classicAnimationParameters) : null;
  const classicAudio = manifest.classicAudio ? await fetchJson(base + manifest.classicAudio) : null;
  const classicMotionPools = manifest.classicMotionPools ? await fetchJson(base + manifest.classicMotionPools) : {};
  const character = characterFromUnity({ jake_Mesh: meshData.jake_Mesh, jake_head: meshData.jake_head }, rig, textures.jake_tex_low, animations);
  const chasers = Object.fromEntries(await Promise.all(Object.entries(includeChasers ? manifest.chaserActors ?? {} : {}).map(async ([name, info]) => {
    const [actorRig, actorClips] = await Promise.all([fetchJson(base + info.rig.file), Promise.all(Object.entries(info.animations).map(async ([key, value]) => [key, await fetchJson(base + value.file)]))]);
    return [name, chaserFromUnity(name, info, actorRig, meshData, Object.fromEntries(actorClips), textures)];
  })));
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
  const prefabs = Object.fromEntries(Object.entries(prefabData).map(([name, data]) => [name, prefabFromUnity(data, meshData, textures, manifest)]));
  return { manifest, character, chasers, props, prefabs, prefabData, textures, meshData, routeLibrary, environmentBindings, classicBindings, classicAudio, classicMotionPools,
    cloneProp: name => props[name]?.clone(true), clonePrefab: name => prefabs[name]?.clone(true) };
}

export async function characterFromGLB(buffer, { name = '自定义角色', source = 'import' } = {}) {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const wrapper = new THREE.Group(), native = gltf.scene;
  native.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(native), size = box.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y < 0.0001) throw new Error('模型缺少有效几何');
  const scale = 1.95 / size.y;
  native.scale.multiplyScalar(scale);
  native.rotation.y = Math.PI;
  native.updateMatrixWorld(true);
  const aligned = new THREE.Box3().setFromObject(native);
  native.position.add(new THREE.Vector3(-(aligned.min.x + aligned.max.x) / 2, -aligned.min.y, -(aligned.min.z + aligned.max.z) / 2));
  native.traverse(object => { if (object.isMesh) { object.castShadow = true; object.frustumCulled = false; } });
  wrapper.add(native);
  const mixer = new THREE.AnimationMixer(native);
  const actions = new Map();
  for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
  let playing = null, playingToken = null, catchBase = null;
  function setAnimation(name, duration, token = null, options = {}) {
    const fallback = name.startsWith('board_') ? name.slice(6) : name === 'flight' ? 'jump' : name;
    const match = actions.has(name) ? name : actions.has(fallback) ? fallback : [...actions.keys()].find(key => key.toLowerCase().includes(fallback)) ?? [...actions.keys()][0];
    if (!match || playing === match && playingToken === token) return;
    const action = actions.get(match); action.reset().setEffectiveWeight(1);
    // Physics owns the source roll deadline. Looping through the final fixed
    // step avoids a clamped frozen pose; new accepted rolls have new tokens.
    if (['run', 'roll', 'flight', 'board_run', 'board_roll'].includes(name) || /^run\d/.test(name)) {
      action.setLoop(THREE.LoopRepeat); action.clampWhenFinished = false;
      if (name.endsWith('roll')) action.setDuration(duration || action.getClip().duration);
      else action.timeScale = 1;
    }
    else { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.setDuration(duration || action.getClip().duration); }
    action.play();
    if (playing && playing !== match) actions.get(playing).crossFadeTo(action, options.fade ?? 0.08, false);
    playing = match; playingToken = token;
  }
  function setTimeScale(value) { if (playing) actions.get(playing).setEffectiveTimeScale(value); }
  function setCatchAnimation(name, time, weight, token) {
    const action = actions.get(name);
    if (!action) return;
    if (playingToken !== token || playing !== name) {
      catchBase = playing;
      for (const [key, other] of actions) {
        other.stopFading();
        if (key !== catchBase && key !== name) other.stop();
      }
      action.reset().setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
      playing = name; playingToken = token;
    }
    if (catchBase && catchBase !== name) actions.get(catchBase).setEffectiveWeight(1 - weight);
    action.time = Math.min(time, action.getClip().duration); action.setEffectiveWeight(weight);
  }
  setAnimation('run');
  return { object: wrapper, native, mixer, setAnimation, setTimeScale, setCatchAnimation, source, name,
    clipDurations: Object.fromEntries(gltf.animations.map(c => [c.name, c.duration])),
    animationNames: gltf.animations.map(c => c.name) };
}

export async function loadYellowCharacter() {
  const response = await fetch('/assets/character/yellow-runner.glb');
  if (!response.ok) throw new Error(`黄色角色读取失败 (${response.status})`);
  return characterFromGLB(await response.arrayBuffer(), { name: '黄色小怪兽', source: 'hi3d-with-recovered-jake-motion' });
}

export async function loadRedNoseChaser() {
  const response = await fetch('/assets/character/red-nose-chaser.glb');
  if (!response.ok) throw new Error(`追逐角色读取失败 (${response.status})`);
  const actor = await characterFromGLB(await response.arrayBuffer(), { name: '红鼻子追逐者', source: 'hi3d-with-recovered-guard-motion' });
  // Ears are part of the full-body height. A modest fit keeps the torso readable
  // beside the broader yellow player; this affects appearance only.
  actor.object.scale.setScalar(1.15);
  actor.object.position.x = -.28;
  return actor;
}

export { cloneSkeleton };
