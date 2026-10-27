import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createSourceEffectMaterial, setSourceParticleColor, disposeSourceEffectMaterial } from '../src/source-effect-material.js';

const root = new URL('../public/assets/recovered/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
const presentation = JSON.parse(fs.readFileSync(new URL(manifest.classicPresentation, root)));
const textures = Object.fromEntries(Object.keys(manifest.textures).map(key => [key, new THREE.Texture()]));
const pack = { presentation, textures };
const record = shaderRef => Object.values(presentation.materials).find(row => `${row.shader.source.asset}:${row.shader.source.pathId}` === shaderRef);

test('source shader identity controls blend, depth and cull, regardless of its name', () => {
  const crash = createSourceEffectMaterial(record('c13f3abd6c5e34e40b6e4e449af1645c:1'), pack);
  assert.match(crash.userData.sourceShader, /Additive/);
  assert.equal(crash.blendDst, THREE.OneMinusSrcAlphaFactor);
  assert.equal(crash.side, THREE.DoubleSide); assert.equal(crash.depthWrite, false);
  const star = createSourceEffectMaterial(record('globalgamemanagers.assets:13'), pack);
  assert.equal(star.blendSrc, THREE.OneFactor); assert.equal(star.blendDst, THREE.OneFactor);
  assert.equal(star.side, THREE.FrontSide);
  const leaf = createSourceEffectMaterial(record('globalgamemanagers.assets:19'), pack);
  assert.equal(leaf.depthWrite, true); assert.equal(leaf.transparent, false);
  [crash, star, leaf].forEach(disposeSourceEffectMaterial);
});

test('shader clone keeps independent particle/color uniforms and shared emitter texture', () => {
  const original = createSourceEffectMaterial(record('globalgamemanagers.assets:15'), pack), clone = original.clone();
  clone.color.setScalar(.7); setSourceParticleColor(clone, [.1, .2, .3, .4]);
  assert.notEqual(original.color.r, .7);
  assert.deepEqual(original.uniforms.particleColor.value.toArray(), [1, 1, 1, 1]);
  assert.equal(clone.map, original.map);
  assert.equal(clone.userData.ownsSourceMap, false);
  let disposed = false; original.map.addEventListener('dispose', () => { disposed = true; });
  disposeSourceEffectMaterial(clone); assert.equal(disposed, false);
  disposeSourceEffectMaterial(original); assert.equal(disposed, true);
});

test('source gamma space has no double sRGB conversion and scrolling updates uniform', () => {
  const material = createSourceEffectMaterial(record('globalgamemanagers.assets:21'), pack);
  assert.equal(material.map.colorSpace, THREE.NoColorSpace); assert.equal(material.toneMapped, false);
  material.map.offset.x = .37; material.onBeforeRender();
  assert.equal(material.uniforms.sourceUV.value.elements[6], .37);
  assert.equal(material.uniforms.sourceFogEnabled.value, 0);
  assert.deepEqual(material.uniforms.sourceDistortion.value.toArray(), [0, 0]);
  disposeSourceEffectMaterial(material);
});

test('unknown source shader is explicit, not classified by a misleading shader name', () => {
  assert.throws(() => createSourceEffectMaterial({ shader: { source: { asset: 'unknown', pathId: '1' }, name: 'Additive' } }, pack), /no recovered browser implementation/);
});
