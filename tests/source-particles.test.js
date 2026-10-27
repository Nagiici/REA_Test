import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createSourceParticleEffect, evaluateParticleCurve, evaluateParticleMinMax } from '../src/source-particles.js';

const root = new URL('../public/assets/recovered/', import.meta.url);
const json = name => JSON.parse(fs.readFileSync(new URL(name, root), 'utf8'));
const manifest = json('manifest.json');
const presentation = json(manifest.classicPresentation);
const meshData = Object.fromEntries(Object.entries(manifest.meshes).filter(([key]) => key.startsWith('v3_')).map(([key, row]) => [key, json(row.file)]));
const textures = Object.fromEntries(Object.keys(manifest.textures).map(key => [key, new THREE.Texture()]));
const pack = { presentation, manifest, meshData, textures };
const options = { random: () => .5 };
const meshes = effect => { const result = []; effect.object.traverse(node => { if (node.isMesh) result.push(node); }); return result; };
const position = mesh => { mesh.updateWorldMatrix(true, false); return mesh.getWorldPosition(new THREE.Vector3()); };
const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('curves preserve Hermite tangents, constants and signed random endpoints', () => {
  const curve = { m_Curve: [{ time: 0, value: 0, inSlope: 0, outSlope: 2 }, { time: 1, value: 1, inSlope: 0, outSlope: 0 }] };
  close(evaluateParticleCurve(curve, .5), .75);
  close(evaluateParticleMinMax({ minMaxState: 1, scalar: 4, maxCurve: curve }, .5), 3);
  close(evaluateParticleMinMax({ minMaxState: 3, minScalar: -80, scalar: -100 }, 0, .25), -85);
  close(evaluateParticleMinMax({ minMaxState: 0, minScalar: 5, scalar: 2 }, .5), 2);
});

test('source hoverboard burst emits 35, uses its texture and expires after stop', () => {
  const effect = createSourceParticleEffect('fx_board_crash', pack, options).play();
  assert.equal(effect.aliveCount, 35);
  assert.ok(meshes(effect).every(mesh => mesh.material.map));
  assert.ok(meshes(effect).every(mesh => mesh.material.blending === THREE.AdditiveBlending));
  effect.update(.2); assert.equal(effect.aliveCount, 35);
  effect.stop().update(1); assert.equal(effect.aliveCount, 0);
  effect.play(); assert.equal(effect.aliveCount, 35);
  effect.reset(); assert.equal(effect.aliveCount, 0);
  effect.dispose();
});

test('world-space dust remains at its birth world position as emitter moves, then scrolls', () => {
  const effect = createSourceParticleEffect('fx_dust', pack, options).play();
  effect.update(.1); assert.equal(effect.aliveCount, 3);
  const particle = meshes(effect)[0], start = position(particle);
  effect.object.position.x += 2;
  effect.update(0);
  close(position(particle).x, start.x);
  effect.update(0, { distanceDelta: 1.25 });
  close(position(particle).z, start.z + 1.25);
  effect.stop().update(.5); assert.equal(effect.aliveCount, 0);
  effect.dispose();
});

test('local crash particles follow their source parent; resetting root translation is explicit', () => {
  const effect = createSourceParticleEffect('fx_board_crash', pack, options).play();
  const particle = meshes(effect)[0], initial = position(particle);
  effect.object.position.x = 2;
  effect.update(0);
  close(position(particle).x, initial.x + 2);
  assert.notEqual(effect.sourceRoot.position.y, 0);
  const grind = createSourceParticleEffect('fx_grind_sparks', pack, { ...options, rootPosition: [0, 0, 0] });
  assert.deepEqual(grind.sourceRoot.position.toArray(), [0, 0, 0]);
  effect.dispose(); grind.dispose();
});

test('mesh particle modes use exported original meshes, including untextured dust and leaves', () => {
  for (const key of ['fx_dust', 'fx_bush_leaves', 'fx_dizzy_stars']) {
    const effect = createSourceParticleEffect(key, pack, options).play().update(.7);
    assert.ok(effect.aliveCount > 0, key);
    const particle = meshes(effect)[0];
    const recipe = Object.values(presentation.particleRecipes).find(r => r.effectKey === key);
    const meshRef = presentation.components[recipe.rendererRef].references.find(r => r.type === 'Mesh').ref;
    const sourceKey = Object.entries(manifest.meshes).find(([, m]) => `${m.source.asset}:${m.source.pathId}` === meshRef)[0];
    assert.equal(particle.geometry.getAttribute('position').count, meshData[sourceKey].positions.length, key);
    assert.equal(particle.geometry.index.count, meshData[sourceKey].submeshes.flat(Infinity).length, key);
    if (key === 'fx_dust' || key === 'fx_bush_leaves') assert.equal(particle.material.map, null);
    effect.dispose();
  }
});

test('original roll burst range and noise limitation are explicit; particles remain finite', () => {
  const effect = createSourceParticleEffect('fx_jump_roll', pack, { ...options, rootPosition: [0, 0, 0] }).play();
  assert.ok(effect.aliveCount >= 5 && effect.aliveCount <= 10);
  assert.ok(effect.limitations.some(line => line.includes('NoiseModule')));
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 100); camera.position.set(0, 4, 8); camera.lookAt(0, 1, 0);
  for (let i = 0; i < 90; i++) effect.update(1 / 60, { camera, distanceDelta: .1 });
  for (const mesh of meshes(effect)) assert.ok([...mesh.position, ...mesh.quaternion, ...mesh.scale].every(Number.isFinite));
  effect.dispose();
});

test('missing source textures fail explicitly instead of rendering invented dots', () => {
  assert.throws(() => createSourceParticleEffect('fx_board_crash', { ...pack, textures: {} }), /has not been loaded/);
});

test('per-emitter budget is bounded and disclosed', () => {
  const effect = createSourceParticleEffect('fx_board_crash', pack, { ...options, maxParticles: 10 }).play();
  assert.equal(effect.aliveCount, 10);
  assert.ok(effect.limitations.some(line => line.includes('particle budget 10')));
  effect.dispose();
});
