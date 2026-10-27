import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { SourceIntroProps, createClassicIntroProps } from '../src/classic-intro-props.js';

const source = JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/classic-intro-props.json', import.meta.url)));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('actual source idlePaint keys keep original action indices and frame-rate times', () => {
  const clip = source.menuClips.idlePaint;
  assert.equal(clip.frameRate, 24);
  assert.equal(clip.duration, 23.54166603088379);
  assert.deepEqual(clip.actions.map(a => a.frame), [5,22,114,119,136,148,207,225,271,279,304,321,518,534]);
  assert.deepEqual(clip.actions.map(a => a.index), Array.from({ length: 14 }, (_, i) => i + 14));
  for (const action of clip.actions) near(action.time, action.frame / 24);
  assert.equal(Object.keys(source.presentation.particleRecipes).length, 3);
});

test('source frame events stop particles without hiding the spray can; next play resumes them', () => {
  const props = new SourceIntroProps(source);
  assert.equal(props.step(0, { phase: 'ready' }).sprayEmitting, true); // Authored playOnAwake.
  const off = props.step(22 / 24, { phase: 'ready' });
  assert.equal(off.sprayVisible, true);
  assert.equal(off.sprayEmitting, false);
  assert.deepEqual(off.events.filter(e => e.reason === 'source-keyframe').map(e => e.frame), [5, 22]);
  const on = props.step((114 - 22) / 24, { phase: 'ready' });
  assert.equal(on.sprayEmitting, true);
  assert.equal(on.events.at(-1).frame, 114);
});

test('coarse and fine sampling produce the same source event sequence over multiple idle loops', () => {
  const end = source.menuClips.idlePaint.duration * 2 + 1;
  const coarse = new SourceIntroProps(source), fine = new SourceIntroProps(source);
  coarse.step(0, { phase: 'ready' }); fine.step(0, { phase: 'ready' });
  const a = coarse.step(end, { phase: 'ready' });
  const events = []; let emittingTime = 0;
  for (let t = 0; t < end;) {
    const dt = Math.min(1 / 120, end - t), b = fine.step(dt, { phase: 'ready' });
    events.push(...b.events); emittingTime += b.segments.filter(s => s.emitting).reduce((n, s) => n + s.duration, 0); t += dt;
  }
  assert.deepEqual(events.map(e => [e.loop, e.frame, e.enabled]), a.events.map(e => [e.loop, e.frame, e.enabled]));
  near(a.segments.reduce((n, s) => n + s.duration, 0), end);
  near(a.segments.filter(s => s.emitting).reduce((n, s) => n + s.duration, 0), emittingTime);
  assert.equal(fine.sample().sprayEmitting, a.sprayEmitting);
});

test('pause freezes the menu clock; intro hides immediately and requests source eyes stop once', () => {
  const props = new SourceIntroProps(source);
  props.step(.4, { phase: 'ready' });
  const pause = props.step(20, { phase: 'paused' });
  assert.equal(pause.elapsed, .4); assert.deepEqual(pause.events, []);
  const intro = props.step(0, { phase: 'intro' });
  assert.equal(intro.sprayVisible, false); assert.equal(intro.eyeAnimationRequested, false);
  assert.ok(intro.events.some(e => e.type === 'eye-animation-request' && !e.enabled));
  assert.ok(intro.events.some(e => e.type === 'clear-hidden-spray'));
  assert.deepEqual(props.step(.5, { phase: 'intro' }).events, []);
  props.step(1, { phase: 'running' });
  assert.equal(props.step(0, { phase: 'ready' }).elapsed, 0);
});

test('prop binding preserves source Z reflection and emitter ancestors, and does not alter avatar eyes or backpack', () => {
  const attachment = new THREE.Group(), can = new THREE.Group(), native = new THREE.Group();
  native.scale.set(.1, .1, -.1); can.add(native);
  const textures = new Map();
  for (const material of Object.values(source.presentation.materials)) {
    for (const texture of Object.values(material.textures ?? {})) textures.set(texture.name, new THREE.Texture());
  }
  const model = new THREE.Group(); model.name = 'yellow-avatar';
  attachment.name = 'R_Hand_jnt'; model.add(attachment);
  const head = new THREE.Object3D(); head.name = 'Head'; head.morphTargetInfluences = [.3, .8]; model.add(head);
  const backpack = new THREE.Object3D(); backpack.name = 'ExistingBackpack'; backpack.position.set(1, 2, 3); model.add(backpack);
  const props = createClassicIntroProps({ introProps: source, textures, meshData: {}, manifest: { meshes: {} }, clonePrefab: () => can },
    { character: { native: model }, bodyFitScale: .8, random: () => .5 });
  assert.equal(attachment.children.length, 2);
  assert.equal(can.children[0].scale.z, -.1);
  assert.equal(props.particles.native.scale.z, -.1);
  assert.equal(can.scale.x, .8);
  const mesh = props.particles.sourceRoot.children.find(n => n.name === 'Mesh');
  assert.ok(mesh); assert.deepEqual(mesh.position.toArray(), source.spray.meshLocalPosition);
  assert.equal(mesh.children.length, 3);
  props.update(.4, { phase: 'ready' });
  assert.ok(props.particles.aliveCount > 0);
  props.update(0, { phase: 'intro' });
  assert.equal(props.can.visible, false); assert.equal(props.particles.aliveCount, 0);
  assert.deepEqual(head.morphTargetInfluences, [.3, .8]);
  assert.equal(head.parent, model);
  assert.deepEqual(backpack.position.toArray(), [1, 2, 3]);
  assert.equal(backpack.parent, model);
  assert.equal(source.backpack.operation, null);
  props.dispose(); assert.equal(attachment.children.length, 0);
});
