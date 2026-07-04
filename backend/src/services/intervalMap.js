'use strict';

/**
 * IntervalMap — an O(log n) data structure for "given a set of busy
 * [start, end) ranges, is this candidate range overlapping any of them?".
 *
 * The build prompt requires every placement check to be O(log n) before
 * committing an assignment (so a heavy CSP search stays fast). Each map
 * is scoped to a single scope key — e.g. one IntervalMap per
 * (teacher, day), or per (room, day). `add`/`remove` mutate a single
 * scope; `overlaps` is the placement-check entry point.
 *
 * Internally each scope is a sorted array of disjoint [start, end)
 * intervals. `overlaps` does a single binary-search pass; `add` and
 * `remove` merge / split as needed. In the worst case add/remove are
 * O(n) (full merge) but in routine scheduling a teacher's day rarely has
 * more than ~8 sessions, so it's effectively constant.
 *
 * Times are integers — minutes-since-midnight. That keeps comparison
 * fast and matches MySQL TIME columns (we'll convert HH:MM on the way in
 * and out).
 */

function compareIntervals(a, b) {
  return a.start - b.start;
}

class IntervalMap {
  constructor() {
    /** @type {Map<string, Array<{start:number,end:number}>>} */
    this.scopes = new Map();
  }

  _scope(key) {
    let arr = this.scopes.get(key);
    if (!arr) {
      arr = [];
      this.scopes.set(key, arr);
    }
    return arr;
  }

  /**
   * Record a new busy interval [start, end) under `key`. Merges with any
   * existing intervals that touch or overlap it, so callers never have to
   * pre-check for overlaps themselves.
   *
   * Invariant after every add: each scope is a sorted array of disjoint
   * [start, end) ranges (closed-open: [540, 590) and [590, 640) merge
   * into [540, 640)).
   */
  add(key, start, end) {
    if (end <= start) return; // zero-length or inverted — ignore
    const arr = this._scope(key);
    // Find the first stored interval whose end >= start (touching or
    // overlapping). Walk the list with strict-less so equal-end stays.
    let lo = 0;
    while (lo < arr.length && arr[lo].end < start) lo += 1;
    if (lo < arr.length && arr[lo].start <= end) {
      // arr[lo] touches or overlaps the new range; absorb its start.
      start = Math.min(start, arr[lo].start);
    } else if (lo > 0 && arr[lo - 1].end >= start) {
      // The previous interval touches our start.
      lo -= 1;
      start = Math.min(start, arr[lo].start);
    }
    // Walk forwards merging every interval whose start <= end (touching
    // or overlapping the new range). Expand `end` right as needed.
    let hi = lo;
    while (hi < arr.length && arr[hi].start <= end) {
      end = Math.max(end, arr[hi].end);
      hi += 1;
    }
    arr.splice(lo, hi - lo, { start, end });
  }

  /**
   * Remove a previously-added interval. If a single stored range was
   * widened by a merge, it is split so the freed portion becomes free
   * again.
   */
  remove(key, start, end) {
    const arr = this.scopes.get(key);
    if (!arr) return;
    for (let i = 0; i < arr.length; i += 1) {
      const iv = arr[i];
      if (end <= iv.start || start >= iv.end) continue; // no overlap
      // Partial overlaps split the interval.
      if (start > iv.start && end < iv.end) {
        arr.splice(i, 1, { start: iv.start, end: start }, { start: end, end: iv.end });
        return;
      }
      if (start <= iv.start && end >= iv.end) {
        arr.splice(i, 1);
        i -= 1; // re-check shifted elements
        continue;
      }
      if (start <= iv.start) {
        arr[i] = { start: end, end: iv.end };
      } else {
        arr[i] = { start: iv.start, end: start };
      }
    }
    // Keep the snapshot tidy: drop scopes that have been completely
    // drained so a "post-undo" snapshot equals `{}` rather than
    // `{ key: [] }`. This matches what the undo unit test asserts.
    if (arr.length === 0) this.scopes.delete(key);
  }

  /**
   * The placement-check entry point. Returns true iff [start, end)
   * overlaps any stored interval under `key`. O(log n) because the
   * scopes are kept sorted + disjoint.
   */
  overlaps(key, start, end) {
    const arr = this.scopes.get(key);
    if (!arr || arr.length === 0) return false;
    // Find the first interval whose end is strictly greater than `start`
    // (binary search). If that interval starts before `end`, we overlap.
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].end <= start) lo = mid + 1;
      else hi = mid;
    }
    const candidate = arr[lo];
    if (!candidate) return false;
    if (candidate.end <= start) return false;
    return candidate.start < end;
  }

  /**
   * Total number of stored intervals across all scopes — handy for the
   * undo unit test, which asserts that after undoing a course the
   * total store size returns to its pre-placement value.
   */
  size() {
    let n = 0;
    for (const arr of this.scopes.values()) n += arr.length;
    return n;
  }

  /**
   * Diagnostic dump used by tests.
   */
  snapshot() {
    const out = {};
    for (const [k, arr] of this.scopes.entries()) {
      out[k] = arr.map((iv) => [iv.start, iv.end]).sort((a, b) => a[0] - b[0]);
    }
    return out;
  }
}

module.exports = { IntervalMap };