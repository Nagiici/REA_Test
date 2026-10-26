import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentPieces, partitionEnvironment } from '../src/environment-layout.js';

test('source station and epic sequences preserve short ends and full middle pieces', () => {
  assert.deepEqual(environmentPieces({_type:16}, 6), [
    {part:'Start',startBlock:0,blocks:1}, {part:'Mid',startBlock:1,blocks:2},
    {part:'Mid',startBlock:3,blocks:2}, {part:'End',startBlock:5,blocks:1},
  ]);
  assert.deepEqual(environmentPieces({_type:32},12), [
    {part:'Start',startBlock:0,blocks:4}, {part:'Mid',startBlock:4,blocks:4}, {part:'End',startBlock:8,blocks:4},
  ]);
  assert.deepEqual(environmentPieces({_type:64},2), []);
});

test('authored forced environments override only their block interval', () => {
  const filler={_type:1,_density:2}, station={_type:16,_density:0};
  const nativeMatrix=[1,0,0,0,0,1,0,0,0,0,1,1360,0,0,0,1];
  assert.deepEqual(partitionEnvironment(10,filler,[{kind:'Environment',fields:{_environmentKind:station,_blockCount:4},nativeMatrix}],100),[
    {startBlock:0,blocks:4,kind:filler},{startBlock:4,blocks:4,kind:station},{startBlock:8,blocks:2,kind:filler},
  ]);
});
