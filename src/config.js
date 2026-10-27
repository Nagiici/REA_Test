// Mixed source-derived constructor defaults and browser-specific tuning.
// Native source uses 10 world units per browser unit. Constructor values can be
// overwritten by Unity serialization / XLua and are NOT measured runtime state.
export const DEFAULT_CONFIG = Object.freeze({
  fixedStep: 1 / 120,
  laneSpacing: 2,
  laneChangeDistance: 3,
  initialSpeed: 11,
  maximumSpeed: 22,
  acceleration: 0.055,
  gravity: 20,
  jumpHeight: 2,
  distancePerMeter: 0.8,
  rollSeconds: 0.5416669845581055,
  boardRollSeconds: 0.5416660308837891,
  playerRadius: 0.3,
  standingHeight: 1,
  standingBottom: 0.05,
  rollingHeight: 0.6,
  rollingBottom: 0.1,
  triggerForwardOffset: 0.1,
  lookAhead: 140,
  removeBehind: 18,
  // Fresh browser profile; raw native multiplier clamps player level to 0..30.
  playerLevel: 1,
  powerupTier: 0,
  // Explicit local demo allowance, unrelated to native account or purchases.
  localRevives: 1,
  seed: 48709,
});

export const CONFIG_STATUS = 'provisional-browser-tuning';

export const CONFIG_PROVENANCE = {
  initialSpeed: 'EncryptedSpeedInfo constructor VA 0x11b9dac: min 110 / 10',
  maximumSpeed: 'EncryptedSpeedInfo constructor VA 0x11b9dac: max 220 / 10',
  acceleration: 'Game.Speed VA 0x11baeac: linear min/max interpolation over rampUpDuration=200 seconds',
  laneSpacing: 'Route.GetTrackX VA 0x231529c: trackIndex * 20, centered then scaled / 10',
  laneChangeDistance: 'RunningState.HandleSwipe 82543: ordinary change takes 30 / native currentSpeed seconds; teleboard uses 20, flight uses 60',
  laneInterpolation: 'Closure VA 0x22acec0 / coroutine VA 0x22acfc4: linear clamped interpolation, duration proportional to fractional lane distance',
  gravity: 'CharacterBase constructor VA 0x22a2d6c: _gravity 200 / 10',
  jumpHeight: 'CharacterBase constructor VA 0x22a2d6c: jumpHeightNormal 20 / 10',
  jumpVelocity: 'CharacterBase.CalculateJumpVerticalSpeed VA 0x229b348: sqrt(2 * height * gravity)',
  rollSeconds: 'CharacterRendering roll coroutine 82325: original roll AnimationState.length deadline; ignored repeat input in Character.Roll 81948',
  distancePerMeter: 'Game constructor VA 0x11b98ec: distancePerMeter 8 / 10',
  scoring: 'GameStats.CalculateScore: integer meter delta * current multiplier; CoinToScoreConversion: coins * rawMultiplier * 2',
  other: 'Browser implementation tuning; not recovered native behavior',
};
