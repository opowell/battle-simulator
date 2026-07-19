/**
 * Exact kinetic solvers for the simultaneous-mode resolver (KineticResolver.js).
 *
 * A motion is analytic — never integrated in timesteps:
 *   pos(t) = p0 + v·(t − tRef) + ½·a·(t − tRef)²          (a optional, default 0)
 * so positions carry no accumulated error and interaction times are found by
 * solving the pair's distance equation directly:
 *
 *   |Δp + Δv·τ + ½Δa·τ²|² = R²         (τ = t − now, R = sum of radii)
 *
 * Straight lines (Δa = 0) make this a QUADRATIC in τ — solved in closed form.
 * Constant-acceleration (polynomial) paths make it a QUARTIC — solved exactly
 * to tolerance by smallestRootInRange(), which isolates real roots recursively
 * (a polynomial is monotonic between the roots of its derivative, so bisection
 * inside each bracket cannot miss a crossing). The same machinery extends to
 * any polynomial path degree; circular arcs would need the identical
 * bracket-and-bisect on a transcendental distance function instead.
 */

const EPS = 1e-9;

/** Position of motion m = {x0, y0, vx, vy, ax?, ay?, tRef} at absolute time t. */
export function evalMotion(m, t) {
  const dt = t - m.tRef;
  return {
    x: m.x0 + m.vx * dt + 0.5 * (m.ax ?? 0) * dt * dt,
    y: m.y0 + m.vy * dt + 0.5 * (m.ay ?? 0) * dt * dt,
  };
}

function polyEval(c, x) {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i];
  return v;
}

function polyDeriv(c) {
  const d = [];
  for (let i = 1; i < c.length; i++) d.push(c[i] * i);
  return d;
}

function trimPoly(c) {
  let n = c.length;
  while (n > 1 && Math.abs(c[n - 1]) < EPS) n--;
  return c.slice(0, n);
}

function bisect(c, lo, hi, eps) {
  let flo = polyEval(c, lo);
  for (let i = 0; i < 100 && hi - lo > eps; i++) {
    const mid = (lo + hi) / 2;
    const fmid = polyEval(c, mid);
    if ((flo <= 0) === (fmid <= 0)) { lo = mid; flo = fmid; } else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * All real roots of the polynomial (coeffs ascending: c[0] + c[1]x + …) in
 * [lo, hi], ascending. Recursively isolates: the roots of the derivative split
 * [lo, hi] into intervals where the polynomial is monotonic, so a sign change
 * inside any interval brackets exactly one root for bisection.
 */
export function polyRootsInRange(coeffs, lo, hi, eps = 1e-9) {
  const c = trimPoly(coeffs);
  const deg = c.length - 1;
  if (deg < 1) return [];
  if (deg === 1) {
    const r = -c[0] / c[1];
    return (r >= lo - eps && r <= hi + eps) ? [r] : [];
  }
  const brackets = [lo, ...polyRootsInRange(polyDeriv(c), lo, hi, eps), hi];
  const roots = [];
  for (let i = 0; i + 1 < brackets.length; i++) {
    const a = brackets[i], b = brackets[i + 1];
    if (b - a < eps) continue;
    const fa = polyEval(c, a), fb = polyEval(c, b);
    if (Math.abs(fa) < eps) { if (!roots.length || a - roots[roots.length - 1] > eps) roots.push(a); continue; }
    if ((fa < 0) !== (fb < 0)) {
      const r = bisect(c, a, b, eps);
      if (!roots.length || r - roots[roots.length - 1] > eps) roots.push(r);
    }
  }
  const fb = polyEval(c, hi);
  if (Math.abs(fb) < eps && (!roots.length || hi - roots[roots.length - 1] > eps)) roots.push(hi);
  return roots;
}

/** Smallest root strictly greater than lo (within eps slack), or null. */
export function smallestRootInRange(coeffs, lo, hi, eps = 1e-9) {
  for (const r of polyRootsInRange(coeffs, lo, hi, eps)) if (r > lo + eps) return r;
  return null;
}

/**
 * Earliest absolute time t > now at which two motions come within contact
 * distance R (their disks touch while APPROACHING — a separating pair that is
 * already overlapping does not re-trigger). Returns null if they never meet
 * within `horizon` seconds. Closed-form quadratic for straight lines; quartic
 * root isolation when either motion accelerates.
 */
export function contactTime(a, b, R, now, horizon = 1e6) {
  const pa = evalMotion(a, now), pb = evalMotion(b, now);
  const px = pa.x - pb.x, py = pa.y - pb.y;
  const vx = (a.vx + (a.ax ?? 0) * (now - a.tRef)) - (b.vx + (b.ax ?? 0) * (now - b.tRef));
  const vy = (a.vy + (a.ay ?? 0) * (now - a.tRef)) - (b.vy + (b.ay ?? 0) * (now - b.tRef));
  const ax = (a.ax ?? 0) - (b.ax ?? 0);
  const ay = (a.ay ?? 0) - (b.ay ?? 0);

  if (Math.abs(ax) < EPS && Math.abs(ay) < EPS) {
    // |p + vτ|² = R² → (v·v)τ² + 2(p·v)τ + (p·p − R²) = 0
    const A = vx * vx + vy * vy;
    const B = 2 * (px * vx + py * vy);
    const C = px * px + py * py - R * R;
    if (C <= 0) {
      // Already touching/overlapping: report contact only if still approaching.
      return B < -EPS ? now : null;
    }
    if (A < EPS) return null;               // no relative motion
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;              // paths never come within R
    const sq = Math.sqrt(disc);
    const tau = (-B - sq) / (2 * A);        // first crossing (entering contact)
    if (tau < -EPS || tau > horizon) return null;
    return now + Math.max(tau, 0);
  }

  // Accelerating (polynomial) paths: distance² − R² is a quartic in τ.
  const hx = ax / 2, hy = ay / 2;
  const c0 = px * px + py * py - R * R;
  const c1 = 2 * (px * vx + py * vy);
  const c2 = vx * vx + vy * vy + 2 * (px * hx + py * hy);
  const c3 = 2 * (vx * hx + vy * hy);
  const c4 = hx * hx + hy * hy;
  const tau = smallestRootInRange([c0, c1, c2, c3, c4], 0, horizon);
  return tau == null ? null : now + tau;
}

/**
 * Lead-aimed intercept: a projectile launched at absolute time `now` from
 * (px, py) at constant speed `s`, aimed so it meets a linearly moving target
 * (motion `target`, contact radius R) as early as possible. The projectile
 * reaches the target's disk when s·τ + R = |Δp + v_t·τ|; squaring gives
 *   (v·v − s²)τ² + 2(Δp·v − s·R)τ + (|Δp|² − R²) = 0
 * Returns { t, vx, vy } (impact time and the projectile's velocity) or null
 * when the target is too fast to ever intercept.
 */
export function interceptTime(px, py, s, target, R, now) {
  const tp = evalMotion(target, now);
  const dx = tp.x - px, dy = tp.y - py;
  const tvx = target.vx, tvy = target.vy;
  const dist = Math.hypot(dx, dy);
  if (dist <= R + EPS) return { t: now, vx: 0, vy: 0 };   // already in contact
  const A = tvx * tvx + tvy * tvy - s * s;
  const B = 2 * (dx * tvx + dy * tvy) - 2 * R * s;        // R credit: hit the disk edge, not the centre
  const C = dist * dist - R * R;
  let tau = null;
  if (Math.abs(A) < EPS) {
    if (Math.abs(B) > EPS) { const r = -C / B; if (r > EPS) tau = r; }
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const r of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].sort((u, v) => u - v)) {
        if (r > EPS) { tau = r; break; }
      }
    }
  }
  if (tau == null) return null;
  // Aim point = target centre at impact; velocity carries the projectile there.
  const ix = tp.x + tvx * tau, iy = tp.y + tvy * tau;
  const ilen = Math.hypot(ix - px, iy - py) || 1;
  return { t: now + tau, vx: (ix - px) / ilen * s, vy: (iy - py) / ilen * s };
}
