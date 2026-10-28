import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RunnerGame } from '../src/game-core.js';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { EnvironmentRouteGenerator } from '../src/environment-layout.js';
const root = new URL('../public/assets/recovered/', import.meta.url);
const read = path => JSON.parse(fs.readFileSync(new URL(path, root)));
const library = read('route-library.json'); library.modelBindings = read(library.modelBindingsFile);
const bindings = read(read('manifest.json').environmentBindings);
const generator = seed => new EnvironmentRouteGenerator(new SourceRouteGenerator(library, { seed }), bindings, { workerOptions: { now: () => 0 } });
function make(config={}) {const g=new RunnerGame(config);g.setRouteGenerator(generator(config.seed??1));g.start();return g;}
function land(g) {
 for(let i=0;i<5000;i++) {
  g.advance(1/120);
  assert.equal(g.state.phase,'running',`z=${g.state.distance}, y=${g.state.player.y}, ${JSON.stringify(g.state.collision)}`);
  if(!g.state.flight&&g.state.player.grounded)return;
 }
 assert.fail('flight did not reach physical support');
}
function authoredSeam(g,target) {
 const landing=g.routeTrace.find(c=>c.jetpackLanding?.kind==='landing'&&c.startDistance===target);
 assert.ok(landing);assert.equal(landing.length,18);
 assert.ok(g.routeTrace.some(c=>c.startDistance===target+18&&!c.jetpackLanding),'ordinary content follows immediately');
 assert.ok(!g.routeTrace.some(c=>c.jetpackLanding?.kind==='landing-safety-padding'));
 assert.ok(!g.routeGenerator.queue.events.some(e=>['reject-landing','missed-strict-landing'].includes(e.type)));
}

test('48 minimum/maximum-speed flights reach real support with an authored 18-unit landing section',()=>{
 for(const speed of [11,22])for(let seed=1;seed<=24;seed++) {
  const g=make({seed,initialSpeed:speed,maximumSpeed:speed,acceleration:0});
  const built=JSON.stringify(g.routeTrace),count=g.routeTrace.length;
  g.activatePowerup('jetpack');const target=g.state.flight.targetZ;land(g);
  assert.equal(g.state.player.y,g.state.player.floor);
  assert.equal(JSON.stringify(g.routeTrace.slice(0,count)),built,'already-built scene is immutable');
  authoredSeam(g,target);
  g.drainEvents();g.advance(1/120);
  assert.equal(g.drainEvents().filter(e=>e.type==='land').length,1);
  g.advance(1/120);assert.equal(g.drainEvents().filter(e=>e.type==='land').length,0);
 }
});

test('4000 queued chunks remain continuous with repeated strict landing directives and no ordinary safety filler',()=>{
 let count=0,landings=0;
 for(let seed=1;seed<=8;seed++) {
  const route=generator(seed);let z=0,edge=0,total=0,requestAt=4;
  for(let step=0;total<500&&step<10000;step++,z+=9) {
   if(total>=requestAt) {
    const target=Math.ceil(Math.max(route.queue.spawnedEdge+37,route.minimumJetpackLandingZ)/18)*18;
    assert.equal(route.scheduleJetpackLanding(target,route.queue.spawnedEdge),target);requestAt+=37;
   }
   const chunks=route.updateCourse({playerDistance:z,speed:22},{prime:step===0});
   for(const chunk of chunks) {
    assert.equal(chunk.provenance.queue.startDistance,edge);edge+=chunk.length;total++;count++;
    assert.ok(chunk.entities.every(e=>Number.isFinite(e.x)&&Number.isFinite(e.distance)));
    if(chunk.provenance.jetpackLanding?.kind==='landing') {landings++;assert.equal(chunk.length,18);}
    assert.notEqual(chunk.provenance.jetpackLanding?.kind,'landing-safety-padding');
   }
  }
  assert.ok(total>=500);assert.ok(!route.queue.events.some(e=>e.type==='missed-strict-landing'));
 }
 assert.ok(count>=4000);assert.ok(landings>=100);
});

test('36 long upgraded flights preserve lane control and a reachable ordinary landing route',()=>{
 for(const initialSpeed of [11,17,22])for(const lane of [0,1,2])for(let seed=1;seed<=4;seed++) {
  const g=make({seed,initialSpeed,maximumSpeed:22,powerupTier:6});g.state.player.y=seed%2?3:0;
  g.activatePowerup('jetpack');const target=g.state.flight.targetZ;
  if(lane!==1)g.action(lane===0?'left':'right');
  while(g.state.flight)g.advance(1/120);
  assert.equal(g.state.player.lane,lane,'no automatic centering on expiry');
  // Authored following chunks can contain side-lane train fronts. A player
  // may steer during descent; the source does not promise all lanes are empty.
  if(lane!==1)assert.equal(g.action(lane===0?'right':'left'),true);
  land(g);assert.equal(g.state.player.lane,1);authoredSeam(g,target);
 }
});

test('source following train roof remains a valid landing surface instead of being displaced by a blank chunk',()=>{
 const g=make({seed:2,initialSpeed:22,maximumSpeed:22,acceleration:0});
 g.activatePowerup('jetpack');g.action('left');const target=g.state.flight.targetZ;land(g);
 assert.ok(Math.abs(g.state.player.y-2.92)<1e-5);
 assert.ok(g.state.distance>target+18);assert.ok(g.state.distance<target+19);
 assert.equal(g.state.collision,null);authoredSeam(g,target);
 assert.equal(g.action('jump'),true,'roof contact supports the next jump');
});

test('a source train-front collision is avoidable during descent without deleting the train or granting immunity',()=>{
 const a=make({seed:3,initialSpeed:17,maximumSpeed:22,powerupTier:6});
 const b=make({seed:3,initialSpeed:17,maximumSpeed:22,powerupTier:6});
 for(const g of [a,b]){g.activatePowerup('jetpack');g.action('left');while(g.state.flight)g.advance(1/120);}
 assert.equal(b.action('right'),true);land(b);assert.equal(b.state.phase,'running');
 for(let i=0;i<150&&a.state.phase==='running';i++)a.advance(1/120);
 assert.equal(a.state.phase,'gameover');assert.equal(a.state.collision.type,'train');
 const train=a.entities.find(e=>e.id===a.state.collision.id);
 assert.ok(train);assert.ok(a.state.player.y<train.height);
 assert.ok(a.state.distance<train.distance-train.depth/2,'native trigger reaches front before the physical body enters it');
 assert.ok(b.entities.some(e=>e.type==='train'&&Math.abs(e.distance-train.distance)<1e-6),'steering does not delete the obstacle');
});
