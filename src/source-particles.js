import * as THREE from 'three';

// Serialized enum values: UnityCsReference ParticleSystemEnums.cs and
// InitialModuleUI.cs (moveWithTransform is the simulation-space property).
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const vector = (v, fallback = 0) => new THREE.Vector3(v?.x ?? fallback, v?.y ?? fallback, v?.z ?? fallback);
const lookup = (items, key) => items instanceof Map ? items.get(key) : items?.[key];
const sourceRef = source => `${source.asset}:${source.pathId}`;

export function evaluateParticleCurve(curve, t, fallback = 0) {
  const keys = curve?.m_Curve ?? [];
  if (!keys.length) return fallback;
  if (t <= keys[0].time) return keys[0].value;
  if (t >= keys.at(-1).time) return keys.at(-1).value;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].time < t) i++;
  const a = keys[i], b = keys[i + 1], span = b.time - a.time;
  if (!Number.isFinite(a.outSlope) || !Number.isFinite(b.inSlope)) return a.value;
  const u = clamp((t - a.time) / span);
  return (2 * u ** 3 - 3 * u ** 2 + 1) * a.value
    + (u ** 3 - 2 * u ** 2 + u) * span * a.outSlope
    + (-2 * u ** 3 + 3 * u ** 2) * b.value
    + (u ** 3 - u ** 2) * span * b.inSlope;
}

export function evaluateParticleMinMax(curve, t, random = .5, fallback = 0) {
  if (!curve) return fallback;
  switch (curve.minMaxState) {
    case 0: return curve.scalar;
    case 1: return evaluateParticleCurve(curve.maxCurve, t) * curve.scalar;
    case 2: return mix(evaluateParticleCurve(curve.minCurve, t), evaluateParticleCurve(curve.maxCurve, t), random) * curve.scalar;
    case 3: return mix(curve.minScalar, curve.scalar, random);
    default: return fallback;
  }
}

function gradient(value, t) {
  if (!value) return [1, 1, 1, 1];
  function channel(alpha) {
    const count = alpha ? value.m_NumAlphaKeys : value.m_NumColorKeys;
    if (!count) return alpha ? 1 : [1, 1, 1];
    const time = i => value[`${alpha ? 'atime' : 'ctime'}${i}`] / 65535;
    let i = 0;
    while (i < count - 1 && time(i + 1) < t) i++;
    const next = Math.min(i + 1, count - 1), a = value[`key${i}`], b = value[`key${next}`];
    const u = value.m_Mode === 1 || time(next) <= time(i) ? 0 : clamp((t - time(i)) / (time(next) - time(i)));
    return alpha ? mix(a.a, b.a, u) : ['r', 'g', 'b'].map(k => mix(a[k], b[k], u));
  }
  return [...channel(false), channel(true)];
}

function color(value, t, random) {
  if (!value) return [1, 1, 1, 1];
  const rgba = c => [c.r, c.g, c.b, c.a];
  switch (value.minMaxState) {
    case 0: return rgba(value.maxColor);
    case 1: return gradient(value.maxGradient, t);
    case 2: return rgba(value.minColor).map((v, i) => mix(v, rgba(value.maxColor)[i], random));
    case 3: return gradient(value.minGradient, t).map((v, i) => mix(v, gradient(value.maxGradient, t)[i], random));
    case 4: return gradient(value.maxGradient, random);
    default: return [1, 1, 1, 1];
  }
}

function randomDirection(random) {
  const z = random() * 2 - 1, angle = random() * Math.PI * 2, radius = Math.sqrt(1 - z * z);
  return new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), z);
}

function shapePoint(shape, random) {
  const position = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, 1);
  if (!shape) return { position, direction };
  const radius = shape.radius?.value ?? 1, thickness = shape.radiusThickness ?? 1;
  const angle = random() * (shape.arc?.value ?? 360) * Math.PI / 180;
  const shell = radius * Math.sqrt(mix((1 - thickness) ** 2, 1, random()));
  if ([0, 1, 2, 3].includes(shape.type)) {
    direction.copy(randomDirection(random));
    if (shape.type === 2 || shape.type === 3) direction.z = Math.abs(direction.z);
    position.copy(direction).multiplyScalar(radius * Math.cbrt(mix((1 - thickness) ** 3, 1, random())));
  } else if ([4, 7, 10, 11].includes(shape.type)) {
    position.set(Math.cos(angle) * shell, Math.sin(angle) * shell, 0);
    if (shape.type === 4 || shape.type === 7) {
      const spread = Math.tan((shape.angle ?? 0) * Math.PI / 180);
      direction.set(position.x * spread / (radius || 1), position.y * spread / (radius || 1), 1).normalize();
    } else direction.set(Math.cos(angle), Math.sin(angle), 0);
  } else if (shape.type === 5) position.set(random() - .5, random() - .5, random() - .5);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    (shape.m_Rotation?.x ?? 0) * Math.PI / 180, (shape.m_Rotation?.y ?? 0) * Math.PI / 180,
    (shape.m_Rotation?.z ?? 0) * Math.PI / 180, 'ZXY'));
  position.multiply(vector(shape.m_Scale, 1)).applyQuaternion(rotation).add(vector(shape.m_Position));
  direction.applyQuaternion(rotation);
  if (shape.sphericalDirectionAmount) direction.lerp(position.clone().normalize(), shape.sphericalDirectionAmount).normalize();
  if (shape.randomDirectionAmount) direction.lerp(randomDirection(random), shape.randomDirectionAmount).normalize();
  if (shape.randomPositionAmount) position.addScaledVector(randomDirection(random), shape.randomPositionAmount * random());
  return { position, direction };
}

function geometry(data) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(data.positions.flat(), 3));
  if (data.uv?.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv.flat(), 2));
  if (data.colors?.length) out.setAttribute('color', new THREE.Float32BufferAttribute(data.colors.flat(), data.colors[0].length));
  out.setIndex(data.submeshes.flat(Infinity));
  out.computeBoundingSphere(); return out;
}

/** Source units stay under native(.1,.1,-.1). distanceDelta is browser +Z scroll.
 * stop() stops emission; reset() also clears live particles. Calling play()
 * while already playing does not reset a looping emitter. Use reset().play()
 * to deliberately retrigger a burst. sourceRoot exposes only the authored root.
 */
export function createSourceParticleEffect(key, pack, options = {}) {
  const presentation = pack.presentation ?? pack.classicPresentation;
  const graph = presentation?.effects?.[key];
  if (!graph) throw new Error(`Missing source particle effect ${key}`);
  const object = new THREE.Group(); object.name = `SourceParticles:${key}`;
  const native = new THREE.Group(); native.scale.set(.1, .1, -.1); object.add(native);
  const nodes = new Map();
  for (const row of graph.nodes) {
    const node = new THREE.Group(); node.name = row.name;
    node.position.fromArray(row.position); node.quaternion.fromArray(row.quaternion); node.scale.fromArray(row.scale);
    nodes.set(row.id, node);
  }
  for (const row of graph.nodes) (nodes.get(row.parentId) ?? native).add(nodes.get(row.id));
  const sourceRoot = nodes.get(graph.rootNodeId);
  if (options.rootPosition) sourceRoot.position.fromArray(options.rootPosition);
  const limitations = new Set(['Unity shader distortion/fog and custom shader math are not reproduced; source textures, colors and additive/alpha blend class are used.']);
  const maxParticles = options.maxParticles ?? 256;
  const random = options.random ?? Math.random;
  const meshByRef = new Map(Object.entries(pack.manifest?.meshes ?? {}).map(([k, v]) => [sourceRef(v.source), lookup(pack.meshData, k)]));
  const ownedTextures = [], geometries = new Set(), materials = new Set(), systems = [];
  const gravitySource = presentation.physics?.fields?.m_Gravity ?? { x: 0, y: -9.8100004196167, z: 0 };
  const gravityWorld = vector(gravitySource).multiply(new THREE.Vector3(.1, .1, -.1));
  let isPlaying = false;
  for (const [ref, recipe] of Object.entries(presentation.particleRecipes ?? {})) {
    if (recipe.effectKey !== key) continue;
    const modules = recipe.enabledModules, initial = modules.InitialModule, renderer = recipe.renderer;
    const node = nodes.get(recipe.nodeId), record = presentation.materials[recipe.materialRefs.find(Boolean)];
    if (!initial || !renderer || !record) { limitations.add(`Skipped ${ref}: no verified renderer/material.`); continue; }
    const mode = renderer.m_RenderMode;
    if (![0, 1, 2, 3, 4].includes(mode)) continue;
    const texInfo = record.textures?._MainTex;
    let map = texInfo ? lookup(pack.textures, texInfo.name) : null;
    if (texInfo && !map) throw new Error(`Source texture ${texInfo.name} has not been loaded`);
    if (map) {
      map = map.clone(); map.repeat.fromArray(texInfo.scale ?? [1, 1]); map.offset.fromArray(texInfo.offset ?? [0, 0]);
      map.wrapS = map.wrapT = THREE.RepeatWrapping; ownedTextures.push(map);
    }
    const tint = record.colors._TintColor ?? record.colors._Color ?? [1, 1, 1, 1];
    const baseMaterial = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: /Additive/i.test(record.shader?.name ?? '') ? THREE.AdditiveBlending : THREE.NormalBlending });
    materials.add(baseMaterial);
    let choices;
    if (mode === 4) {
      const refs = presentation.components[recipe.rendererRef].references.filter(r => r.type === 'Mesh');
      choices = refs.map(r => meshByRef.get(r.ref)).filter(Boolean).map(geometry);
      if (!choices.length) { limitations.add(`Skipped ${ref}: source mesh missing; no substitute geometry.`); continue; }
    } else choices = [new THREE.PlaneGeometry(1, 1)];
    for (const g of choices) geometries.add(g);
    const supported = new Set(['InitialModule', 'ShapeModule', 'EmissionModule', 'SizeModule', 'ColorModule', 'RotationModule', 'VelocityModule', 'ForceModule']);
    for (const name of Object.keys(modules)) if (!supported.has(name)) limitations.add(`${ref}: ${name} preserved but not evaluated.`);
    if (modules.ShapeModule && ![0, 1, 2, 3, 4, 5, 7, 10, 11].includes(modules.ShapeModule.type)) limitations.add(`${ref}: unsupported shape ${modules.ShapeModule.type}; emission origin only.`);
    if (recipe.main.moveWithTransform === 2) limitations.add(`${ref}: custom simulation space falls back to local space.`);
    if (recipe.main.prewarm) limitations.add(`${ref}: prewarm is not simulated.`);
    if (mode === 1) limitations.add(`${ref}: stretched billboard uses source lengthScale and velocityScale; camera motion stretching is omitted.`);
    const sys = { ref, recipe, modules, initial, renderer, node, choices, baseMaterial, tint, live: [], time: 0,
      carry: 0, delay: 0, max: Math.min(initial.maxNumParticles, maxParticles), world: recipe.main.moveWithTransform === 1,
      burstAtZero: false, mode };
    if (initial.maxNumParticles > maxParticles) limitations.add(`${ref}: particle budget ${maxParticles} (source maximum ${initial.maxNumParticles}).`);
    systems.push(sys);
  }

  function spawn(sys, count, time) {
    const initial = sys.initial, normalized = clamp(time / Math.max(sys.recipe.main.lengthInSec, 1e-6));
    object.updateWorldMatrix(true, true);
    for (let i = 0; i < count && sys.live.length < sys.max; i++) {
      const seed = random(), sample = curve => evaluateParticleMinMax(curve, normalized, seed);
      const lifetime = sample(initial.startLifetime); if (!(lifetime > 0)) continue;
      const sampled = shapePoint(sys.modules.ShapeModule, random);
      const velocity = sampled.direction.multiplyScalar(sample(initial.startSpeed));
      const size = sample(initial.startSize), sizes = new THREE.Vector3(size, initial.size3D ? sample(initial.startSizeY) : size, initial.size3D ? sample(initial.startSizeZ) : size);
      const rotation = new THREE.Euler(initial.rotation3D ? sample(initial.startRotationX) : 0, initial.rotation3D ? sample(initial.startRotationY) : 0, sample(initial.startRotation), 'ZXY');
      const g = sys.choices[Math.floor(random() * sys.choices.length)], material = sys.baseMaterial.clone();
      material.vertexColors = !!g.getAttribute('color'); materials.add(material);
      const mesh = new THREE.Mesh(g, material); mesh.frustumCulled = false;
      const parent = sys.world ? native : sys.node; parent.add(mesh);
      const position = sampled.position, emitScale = sys.node.getWorldScale(new THREE.Vector3());
      emitScale.set(Math.abs(emitScale.x), Math.abs(emitScale.y), Math.abs(emitScale.z));
      const scale = new THREE.Vector3(1, 1, 1), scaling = sys.recipe.main.scalingMode;
      if (sys.world) {
        sys.node.localToWorld(position);
        if (scaling === 0) velocity.applyMatrix3(new THREE.Matrix3().setFromMatrix4(sys.node.matrixWorld));
        else { const length = velocity.length(); velocity.transformDirection(sys.node.matrixWorld).multiplyScalar(length * .1); }
        if (scaling === 0) scale.copy(emitScale).multiplyScalar(10);
        else if (scaling === 1) scale.copy(sys.node.scale);
      } else if (scaling !== 0) {
        scale.set(.1 / Math.abs(emitScale.x), .1 / Math.abs(emitScale.y), .1 / Math.abs(emitScale.z));
        if (scaling === 1) scale.multiply(sys.node.scale);
        velocity.multiply(scale);
      }
      const baseQuaternion = sys.world ? native.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(sys.node.getWorldQuaternion(new THREE.Quaternion())) : new THREE.Quaternion();
      sys.live.push({ mesh, position, velocity, age: 0, lifetime, seed, sizes, scale, rotation, baseQuaternion, startColor: color(initial.startColor, normalized, seed) });
    }
  }

  function emit(sys, before, after, distance) {
    const emission = sys.modules.EmissionModule; if (!emission) return;
    const duration = Math.max(sys.recipe.main.lengthInSec, 1e-6), loop = sys.recipe.main.looping;
    const a = Math.max(0, before), b = loop ? after : Math.min(after, duration);
    if (b < 0 || b < a) return;
    const sample = clamp((a % duration) / duration);
    sys.carry += evaluateParticleMinMax(emission.rateOverTime, sample, random()) * (b - a)
      + evaluateParticleMinMax(emission.rateOverDistance, sample, random()) * Math.abs(distance) * 10;
    const number = Math.floor(sys.carry + 1e-9); sys.carry = Math.max(0, sys.carry - number); spawn(sys, number, a % duration);
    const first = Math.floor(a / duration), last = Math.floor(Math.max(a, b) / duration);
    for (let cycle = first; cycle <= last; cycle++) {
      if (!loop && cycle > 0) break;
      for (const burst of emission.m_Bursts ?? []) {
        const repeat = Math.max(burst.repeatInterval, 1e-5);
        const count = burst.cycleCount > 0 ? burst.cycleCount : Math.ceil((duration - burst.time) / repeat);
        for (let c = 0; c < count; c++) {
          const t = cycle * duration + burst.time + c * repeat;
          if (t >= (cycle + 1) * duration || t > b + 1e-9) break;
          if (t > before + 1e-9 && random() <= burst.probability) spawn(sys, Math.round(evaluateParticleMinMax(burst.countCurve, t % duration / duration, random())), t % duration);
        }
      }
    }
  }

  function advance(sys, dt, scroll) {
    const modules = sys.modules;
    const inverse = new THREE.Matrix3().setFromMatrix4(sys.node.matrixWorld).invert();
    for (let i = sys.live.length - 1; i >= 0; i--) {
      const p = sys.live[i]; p.age += dt;
      if (p.age >= p.lifetime) { p.mesh.removeFromParent(); p.mesh.material.dispose(); materials.delete(p.mesh.material); sys.live.splice(i, 1); continue; }
      const t = p.age / p.lifetime, sample = (v, fallback = 0) => evaluateParticleMinMax(v, t, p.seed, fallback);
      const acceleration = gravityWorld.clone().multiplyScalar(sample(sys.initial.gravityModifier));
      if (!sys.world) acceleration.applyMatrix3(inverse);
      const force = modules.ForceModule;
      if (force) {
        const v = new THREE.Vector3(sample(force.x), sample(force.y), sample(force.z));
        if (sys.world && !force.inWorldSpace) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(sys.node.matrixWorld));
        else if (!sys.world && force.inWorldSpace) v.multiplyScalar(.1).applyMatrix3(inverse);
        acceleration.add(v);
      }
      p.position.addScaledVector(p.velocity, dt).addScaledVector(acceleration, .5 * dt * dt); p.velocity.addScaledVector(acceleration, dt);
      const velocity = modules.VelocityModule;
      if (velocity) {
        const v = new THREE.Vector3(sample(velocity.x), sample(velocity.y), sample(velocity.z));
        if (sys.world && !velocity.inWorldSpace) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(sys.node.matrixWorld));
        else if (sys.world) v.multiplyScalar(.1);
        else if (velocity.inWorldSpace) v.multiplyScalar(.1).applyMatrix3(inverse);
        p.position.addScaledVector(v, dt);
      }
      if (sys.world) p.position.z += scroll;
      const rotation = modules.RotationModule;
      if (rotation) {
        p.rotation.z += sample(rotation.curve) * dt;
        if (rotation.separateAxes) { p.rotation.x += sample(rotation.x) * dt; p.rotation.y += sample(rotation.y) * dt; }
      }
    }
  }

  function render(sys, camera) {
    for (const p of sys.live) {
      const t = p.age / p.lifetime, sample = v => evaluateParticleMinMax(v, t, p.seed, 1);
      p.mesh.position.copy(sys.world ? native.worldToLocal(p.position.clone()) : p.position);
      const size = sys.modules.SizeModule;
      p.mesh.scale.copy(p.sizes).multiply(p.scale);
      if (size) p.mesh.scale.multiply(new THREE.Vector3(sample(size.curve), sample(size.separateAxes ? size.y : size.curve), sample(size.separateAxes ? size.z : size.curve)));
      const tint = sys.modules.ColorModule ? color(sys.modules.ColorModule.gradient, t, p.seed) : [1, 1, 1, 1];
      const rgba = p.startColor.map((v, i) => v * tint[i] * sys.tint[i]);
      p.mesh.material.color.setRGB(rgba[0], rgba[1], rgba[2]); p.mesh.material.opacity = clamp(rgba[3]);
      p.mesh.quaternion.copy(p.baseQuaternion).multiply(new THREE.Quaternion().setFromEuler(p.rotation));
      if (sys.mode !== 4 && camera) {
        const parentRotation = p.mesh.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        const cameraRotation = camera.getWorldQuaternion(new THREE.Quaternion());
        if (sys.mode === 2) cameraRotation.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
        if (sys.mode === 3) cameraRotation.setFromEuler(new THREE.Euler(0, new THREE.Euler().setFromQuaternion(cameraRotation, 'YXZ').y, 0));
        let rotation = p.rotation.z;
        if (sys.mode === 1) {
          const v = p.velocity.clone();
          if (!sys.world) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(sys.node.matrixWorld));
          v.applyQuaternion(cameraRotation.clone().invert());
          if (v.x * v.x + v.y * v.y > 1e-8) rotation += Math.atan2(-v.x, v.y);
          p.mesh.scale.y *= Math.max(1, sys.renderer.m_LengthScale + sys.renderer.m_VelocityScale * p.velocity.length());
        }
        p.mesh.quaternion.copy(parentRotation.multiply(cameraRotation)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotation));
      }
    }
  }

  const api = { object, native, sourceRoot, limitations: [...limitations],
    play() {
      if (isPlaying) return api;
      isPlaying = true; object.visible = true;
      for (const sys of systems) { sys.time = 0; sys.carry = 0; sys.delay = evaluateParticleMinMax(sys.recipe.main.startDelay, 0, random()); emit(sys, -1e-8 - sys.delay, -sys.delay, 0); }
      for (const sys of systems) render(sys); return api;
    },
    stop() { isPlaying = false; return api; },
    reset() {
      isPlaying = false;
      for (const sys of systems) { for (const p of sys.live) { p.mesh.removeFromParent(); p.mesh.material.dispose(); materials.delete(p.mesh.material); } sys.live.length = 0; sys.time = 0; sys.carry = 0; }
      return api;
    },
    update(dt, { distanceDelta = 0, camera } = {}) {
      if (!Number.isFinite(dt) || dt < 0) throw new Error('Particle dt must be finite and nonnegative');
      object.updateWorldMatrix(true, true);
      const steps = Math.max(1, Math.ceil(dt / (1 / 60))), step = dt / steps;
      for (let i = 0; i < steps; i++) for (const sys of systems) {
        const simDt = step * sys.recipe.main.simulationSpeed;
        advance(sys, simDt, distanceDelta / steps);
        if (isPlaying) { const before = sys.time - sys.delay; sys.time += simDt; emit(sys, before, sys.time - sys.delay, distanceDelta / steps); }
      }
      for (const sys of systems) render(sys, camera);
      return api;
    },
    get aliveCount() { return systems.reduce((total, s) => total + s.live.length, 0); },
    dispose() { api.reset(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); ownedTextures.forEach(t => t.dispose()); object.removeFromParent(); },
  };
  return api;
}
