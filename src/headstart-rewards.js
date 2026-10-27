import { HEADSTART } from './jetpack.js';

// Jetpack.PlacePickups82414, TurboHeadstartPickup d7c67f28faa90443a843fa77bc45a61e:1.
// The native three-index draw addresses the first three active Pickup children
// in serialized hierarchy order. Unity traversal order is an explicit inference.
export const HEADSTART_REWARDS = Object.freeze(['doubleScore', 'sneakers', 'magnet']);

export function makeHeadstartRewards({ flight, random, pickupSystemVersion = 1, gameType = 100 }) {
  // PlayerInfo's static profile default is 1. Versions 1/2 enable the 2014
  // branch; Migration_IsActivePickupSystemVersion2015 is hardcoded false.
  // MainGameType.Normal=100; CanHeadStartPlacePickups excludes ChaseTarget=304.
  if (!flight?.headstart || gameType === 304 || ![1, 2].includes(pickupSystemVersion)) return [];
  const rootY = HEADSTART[flight.headstartTier].height - .5;
  const selected = new Set();
  return [0, 1, 2].map(lane => {
    let index;
    do { index = Math.floor(random() * 3); } while (selected.has(index));
    selected.add(index);
    const x = lane * 2 - 2, powerup = HEADSTART_REWARDS[index];
    return { type: 'powerup', powerup, lane, x, distance: flight.targetZ,
      y: rootY + .85, pickupRootY: rootY, headstartReward: true,
      sourcePickupTrigger: { center: [x, rootY + .85, flight.targetZ], radius: .7 },
      // Existing powerup prefabs retain the matching source child subtree;
      // their native-to-browser conversion is already inside clonePrefab.
      visual: { prefabKey: `powerup_${powerup}`, matrix: [1,0,0,0, 0,1,0,rootY, 0,0,1,0, 0,0,0,1] },
      provenance: { source: 'd7c67f28faa90443a843fa77bc45a61e:1', method: 82414,
        trigger: 'SphereCollider69', tier: flight.headstartTier } };
  });
}
