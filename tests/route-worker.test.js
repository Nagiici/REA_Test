import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteWork, RouteWorker, routeWorkFactor } from '../src/route-worker.js';
import { RunnerGame } from '../src/game-core.js';

test('nested enumerators run one MoveNext at a time; null yields are checkpoints, not frame delays', () => {
 const events=[];
 function* inner(){events.push('child');yield;events.push('child-end');}
 function* outer(){events.push('parent');yield inner();events.push('parent-end');return 42;}
 const work=new RouteWork(outer());
 work.step();assert.deepEqual(events,['parent']);assert.equal(work.stack.length,2);
 work.step();assert.deepEqual(events,['parent','child']);
 work.step();assert.deepEqual(events,['parent','child','child-end']);assert.equal(work.done,false);
 work.step();assert.equal(work.done,true);assert.equal(work.value,42);
});

test('2–5ms wall-time budget slices actual work; +80 forces only the current head', () => {
 let time=0;const w=new RouteWorker({now:()=>time}),events=[];
 function* work(name){for(let i=0;i<20;i++){time+=1;events.push(name);yield;}}
 w.enqueue('spawn',{startDistance:89,id:1},work('a'));
 w.enqueue('spawn',{startDistance:89,id:2},work('b'));
 w.update(0);assert.equal(events.length,3);assert.equal(w.lastUpdate.completed,false);
 assert.ok(Math.abs(w.lastUpdate.budgetMs-2.3)<1e-5);
 w.update(9);assert.equal(events.length,20);assert.equal(w.spawn.length,1);assert.equal(w.lastUpdate.factor,1);
 w.update(9);assert.equal(events.filter(x=>x==='b').length,20);
 assert.equal(routeWorkFactor(90,80,10),0);assert.equal(routeWorkFactor(80,80,10),1);
});

test('spawn and cleanup alternate; cleanup boundary uses chunk END and cannot steal both queues in one update', () => {
 let time=0;const w=new RouteWorker({now:()=>time}),events=[];
 function* work(name){events.push(name);time+=10;yield;events.push(name+'-end');}
 w.enqueue('spawn',{startDistance:85},work('spawn'));
 w.enqueue('despawn',{endDistance:-49},work('cleanup'));
 w.update(0);assert.deepEqual(events,['spawn']);
 w.update(0);assert.deepEqual(events,['spawn','cleanup']);assert.equal(w.lastUpdate.kind,'despawn');
 assert.ok(w.lastUpdate.factor<1);
 w.update(0);assert.equal(events.at(-1),'spawn-end');
 w.update(1);assert.equal(events.at(-1),'cleanup-end');assert.equal(w.lastUpdate.factor,1);
});

test('cleanup of pending content finishes that chunk first and delivers completion only once', () => {
 const w=new RouteWorker({now:()=>0}),chunk={startDistance:85,endDistance:100};let done=0,selected=0;
 function* build(){selected++;yield;selected++;}
 w.enqueue('spawn',chunk,build(),()=>done++);
 w.enqueue('despawn',chunk,(function*(){yield;})());
 assert.equal(selected,2);assert.equal(done,1);
 w.update(0);w.update(200);assert.equal(done,1);assert.equal(w.byChunk.size,0);
});

test('reset abandons old jobs without publishing stale chunks into a new run', () => {
 const w=new RouteWorker({now:()=>0});let done=0;
 w.enqueue('spawn',{startDistance:0},(function*(){yield;})(),()=>done++);
 w.reset();w.update(0);assert.equal(done,0);assert.equal(w.spawn.length,0);assert.equal(w.byChunk.size,0);
});

test('route update runs once per advance, not once per accumulated physics step, and pauses with gameplay', () => {
 const g=new RunnerGame();g.start();let updates=0;g.ensureCourse=()=>updates++;
 g.advance(.1);assert.equal(updates,1);g.pause();g.advance(.1);assert.equal(updates,1);
 g.pause();g.advance(1/240);assert.equal(updates,2);
});
