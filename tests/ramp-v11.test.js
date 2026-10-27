import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RunnerGame } from '../src/game-core.js';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { controllerCapsule, controllerInterval } from '../src/classic-controller.js';
import { capsuleEntitySeparation } from '../src/classic-contact.js';
const read=n=>JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/'+n,import.meta.url)));
const library=read('route-library.json');library.collisionTags=read('classic-collision-index.json');library.modelBindings=read(library.modelBindingsFile);
const source=new SourceRouteGenerator(library,{seed:40}).compileChunk('routes/default/chunks/normal/routechunk_default_ramp_1',{startDistance:0,speed:11});
const setup=speed=>{const g=new RunnerGame({initialSpeed:speed,maximumSpeed:speed,acceleration:0});g.entities=[];g.nextSection=Infinity;g.start();source.entities.forEach(e=>g.addEntity(structuredClone(e)));g.state.distance=2;return g;};

for(const speed of [11,16.5,22]) for(const mode of ['run','jump','roll','jump-roll']) test(`actual ramp carriage remains solid through ${mode} at speed ${speed}`,()=>{
 const g=setup(speed),p=g.state.player,ramps=g.entities.filter(e=>e.type==='ramp');let acted=false,rolled=false,risingContact=false;
 while(g.state.distance<16.5){
  if(!acted&&g.state.distance>=4){if(mode.startsWith('jump'))g.action('jump');if(mode==='roll')g.action('roll');acted=true;}
  if(mode==='jump-roll'&&!rolled&&g.state.distance>=7){g.action('roll');rolled=true;}
  const previousVelocity=p.velocityY;g.advance(1/120);
  assert.equal(g.state.phase,'running',`died at ${g.state.distance}`);
  for(const e of ramps){
   const separation=capsuleEntitySeparation(controllerCapsule([p.x,p.y,g.state.distance],p.colliderSqueezed),e);
   assert.ok(separation>=-1e-7,`${mode} penetrated ${e.sourceShape.type} by ${-separation} at ${g.state.distance}`);
   if(mode==='jump'&&separation<1e-6&&p.velocityY>0){risingContact=true;assert.ok(Math.abs(p.velocityY-(previousVelocity-g.config.gravity/120))<1e-7,'ramp must not zero upward jump speed');}
  }
 }
 if(mode==='jump')assert.ok(risingContact,'exercise the previously missed rising contact');
 assert.ok(p.y>=2.92-1e-6,'reaches train roof instead of running beneath it');
});

test('ramp crossing does not teleport a foot already under the slope or entering its high side',()=>{
 const g=setup(11),e=g.entities.find(e=>e.type==='ramp'&&e.sourceShape.type==='box');g.entities=[e];
 assert.equal(g.rampSupportAlongMove([0,0,8],[0,.1,8.1]),-Infinity);
 assert.equal(g.rampSupportAlongMove([2,0,8],[0,.1,8.1]),-Infinity);
 const before=controllerInterval(e,0,8),next=controllerInterval(e,0,8.1);
 assert.ok(next.max>before.max+.01);
 assert.ok(Math.abs(g.rampSupportAlongMove([0,before.max+.01,8],[0,before.max+.02,8.1])-next.max)<1e-7);
 e.collisionDisabled=true;
 assert.equal(g.rampSupportAlongMove([0,before.max+.01,8],[0,before.max+.02,8.1]),-Infinity);
});

// Exercise actual prefab construction and rendering transforms, not only
// collision math: this carriage's editor root was offset by 37.3 native units.
const THREE=await import('three');
const {prefabFromUnity}=await import('../src/asset-adapter.js');
const {createEntityVisual}=await import('../src/entity-visuals.js');
function visualPack(definition){
 const meshData=Object.fromEntries(definition.nodes.filter(n=>n.mesh).map(n=>[n.mesh,read(n.mesh+'.json')]));
 const original=prefabFromUnity(definition,meshData,{},read('manifest.json'));
 return {original,prefabData:{MexicoCity_train_ramp:definition},clonePrefab:()=>original.clone(true)};
}

test('actual ramp placeholder places rendered carriage over its own colliders in every lane',()=>{
 const definition=read('MexicoCity_train_ramp.prefab.json'),pack=visualPack(definition);
 const entity=source.entities.find(e=>e.visual?.prefabKey==='MexicoCity_train_ramp');
 assert.equal(entity.visual.placeholderRoot,true);
 const authored=pack.original.getObjectByName(definition.nodes.find(n=>n.parentId==null).name);
 assert.ok(Math.abs(authored.position.x-37.3)<1e-5);
 for(const lane of [-2,0,2]){
  const object=createEntityVisual(entity,pack);object.position.set(lane,0,-entity.distance);object.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(object);
  assert.ok(bounds.min.x<lane-.8&&bounds.max.x>lane+.8);
  assert.ok(bounds.min.x>lane-1.2&&bounds.max.x<lane+1.2,'no extra 3.73 offset');
  assert.ok(bounds.max.y>2.9&&bounds.max.y<3);
 }
 assert.ok(Math.abs(authored.position.x-37.3)<1e-5,'shared source prefab must not be modified');
 const retained=createEntityVisual({visual:{prefabKey:'MexicoCity_train_ramp'}},pack);
 assert.ok(new THREE.Box3().setFromObject(retained).min.x>2.6,'non-placeholder placement remains authored');
});

test('placeholder reset preserves root scale and child transforms while clearing only root placement',()=>{
 const definition=structuredClone(read('MexicoCity_train_ramp.prefab.json'));
 const root=definition.nodes.find(n=>n.parentId==null),child=definition.nodes.find(n=>n.parentId===root.id);
 root.quaternion=[0,Math.SQRT1_2,0,Math.SQRT1_2];root.scale=[2,3,4];root.active=false;child.position=[1,2,3];
 const pack=visualPack(definition),object=createEntityVisual({visual:{prefabKey:'MexicoCity_train_ramp',placeholderRoot:true}},pack);
 const node=object.getObjectByName(root.name),descendant=object.getObjectByName(child.name);
 assert.deepEqual(node.position.toArray(),[0,0,0]);assert.deepEqual(node.quaternion.toArray(),[0,0,0,1]);
 assert.deepEqual(node.scale.toArray(),[2,3,4]);assert.equal(node.visible,true);assert.deepEqual(descendant.position.toArray(),[1,2,3]);
});
