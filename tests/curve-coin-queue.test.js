import test from 'node:test';
import assert from 'node:assert/strict';
import { CurveCoinQueue } from '../src/curve-coin-queue.js';
const row=(extra={})=>({count:4,skip:1,origin:[0,0,100],endDistance:180,owner:{chunkId:1,key:'1:curve'},
 createCoin:(index,c)=>({type:'coin',x:0,y:1,distance:100+index*c.levelSpeed,coinCurve:{sourceIndex:index}}),...extra});
const ctx={playerDistance:0,levelSpeed:11};
test('CoinCurve yields at most one index each Update; skip consumes a frame and position samples live level speed',()=>{
 const q=new CurveCoinQueue();q.activate(row());
 assert.equal(q.update(ctx)[0].distance,100);assert.equal(q.update(ctx).length,0);
 const next=q.update({...ctx,levelSpeed:22})[0];assert.equal(next.coinCurve.sourceIndex,2);assert.equal(next.distance,144);
 assert.equal(q.update(ctx).length,1);assert.equal(q.update(ctx).length,0);
});
test('new rows during flight require curveZ strictly beyond final flight target',()=>{
 const q=new CurveCoinQueue();const flight={active:true,targetZ:100};
 assert.equal(q.activate(row({flight})),null);assert.equal(q.activate(row({flight,origin:[0,0,99]})),null);
 assert.equal(typeof q.activate(row({flight,origin:[0,0,101]})),'number');assert.equal(q.rows.size,1);
});
test('first collection/removal cancels pending production; retirement and restart release ownership',()=>{
 const q=new CurveCoinQueue();const id=q.activate(row());q.update(ctx);q.cancel(id);
 assert.equal(q.update(ctx).length,0);q.retireActivation('1:curve');assert.equal(q.rows.size,0);
 q.activate(row());q.reset();assert.equal(q.update(ctx).length,0);
});
test('flightbegin deactivates existing top-level rows only, preserving ground and exact-height-seven curves',()=>{
 const q=new CurveCoinQueue();const a=q.activate(row({origin:[0,7,100]})),b=q.activate(row({origin:[0,7.01,100]}));
 assert.deepEqual([...q.flightStarted()],[b]);const emitted=q.update(ctx);
 assert.equal(emitted.length,1);assert.equal(emitted[0].coinCurve.rowId,a);
});


test('a skipped final index consumes its frame before row completion on the next Update',()=>{
 const q=new CurveCoinQueue(),id=q.activate(row({count:2,skip:1}));
 assert.equal(q.update(ctx).length,1);assert.equal(q.update(ctx).length,0);assert.equal(q.rows.get(id).spawning,true);
 assert.equal(q.update(ctx).length,0);assert.equal(q.rows.get(id).spawning,false);
});
