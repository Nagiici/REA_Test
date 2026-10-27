import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { PickupFlash, createClassicEffects } from '../src/classic-effects.js';
import { RunnerGame } from '../src/game-core.js';
const read = file => JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/'+file,import.meta.url)));
const data=read('classic-presentation.json'), manifest=read('manifest.json');
const details=Object.values(data.sourceComponents).find(x=>x.class==='CharacterPickupParticles').fields;
const pack={classicPresentation:data,presentation:data,meshData:Object.fromEntries(Object.entries(manifest.meshes).map(([k,v])=>[k,read(v.file)])),textures:Object.fromEntries(Object.keys(manifest.textures).map(k=>[k,new THREE.Texture()]))};
test('pickup flash follows the original scale curve and finite lifetime, with a new rotation on each pickup',()=>{
 const flash=new PickupFlash(details.coinEffect);assert.equal(flash.sample().visible,false);
 flash.play(()=>.25);assert.equal(flash.sample().scale,.5);assert.equal(flash.sample().rotation,Math.PI/2);
 const peak=flash.step(details.coinEffect.duration/2);assert.ok(Math.abs(peak.scale-1.2)<1e-6);assert.equal(peak.intensity,.5);
 assert.equal(flash.step(details.coinEffect.duration).visible,false);
 flash.play(()=>.5);assert.equal(flash.sample().visible,true);assert.equal(flash.sample().intensity,1);
});
test('real classic FX react to coins, crash and jetpack; pause freezes and new run clears effects',()=>{
 const effects=createClassicEffects(pack),camera=new THREE.PerspectiveCamera(),g=new RunnerGame();g.start();
 effects.update(g.state,0,[{type:'coin'},{type:'board-hit'}],camera);
 assert.equal(effects.stats.coin.visible,true);assert.ok(effects.stats.activeParticles.fx_board_crash>0);
 const snapshot=JSON.stringify(effects.stats);g.pause();effects.update(g.state,1,[],camera);assert.equal(JSON.stringify(effects.stats),snapshot);
 g.pause();g.activatePowerup('jetpack');effects.update(g.state,.1,[],camera);assert.equal(effects.jetpack.object.visible,true);
 assert.ok(effects.jetpack.scroll.length===2);assert.ok(effects.jetpack.scroll.every(x=>Number.isFinite(x.map.offset.x)));
 g.reset();effects.update(g.state,0,[],camera);assert.equal(effects.stats.coin.visible,false);assert.equal(effects.stats.jetpack,false);
 assert.equal(Object.values(effects.stats.activeParticles).reduce((a,b)=>a+b),0);
 for(const p of Object.values(effects.particles))p.dispose();
});
