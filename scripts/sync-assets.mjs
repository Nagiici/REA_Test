import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(project, '../analysis/unity-resources/runtime-assets');
const patchSource = path.resolve(project, '../analysis/powerups/resources/runtime-assets-patch');
const destination = path.join(project, 'public/assets/recovered');
// Validate both inputs before replacing the public manifest.
const patch = JSON.parse(await fs.readFile(path.join(patchSource, 'manifest.patch.json'), 'utf8'));
await fs.mkdir(destination, { recursive: true });
for (const name of await fs.readdir(source)) {
  if (!/\.(json|png)$/i.test(name)) continue;
  if (name === 'checksums.json') continue;
  if (name === 'manifest.json') {
    const manifest = JSON.parse(await fs.readFile(path.join(source, name), 'utf8'));
    delete manifest.sourceApk;
    await fs.writeFile(path.join(destination, name), JSON.stringify(manifest));
  } else await fs.copyFile(path.join(source, name), path.join(destination, name));
}
for (const name of await fs.readdir(patchSource)) {
  if (!/\.(json|png)$/i.test(name) || name === 'manifest.patch.json') continue;
  await fs.copyFile(path.join(patchSource, name), path.join(destination, name));
}
const manifestPath = path.join(destination, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
for (const key of ['meshes', 'textures', 'prefabs']) Object.assign(manifest[key], patch[key]);
manifest.powerupPrefabs = patch.powerupPrefabs;
manifest.powerupParameters = 'powerup-parameters.json';
manifest.powerupSpawnpoints = 'powerup-spawnpoints.json';
await fs.writeFile(manifestPath, JSON.stringify(manifest));
// The public manifest omits the local APK path, so hash the actual public bytes.
const checksums = {};
for (const name of (await fs.readdir(destination)).sort()) {
  if (name === 'checksums.json' || !/\.(json|png)$/i.test(name)) continue;
  checksums[name] = createHash('sha256').update(await fs.readFile(path.join(destination, name))).digest('hex');
}
await fs.writeFile(path.join(destination, 'checksums.json'), JSON.stringify(checksums, null, 2) + '\n');
console.log(`Copied recovered runtime resources to ${destination}`);
