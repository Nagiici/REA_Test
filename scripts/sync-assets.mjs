import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(project, '../analysis/unity-resources/runtime-assets');
const patchSource = path.resolve(project, '../analysis/powerups/resources/runtime-assets-patch');
const flightPatchSource = path.resolve(project, '../analysis/flight/resources/runtime-assets-patch');
const classicPatchSource = path.resolve(project, '../analysis/classic/resources/runtime-assets-patch');
const audioMotionPatchSource = path.resolve(project, '../analysis/classic/audio-v2/runtime-assets-patch');
const presentationPatchSource = path.resolve(project, '../analysis/classic/presentation-v3/resources/runtime-assets-patch');
const destination = path.join(project, 'public/assets/recovered');
// Read both verified additions before replacing the public manifest.
const patch = JSON.parse(await fs.readFile(path.join(patchSource, 'manifest.patch.json'), 'utf8'));
const flightPatch = JSON.parse(await fs.readFile(path.join(flightPatchSource, 'manifest.patch.json'), 'utf8'));
const classicPatch = JSON.parse(await fs.readFile(path.join(classicPatchSource, 'manifest.patch.json'), 'utf8'));
const audioMotionPatch = JSON.parse(await fs.readFile(path.join(audioMotionPatchSource, 'manifest.patch.json'), 'utf8'));
const presentationPatch = JSON.parse(await fs.readFile(path.join(presentationPatchSource, 'manifest.patch.json'), 'utf8'));
const presentationUpdates = [];
for (const name of ['intro-v4', 'effects-v4', 'audio-v4', 'revive-v4']) {
  const directory = path.resolve(project, `../analysis/classic/${name}/runtime-assets-patch`);
  try { presentationUpdates.push({ directory, patch: JSON.parse(await fs.readFile(path.join(directory, 'manifest.patch.json'), 'utf8')) }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
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
for (const directory of [patchSource, flightPatchSource, classicPatchSource, audioMotionPatchSource, presentationPatchSource, ...presentationUpdates.map(p => p.directory)]) {
  for (const name of await fs.readdir(directory)) {
    if (!/\.(json|png|wav|m4a|ogg)$/i.test(name) || name === 'manifest.patch.json') continue;
    await fs.copyFile(path.join(directory, name), path.join(destination, name));
  }
}
const manifestPath = path.join(destination, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
for (const key of ['meshes', 'textures', 'prefabs']) Object.assign(manifest[key], patch[key]);
manifest.powerupPrefabs = patch.powerupPrefabs;
manifest.powerupParameters = 'powerup-parameters.json';
manifest.powerupSpawnpoints = 'powerup-spawnpoints.json';
for (const key of ['meshes', 'textures', 'prefabs', 'animations']) {
  Object.assign(manifest[key] ??= {}, flightPatch[key] ?? {});
}
manifest.equipmentPrefabs = flightPatch.equipmentPrefabs;
manifest.equipmentAttachments = flightPatch.equipmentAttachments;
manifest.flightParameters = flightPatch.flightParameters;
for (const key of ['meshes', 'textures', 'prefabs', 'animations']) {
  Object.assign(manifest[key] ??= {}, classicPatch[key] ?? {});
}
for (const key of ['classicAnimationBindings', 'classicAnimationParameters', 'classicParameters', 'classicCollisionIndex', 'classicResourceLimitations', 'chaserActors', 'chaserSource']) {
  if (classicPatch[key] !== undefined) manifest[key] = classicPatch[key];
}
Object.assign(manifest.animations ??= {}, audioMotionPatch.animations ?? {});
for (const key of ['classicAudio', 'audioClips', 'classicMotionPools', 'normalMotionBindings', 'normalMotionPools', 'motionAnimationSourceBindings', 'guardAnimationAdditions']) {
  if (audioMotionPatch[key] !== undefined) manifest[key] = audioMotionPatch[key];
}
for (const key of ['meshes', 'textures', 'prefabs', 'animations']) {
  Object.assign(manifest[key] ??= {}, presentationPatch[key] ?? {});
}
for (const key of ['classicPresentation', 'introMotionPools', 'introAnimationAdditions', 'cameraAnimationAdditions', 'introStage']) {
  if (presentationPatch[key] !== undefined) manifest[key] = presentationPatch[key];
}
if (presentationPatch.audioAdditions) {
  const audioPath = path.join(destination, manifest.classicAudio);
  const audio = JSON.parse(await fs.readFile(audioPath, 'utf8'));
  Object.assign(audio.clips, presentationPatch.audioAdditions.clips ?? {});
  Object.assign(audio.bindings, presentationPatch.audioAdditions.bindings ?? {});
  Object.assign(manifest.audioClips ??= {}, presentationPatch.audioAdditions.clips ?? {});
  audio.limitations = audio.limitations.filter(text => !text.startsWith('CoinPool/CoinManager/Coin serialized'));
  audio.coinSourceResolution = 'CharacterPickupParticles.CoinPickup supplies the exact coin clip and pitch/volume ranges; presentation-v3 closes the earlier bounded-search gap.';
  await fs.writeFile(audioPath, JSON.stringify(audio));
}
for (const { patch: update } of presentationUpdates) {
  for (const key of ['meshes', 'textures', 'prefabs', 'animations']) Object.assign(manifest[key] ??= {}, update[key] ?? {});
  for (const key of ['classicIntroProps', 'classicAudioEvents', 'classicReviveEffect']) if (update[key]) manifest[key] = update[key];
  if (update.classicPresentationAdditions) {
    const filename = path.join(destination, manifest.classicPresentation);
    const data = JSON.parse(await fs.readFile(filename, 'utf8'));
    for (const [key, additions] of Object.entries(update.classicPresentationAdditions)) Object.assign(data[key] ??= {}, additions);
    await fs.writeFile(filename, JSON.stringify(data));
  }
  if (update.audioAdditions) {
    const filename = path.join(destination, manifest.classicAudio);
    const data = JSON.parse(await fs.readFile(filename, 'utf8'));
    Object.assign(data.clips, update.audioAdditions.clips ?? {});
    Object.assign(data.bindings, update.audioAdditions.bindings ?? {});
    Object.assign(manifest.audioClips ??= {}, update.audioAdditions.clips ?? {});
    await fs.writeFile(filename, JSON.stringify(data));
  }
}
await fs.writeFile(manifestPath, JSON.stringify(manifest));
// The public manifest omits the local APK path, so hash the actual public bytes.
const checksums = {};
for (const name of (await fs.readdir(destination)).sort()) {
  if (name === 'checksums.json' || !/\.(json|png|wav|m4a|ogg)$/i.test(name)) continue;
  checksums[name] = createHash('sha256').update(await fs.readFile(path.join(destination, name))).digest('hex');
}
await fs.writeFile(path.join(destination, 'checksums.json'), JSON.stringify(checksums, null, 2) + '\n');
console.log(`Copied recovered runtime resources to ${destination}`);
