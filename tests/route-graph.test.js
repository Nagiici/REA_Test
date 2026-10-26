import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { walkGraph, colliderBounds, visualMatrix, sampleSourceCurve, seededRandom, createSelectionResolver } from '../src/route-generator.js';

test('selected hierarchy branches preserve source child order and local transforms', () => {
  const graph = { nodes: [
    { id: 'root', position: [20, 0, 100], childIds: ['right', 'left'] },
    { id: 'left', parentId: 'root', position: [-20, 0, 0] },
    { id: 'right', parentId: 'root', position: [20, 0, 10] },
  ] };
  const emitted = [];
  walkGraph(graph, {
    resolveNode: ({ node, indexed }) => node.id === 'root' ? { childIds: [indexed.children.get('root')[0]] } : {},
    visit: ({ node, matrix }) => emitted.push([node.id, new Vector3().setFromMatrixPosition(matrix).toArray()]),
  });
  assert.deepEqual(emitted, [['root', [20, 0, 100]], ['right', [40, 0, 110]]]);
});

test('disabled parent suppresses every descendant and prefab root replacement is explicit', () => {
  const graph = { nodes: [{ id: 'root', position: [999, 0, 999] }, { id: 'disabled', parentId: 'root', active: false }, { id: 'hidden-child', parentId: 'disabled' }, { id: 'leaf', parentId: 'root', position: [1, 2, 3] }] };
  const emitted = [];
  walkGraph(graph, { rootTransform: 'identity', visit: ({ node, matrix }) => emitted.push([node.id, new Vector3().setFromMatrixPosition(matrix).toArray()]) });
  assert.deepEqual(emitted, [['root', [0, 0, 0]], ['leaf', [1, 2, 3]]]);
});

test('serialized elevated box retains its opening and mirrored world coordinates', () => {
  const matrix = new Matrix4().makeTranslation(-20, 0, 100).scale(new Vector3(-1, 1, 1));
  const bounds = colliderBounds({ m_Center: { x: 0, y: 12, z: 0 }, m_Size: { x: 18, y: 4, z: 6 } }, matrix);
  for (const [key, value] of Object.entries({ x: -2, distance: 10, width: 1.8, depth: 0.6, bottom: 1, height: 1.4 })) assert.ok(Math.abs(bounds[key] - value) < 1e-10, key);
  const visual = new Matrix4().set(...visualMatrix(matrix, bounds));
  assert.deepEqual(new Vector3().setFromMatrixPosition(visual).toArray(), [0, 0, 0]);
  assert.equal(visual.elements[0], -1);
});

test('curve sampling follows cached Hermite tangents instead of linear key interpolation', () => {
  const x = { keys: [{ time: 0, value: 0, outSlope: 0 }, { time: 1, value: 2, inSlope: 0 }] };
  const linear = { keys: [{ time: 0, value: 0, outSlope: 1 }, { time: 1, value: 1, inSlope: 1 }] };
  assert.deepEqual(sampleSourceCurve({ curveX: x, curveY: x, curveZ: linear }, 0.25), [0.3125, 0.3125, 0.25]);
});

test('browser replay seeds are reproducible and independent', () => {
  const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43);
  const sequence = random => Array.from({ length: 20 }, random);
  const first = sequence(a);
  assert.deepEqual(first, sequence(b));
  assert.notDeepEqual(first, sequence(c));
});

test('ordinary Randomizer consumes activation before child selection and activates a saved inactive child', () => {
  const graph = { nodes: [{ id: 'r', childIds: ['a', 'b'], scripts: [{ class: 'Randomizer', decodedFields: { _activationProbability: 0.5, _WeightRandom: [{ weight: 999 }] } }] }, { id: 'a', parentId: 'r', active: false }, { id: 'b', parentId: 'r', active: false }] };
  const draws = [0.4, 0.9], decisions = [], visited = [];
  walkGraph(graph, { resolveNode: createSelectionResolver({ random: () => draws.shift(), scope: 'fixture', decisions }), visit: ({ node }) => visited.push(node.id) });
  assert.deepEqual(visited, ['r', 'b']);
  assert.equal(decisions[0].activationDraw, 0.4);
  assert.equal(decisions[0].indexDraw, 0.9);
  assert.equal(draws.length, 0);
});

test('Mirror changes direct-child position only and accumulates sign across reuse', () => {
  const graph = { nodes: [{ id: 'r', scripts: [{ class: 'Mirror' }] }, { id: 'a', parentId: 'r', position: [20, 2, 3], scale: [2, 1, 1] }] };
  const mirrorState = new Map(), positions = [];
  for (let i = 0; i < 2; i++) walkGraph(graph, { resolveNode: createSelectionResolver({ random: () => 0, scope: 'fixture', mirrorState }), visit: ({ node, matrix }) => { if (node.id === 'a') positions.push([matrix.elements[12], matrix.elements[0]]); } });
  assert.deepEqual(positions, [[-20, 2], [20, 2]]);
});

test('spawned prefab discards authoring root position and rotation but preserves scale', () => {
  const graph = { nodes: [{ id: 'root', position: [-20, 0, 135], quaternion: [0, 1, 0, 0], scale: [2, 3, 4] }, { id: 'child', parentId: 'root', position: [1, 2, 3] }] };
  let point;
  walkGraph(graph, { rootTransform: 'spawned', visit: ({ node, matrix }) => { if (node.id === 'child') point = new Vector3().setFromMatrixPosition(matrix).toArray(); } });
  assert.deepEqual(point, [2, 6, 12]);
});
