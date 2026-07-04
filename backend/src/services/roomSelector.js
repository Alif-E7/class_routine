'use strict';

/**
 * roomSelector — pick a room for a session from the eligible pool,
 * biased by `room_preference` weights but tolerating missing data.
 *
 * Per the build prompt:
 *   - Filter to rooms whose `type` matches the course's `derived_type`
 *     (theory -> classroom, lab -> lab).
 *   - Among those, prefer rooms that have a `room_preference` row for
 *     the course's `year_group`. Weights for that (room_type, year_group)
 *     bucket are normalised and used as the probability mass.
 *   - If no room has a preference row for that bucket, fall back to
 *     uniform-random over all rooms of the correct type.
 *   - Caller is responsible for excluding rooms that are busy in the
 *     candidate window (we don't know that here). We just return one
 *     candidate; the scheduler tries alternatives on miss.
 *
 * `rng` defaults to Math.random but is injected for the property-style
 * "20 random instances must produce zero collisions" test.
 */

const typeMatches = {
  theory: 'classroom',
  lab: 'lab',
};

/**
 * Build a bucket of weights keyed by year_group from the
 * `room_preference` rows. Rooms not listed get weight 0 (still eligible
 * only as a uniform fallback).
 */
function buildWeightTable(roomPreferenceRows) {
  // map: year_group -> [{ room_id, weight_percent }]
  const table = new Map();
  for (const row of roomPreferenceRows) {
    const yg = String(row.year_group);
    const arr = table.get(yg) || [];
    arr.push({
      room_id: String(row.room_id),
      weight_percent: Number(row.weight_percent) || 0,
    });
    table.set(yg, arr);
  }
  return table;
}

/**
 * Pick a single room from `eligibleRooms` for `course`. `weightTable`
 * comes from `buildWeightTable`. Returns the chosen room_id string, or
 * null when `eligibleRooms` is empty.
 *
 * Pass `rng = () => 0` to always pick the top-weighted room
 * (deterministic, useful for tests).
 */
function pickRoom({ course, eligibleRooms, weightTable, rng = Math.random }) {
  if (!eligibleRooms || eligibleRooms.length === 0) return null;
  if (eligibleRooms.length === 1) return eligibleRooms[0].room_id;

  const yg = String(course.year_sem);
  const weighted = (weightTable.get(yg) || [])
    .filter((w) => w.weight_percent > 0)
    .map((w) => ({ ...w, _id: String(w.room_id) }));

  // Filter to rooms that are eligible AND have a positive weight.
  const eligibleSet = new Set(eligibleRooms.map((r) => String(r.room_id)));
  const pool = weighted.filter((w) => eligibleSet.has(w._id));

  if (pool.length === 0) {
    // Fallback: uniform random over all eligible rooms.
    return eligibleRooms[Math.floor(rng() * eligibleRooms.length)].room_id;
  }

  const total = pool.reduce((s, p) => s + p.weight_percent, 0);
  if (total <= 0) {
    return pool[Math.floor(rng() * pool.length)]._id;
  }
  const target = rng() * total;
  let acc = 0;
  for (const p of pool) {
    acc += p.weight_percent;
    if (target <= acc) return p._id;
  }
  return pool[pool.length - 1]._id; // numeric rounding safety
}

/**
 * Convenience: filter all rooms to the subset of the right type for the
 * course. Used by the scheduler before each pick attempt.
 */
function filterByType(rooms, course) {
  const need = typeMatches[course.derived_type];
  if (!need) {
    throw new Error(`Unknown derived_type on course ${course.course_code}: ${course.derived_type}`);
  }
  return rooms.filter((r) => r.type === need);
}

module.exports = {
  buildWeightTable,
  pickRoom,
  filterByType,
  typeMatches,
};