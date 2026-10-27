/** MovingTrain compresses its static trigger proxy along the player's path.
 * Decode it into the rendered moving body's world coordinates for physical
 * queries. Keep the source entity unchanged for autopilot and provenance.
 * This removes finite-radius distortion; it is a browser adaptation, not a
 * claim that the original game's proxy used an identical PhysX volume. */
export function trainBodyAt(entity, distance, previousDistance = distance) {
  if (!entity.movingTrainProxy) return entity;
  const ratio = entity.movingTrainProxy.ratio, factor = 1 + ratio;
  return { ...entity,
    distance: factor * entity.distance - ratio * distance,
    previousDistance: factor * (entity.previousDistance ?? entity.distance) - ratio * previousDistance,
    depth: factor * entity.depth,
    sourceShape: entity.sourceShape ? { ...entity.sourceShape,
      rows: entity.sourceShape.rows.map(row => [row[0], row[1], row[2] / factor, row[3]])
    } : undefined,
  };
}
