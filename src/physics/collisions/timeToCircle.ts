/**
 * Earliest t ≥ 0 at which a point at (dx, dz) moving with (vx, vz) reaches distance r from the origin,
 * only while approaching. Already within r and approaching → 0. Used for ball-ball (relative motion,
 * r = 2R), ball-vertex (r = R) and pocket entry (r = hole radius).
 */
export function timeToCircle(dx: number, dz: number, vx: number, vz: number, r: number): number {
  const b = dx * vx + dz * vz;
  if (b >= 0) return Infinity;
  const c = dx * dx + dz * dz - r * r;
  if (c <= 0) return 0;
  const a = vx * vx + vz * vz;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  return c / (-b + Math.sqrt(disc)); // = (-b - √disc)/a, without cancellation when c ≈ 0
}
