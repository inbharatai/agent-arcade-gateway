/**
 * Tween & easing utilities for Agent Arcade
 *
 * Comprehensive easing library: standard curves, spring physics,
 * color interpolation, bezier curves, and utility functions.
 */

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function easeInOut(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOutBounce(t: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

export function easeInQuad(t: number): number {
  return t * t
}

export function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1
}

/** Ease out with overshoot (back easing) */
export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/** Simple spring physics — damped oscillation toward 1 */
export function spring(t: number, damping: number = 0.6, frequency: number = 4): number {
  return 1 - Math.exp(-damping * t * 10) * Math.cos(frequency * t * Math.PI * 2)
}

/** Clamp value between 0–1 */
export function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t))
}

/** Smooth step (Hermite interpolation) */
export function smoothStep(t: number): number {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

/** Pulse: 0→1→0 over duration */
export function pulse(t: number): number {
  const c = clamp01(t)
  return Math.sin(c * Math.PI)
}

/** Interpolate two hex colors. t in 0–1. */
export function colorLerp(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16)
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`
}
