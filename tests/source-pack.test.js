import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SourceRouteGenerator } from '../src/route-generator.js';

const root = new URL('../public/assets/recovered/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, root)));
const manifest = read('manifest.json');
const library = read('route-library.json');
library.modelBindings = read(library.modelBindingsFile);

test('all recovered route graphs compile across seeds with finite geometry and existing visual resources', () => {
  assert.equal(Object.keys(library.routes).length, 49);
  const seenTypes = new Set();
  for (let seed = 1; seed <= 16; seed++) {
    const generator = new SourceRouteGenerator(library, { seed });
    for (const id of generator.chunkIds) {
      const result = generator.compileChunk(id, { startDistance: 123, speed: seed % 2 ? 11 : 18 });
      assert.ok(result.length > 0, id);
      for (const entity of result.entities) {
        seenTypes.add(entity.type);
        assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.distance), `${id}: position`);
        for (const key of ['width', 'depth', 'bottom', 'height', 'y']) if (entity[key] != null) assert.ok(Number.isFinite(entity[key]), `${id}: ${key}`);
        if (entity.visual) {
          assert.equal(entity.visual.matrix.length, 16, id);
          assert.ok(entity.visual.matrix.every(Number.isFinite), id);
          assert.ok(manifest.prefabs[entity.visual.prefabKey] || manifest.meshes[entity.visual.meshKey], `${id}: ${JSON.stringify(entity.visual)}`);
        }
        assert.ok(entity.provenance, `${id}: missing source provenance`);
      }
      assert.ok(!result.diagnostics.some(item => item.kind === 'unsupported-collider'), id);
    }
  }
  for (const type of ['coin', 'train', 'ramp', 'obstacle', 'decoration']) assert.ok(seenTypes.has(type), type);
});

test('every exported prefab has complete meshes and all environment mappings resolve', () => {
  for (const [name, pointer] of Object.entries(manifest.prefabs)) {
    const prefab = read(pointer.file);
    for (const node of prefab.nodes) if (node.mesh) assert.ok(manifest.meshes[node.mesh], `${name}/${node.id}: ${node.mesh}`);
  }
  const bindings = read(manifest.environmentBindings);
  for (const category of bindings.routeEnvironmentModelAssets) for (const asset of category.EnvironmentAssets) {
    for (const variant of asset.SequenceVariations) for (const part of Object.values(variant)) for (const pointer of Object.values(part)) {
      if (pointer.ref) assert.ok(manifest.prefabs[pointer.prefabKey], pointer.ref);
    }
  }
});
