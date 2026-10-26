import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEntityVisual } from '../src/entity-visuals.js';

function pack() {
  const car = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 6), new THREE.MeshBasicMaterial());
  mesh.position.y = 1.5;
  car.add(mesh);
  return { cloneProp: key => key === 'car' ? car.clone(true) : null };
}

test('a multi-car collider does not stretch the individual visual instance', () => {
  const entity = { type: 'decoration', width: 2, height: 3, depth: 18,
    visual: { meshKey: 'car', matrix: [1,0,0,0, 0,1,0,0, 0,0,1,-6, 0,0,0,1] } };
  const object = createEntityVisual(entity, pack());
  const bounds = new THREE.Box3().setFromObject(object);
  assert.equal(bounds.min.z, -9);
  assert.equal(bounds.max.z, -3);
  assert.equal(bounds.max.y, 3);
});

test('mirrored relative transforms preserve their reflected offset', () => {
  const object = createEntityVisual({ visual: { meshKey: 'car',
    matrix: [-1,0,0,-2, 0,1,0,1, 0,0,1,0, 0,0,0,1] } }, pack());
  const bounds = new THREE.Box3().setFromObject(object);
  assert.equal(bounds.min.x, -3);
  assert.equal(bounds.max.x, -1);
  assert.equal(bounds.min.y, 1);
  assert.equal(bounds.max.y, 4);
});

test('collider-only instances stay invisible while missing requested geometry is an error', () => {
  assert.equal(createEntityVisual({ visual: null }, pack()).children.length, 0);
  assert.throws(() => createEntityVisual({ visual: { meshKey: 'missing' } }, pack()), /缺少关卡模型/);
});
