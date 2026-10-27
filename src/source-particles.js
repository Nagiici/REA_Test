import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { createSourceEffectMaterial, setSourceParticleColor, disposeSourceEffectMaterial } from './source-effect-material.js';

// Serialized enum values: UnityCsReference ParticleSystemEnums.cs and
// InitialModuleUI.cs (moveWithTransform is the simulation-space property).
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const vector = (v, fallback = 0) => new THREE.Vector3(v?.x ?? fallback, v?.y ?? fallback, v?.z ?? fallback);
const lookup = (items, key) => items instanceof Map ? items.get(key) : items?.[key];
const sourceRef = source => `${source.asset}:${source.pathId}`;
const perlin = new ImprovedNoise();

// Unity documents Curl Noise based on Perlin; its private native permutation,
// seed and integration are unavailable. This deterministic curl field is an
// explicitly bounded browser approximation, using the serialized parameters.
export function particleCurlNoise(position, frequency, octaves = 1, octaveMultiplier = .5, octaveScale = 2) {
  const result = new THREE.Vector3(), h = .01;
  const potential = (axis, x, y, z) => perlin.noise(x + axis * 31.416, y + axis * 47.853, z + axis * 12.793);
  for (let octave = 0, amplitude = 1; octave < octaves; octave++, amplitude *= octaveMultiplier, frequency *= octaveScale) {
    const [x, y, z] = position.toArray().map(v => v * frequency);
    const derivative = (axis, coordinate) => {
      const a = [x, y, z], b = [x, y, z]; a[coordinate] += h; b[coordinate] -= h;
      return (potential(axis, ...a) - potential(axis, ...b)) / (2 * h);
    };
    result.addScaledVector(new THREE.Vector3(derivative(2, 1) - derivative(1, 2), derivative(0, 2) - derivative(2, 0), derivative(1, 0) - derivative(0, 1)), amplitude);
  }
  return result;
}

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
  if (data.colors?.length) out.setAttribute('sourceColor', new THREE.Float32BufferAttribute(data.colors.flatMap(c => c.length === 4 ? c : [...c, 1]), 4));
  if (data.normals?.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals.flat(), 3));
  out.setIndex(data.submeshes.flat(Infinity));
  if (!out.getAttribute('normal')) out.computeVertexNormals();
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
  const limitations = new Set(['Scene-wide shader distortion/fog is opt-in through shaderGlobals; default effect rendering does not bend independently of the world.']);
  const maxParticles = options.maxParticles ?? 256;
  const random = options.random ?? Math.random;
  const meshByRef = new Map(Object.entries(pack.manifest?.meshes ?? {}).map(([k, v]) => [sourceRef(v.source), lookup(pack.meshData, k)]));
  const geometries = new Set(), materials = new Set(), systems = [];
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
    const baseMaterial = createSourceEffectMaterial(record, pack, { globals: options.shaderGlobals });
    materials.add(baseMaterial);
    let choices;
    if (mode === 4) {
      const refs = presentation.components[recipe.rendererRef].references.filter(r => r.type === 'Mesh');
      choices = refs.map(r => meshByRef.get(r.ref)).filter(Boolean).map(geometry);
      if (!choices.length) { limitations.add(`Skipped ${ref}: source mesh missing; no substitute geometry.`); continue; }
    } else choices = [new THREE.PlaneGeometry(1, 1)];
    for (const g of choices) geometries.add(g);
    const supported = new Set(['InitialModule', 'ShapeModule', 'EmissionModule', 'SizeModule', 'ColorModule', 'RotationModule', 'VelocityModule', 'ForceModule', 'SizeBySpeedModule', 'NoiseModule']);
    const collision = modules.CollisionModule;
    if (collision?.type === 0 && collision.m_Planes.every(p => !p.m_PathID)) supported.add('CollisionModule'); // Empty source plane set: intentionally no collision.
    for (const name of Object.keys(modules)) if (!supported.has(name)) limitations.add(`${ref}: ${name} preserved but not evaluated.`);
    if (modules.ShapeModule && ![0, 1, 2, 3, 4, 5, 7, 10, 11].includes(modules.ShapeModule.type)) limitations.add(`${ref}: unsupported shape ${modules.ShapeModule.type}; emission origin only.`);
    if (recipe.main.moveWithTransform === 2) limitations.add(`${ref}: custom simulation space falls back to local space.`);
    if (recipe.main.prewarm) limitations.add(`${ref}: prewarm is not simulated.`);
    if (mode === 1 && renderer.m_CameraVelocityScale) limitations.add(`${ref}: nonzero camera motion stretching is not evaluated.`);
    if (modules.NoiseModule) limitations.add(`${ref}: NoiseModule uses source strength/frequency/octaves with browser Perlin curl; native Unity noise seed/permutation/integrator are not bit-exact.`);
    const sys = { ref, recipe, modules, initial, renderer, node, choices, baseMaterial, live: [], time: 0,
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
      materials.add(material);
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
      sys.live.push({ mesh, position, velocity, totalVelocity: velocity.clone(), scroll: 0, age: 0, lifetime, seed, sizes, scale, rotation, baseQuaternion, startColor: color(initial.startColor, normalized, seed) });
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
        else if (force.inWorldSpace) {
          v.multiply(new THREE.Vector3(.1, .1, -.1));
          if (!sys.world) v.applyMatrix3(inverse);
        }
        acceleration.add(v);
      }
      p.position.addScaledVector(p.velocity, dt).addScaledVector(acceleration, .5 * dt * dt); p.velocity.addScaledVector(acceleration, dt);
      p.totalVelocity.copy(p.velocity);
      const velocity = modules.VelocityModule;
      if (velocity) {
        const v = new THREE.Vector3(sample(velocity.x), sample(velocity.y), sample(velocity.z));
        if (sys.world && !velocity.inWorldSpace) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(sys.node.matrixWorld));
        else if (sys.world) v.multiply(new THREE.Vector3(.1, .1, -.1));
        else if (velocity.inWorldSpace) v.multiply(new THREE.Vector3(.1, .1, -.1)).applyMatrix3(inverse);
        p.position.addScaledVector(v, dt);
        p.totalVelocity.add(v);
      }
      const noise = modules.NoiseModule;
      if (noise) {
        const coordinate = p.position.clone();
        if (sys.world) { coordinate.z -= p.scroll; coordinate.multiply(new THREE.Vector3(10, 10, -10)); }
        coordinate.z += sample(noise.scrollSpeed) * p.age;
        const v = particleCurlNoise(coordinate, noise.frequency, noise.octaves, noise.octaveMultiplier, noise.octaveScale);
        const strength = [noise.strength, noise.separateAxes ? noise.strengthY : noise.strength, noise.separateAxes ? noise.strengthZ : noise.strength].map(c => sample(c));
        v.multiply(new THREE.Vector3(...strength)).multiplyScalar(sample(noise.positionAmount) * (noise.damping ? noise.frequency : 1));
        if (sys.world) v.multiply(new THREE.Vector3(.1, .1, -.1));
        p.position.addScaledVector(v, dt); p.totalVelocity.add(v);
      }
      if (sys.world) { p.position.z += scroll; p.scroll += scroll; }
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
      const bySpeed = sys.modules.SizeBySpeedModule;
      if (bySpeed) {
        const speed = p.totalVelocity.length() * (sys.world ? 10 : 1);
        const u = clamp((speed - bySpeed.range.x) / Math.max(1e-6, bySpeed.range.y - bySpeed.range.x));
        const value = curve => evaluateParticleMinMax(curve, u, p.seed, 1);
        p.mesh.scale.multiply(new THREE.Vector3(value(bySpeed.curve), value(bySpeed.separateAxes ? bySpeed.y : bySpeed.curve), value(bySpeed.separateAxes ? bySpeed.z : bySpeed.curve)));
      }
      const tint = sys.modules.ColorModule ? color(sys.modules.ColorModule.gradient, t, p.seed) : [1, 1, 1, 1];
      setSourceParticleColor(p.mesh.material, p.startColor.map((v, i) => v * tint[i]));
      p.mesh.quaternion.copy(p.baseQuaternion).multiply(new THREE.Quaternion().setFromEuler(p.rotation));
      if (sys.mode !== 4 && camera) {
        const cameraRotation = camera.getWorldQuaternion(new THREE.Quaternion());
        if (sys.mode === 2) cameraRotation.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
        if (sys.mode === 3) cameraRotation.setFromEuler(new THREE.Euler(0, new THREE.Euler().setFromQuaternion(cameraRotation, 'YXZ').y, 0));
        let rotation = p.rotation.z;
        if (sys.mode === 1) {
          const v = p.totalVelocity.clone();
          if (!sys.world) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(sys.node.matrixWorld));
          if (!sys.renderer.m_FreeformStretching && v.lengthSq() > 1e-8) {
            // Legacy stretched particles lie along their 3D velocity and can
            // become edge-on to the camera. Keeping the whole quad in the
            // camera plane is the different freeform-stretching mode.
            const y = v.normalize(), normal = new THREE.Vector3(0, 0, 1).applyQuaternion(cameraRotation);
            const x = new THREE.Vector3().crossVectors(y, normal);
            if (x.lengthSq() < 1e-8) x.set(1, 0, 0).applyQuaternion(cameraRotation);
            x.normalize(); const z = new THREE.Vector3().crossVectors(x, y).normalize();
            cameraRotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
          } else {
            v.applyQuaternion(cameraRotation.clone().invert());
            if (v.x * v.x + v.y * v.y > 1e-8) rotation += Math.atan2(-v.x, v.y);
          }
          // Source grind: velocityScale=0, lengthScale=6.21. Zero means zero
          // length; do not clamp this to one or add invented speed stretching.
          p.mesh.scale.y *= Math.max(0, sys.renderer.m_LengthScale + sys.renderer.m_VelocityScale * p.totalVelocity.length() * (sys.world ? 10 : 1));
        }
        const parentScale = p.mesh.parent.getWorldScale(new THREE.Vector3());
        const worldScale = p.mesh.scale.clone().multiply(parentScale).set(Math.abs(p.mesh.scale.x * parentScale.x), Math.abs(p.mesh.scale.y * parentScale.y), Math.abs(p.mesh.scale.z * parentScale.z));
        const worldPosition = p.mesh.parent.localToWorld(p.mesh.position.clone());
        // Keep mirrored source parents out of billboard UV orientation: a
        // quaternion alone cannot undo the native negative-Z determinant.
        const worldQuaternion = cameraRotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotation));
        const matrix = new THREE.Matrix4().copy(p.mesh.parent.matrixWorld).invert().multiply(new THREE.Matrix4().compose(worldPosition, worldQuaternion, worldScale));
        matrix.decompose(p.mesh.position, p.mesh.quaternion, p.mesh.scale);
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
    dispose() { api.reset(); geometries.forEach(g => g.dispose()); materials.forEach(disposeSourceEffectMaterial); object.removeFromParent(); },
  };
  return api;
}
