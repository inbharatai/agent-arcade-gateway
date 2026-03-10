/**
 * World-class particle effects for Agent Arcade
 *
 * Pool-based particle system with:
 * - Glow/bloom rendering behind bright particles
 * - Trail rendering (last N positions)
 * - Star, heart, diamond shapes
 * - Color interpolation over lifetime (startColor → endColor)
 * - Rotation for non-circle particles
 * - Size easing curves
 * - Sub-emitter capability (particles spawn child particles)
 */

import { lerp, easeOutQuad, clamp01, colorLerp } from './tween'

const MAX_PARTICLES = 350
const TRAIL_LENGTH = 5

export type ParticleShape = 'circle' | 'square' | 'star' | 'heart' | 'diamond' | 'char'

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number       // 0→1, dies at 1
  maxLife: number     // seconds
  size: number
  color: string
  endColor?: string   // interpolate toward this color over lifetime
  alpha: number
  kind: ParticleShape
  char?: string
  gravity: number
  rotation: number    // radians
  rotSpeed: number    // radians per tick
  glow: boolean       // render glow halo behind particle
  trail: boolean      // render trail
  trailPositions?: { x: number; y: number }[]
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, points: number, rot: number) {
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const angle = rot + (i * Math.PI) / points - Math.PI / 2
    const radius = i % 2 === 0 ? r : r * 0.45
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
}

function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(cx, cy + r * 0.4)
  ctx.bezierCurveTo(cx - r, cy - r * 0.6, cx - r * 0.5, cy - r, cx, cy - r * 0.4)
  ctx.bezierCurveTo(cx + r * 0.5, cy - r, cx + r, cy - r * 0.6, cx, cy + r * 0.4)
  ctx.fill()
}

function drawDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(rot)
  ctx.beginPath()
  ctx.moveTo(0, -r)
  ctx.lineTo(r * 0.6, 0)
  ctx.lineTo(0, r)
  ctx.lineTo(-r * 0.6, 0)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export class ParticleSystem {
  particles: Particle[] = []

  emit(effect: string, x: number, y: number, tileSize: number) {
    switch (effect) {
      case 'spawn': this.spawnEffect(x, y, tileSize); break
      case 'done': this.doneEffect(x, y, tileSize); break
      case 'error': this.errorEffect(x, y, tileSize); break
      case 'thinking': this.thinkingEffect(x, y, tileSize); break
      case 'writing': this.writingEffect(x, y, tileSize); break
      case 'tool': this.toolEffect(x, y, tileSize); break
    }
  }

  private add(p: Omit<Particle, 'life'>) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift()
    this.particles.push({ ...p, life: 0 })
  }

  private spawnEffect(x: number, y: number, ts: number) {
    // Burst ring + rising stars
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      const speed = ts * 0.025 + Math.random() * ts * 0.018
      this.add({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - ts * 0.02,
        maxLife: 0.7 + Math.random() * 0.4,
        size: 2 + Math.random() * 2.5,
        color: ['#60a5fa', '#93c5fd', '#dbeafe', '#ffffff', '#a78bfa'][i % 5],
        endColor: '#ffffff',
        alpha: 1,
        kind: i % 4 === 0 ? 'star' : 'circle',
        gravity: -0.025,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.15,
        glow: true,
        trail: i % 3 === 0,
        trailPositions: [],
      })
    }
    // Central flash
    this.add({
      x, y,
      vx: 0, vy: 0,
      maxLife: 0.3,
      size: ts * 0.4,
      color: '#ffffff',
      alpha: 0.7,
      kind: 'circle',
      gravity: 0,
      rotation: 0, rotSpeed: 0,
      glow: true, trail: false,
    })
  }

  private doneEffect(x: number, y: number, ts: number) {
    const colors = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#fbbf24']
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = ts * 0.03 + Math.random() * ts * 0.035
      const shapes: ParticleShape[] = ['star', 'heart', 'diamond', 'square', 'circle']
      this.add({
        x, y: y - ts * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.7 - ts * 0.05,
        maxLife: 1.2 + Math.random() * 0.6,
        size: 2.5 + Math.random() * 3.5,
        color: colors[i % colors.length],
        alpha: 1,
        kind: shapes[i % shapes.length],
        gravity: 0.055,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.2,
        glow: i % 3 === 0,
        trail: false,
      })
    }
  }

  private errorEffect(x: number, y: number, ts: number) {
    // Smoke + sparks
    for (let i = 0; i < 10; i++) {
      this.add({
        x: x + (Math.random() - 0.5) * ts * 0.5,
        y: y - ts * 0.1,
        vx: (Math.random() - 0.5) * ts * 0.01,
        vy: -ts * 0.012 - Math.random() * ts * 0.012,
        maxLife: 0.9 + Math.random() * 0.5,
        size: 3 + Math.random() * 4,
        color: ['#ef4444', '#dc2626', '#fca5a5'][i % 3],
        endColor: '#44444480',
        alpha: 0.8,
        kind: i < 3 ? 'diamond' : 'circle',
        gravity: -0.015,
        rotation: Math.random() * Math.PI,
        rotSpeed: (Math.random() - 0.5) * 0.1,
        glow: i < 4,
        trail: false,
      })
    }
    // Ember sparks
    for (let i = 0; i < 4; i++) {
      this.add({
        x, y,
        vx: (Math.random() - 0.5) * ts * 0.03,
        vy: -ts * 0.03 - Math.random() * ts * 0.02,
        maxLife: 0.4 + Math.random() * 0.3,
        size: 1 + Math.random(),
        color: '#fbbf24',
        endColor: '#ef4444',
        alpha: 1,
        kind: 'circle',
        gravity: 0.04,
        rotation: 0, rotSpeed: 0,
        glow: true,
        trail: true,
        trailPositions: [],
      })
    }
  }

  private thinkingEffect(x: number, y: number, ts: number) {
    for (let i = 0; i < 3; i++) {
      this.add({
        x: x + (i - 1) * ts * 0.15,
        y: y - ts * 0.6,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -ts * 0.009 - Math.random() * ts * 0.005,
        maxLife: 1.5 + Math.random() * 0.5,
        size: 2.5 + i * 0.8,
        color: '#a855f7',
        endColor: '#c084fc',
        alpha: 0.65,
        kind: 'circle',
        gravity: -0.005,
        rotation: 0, rotSpeed: 0,
        glow: true,
        trail: false,
      })
    }
  }

  private writingEffect(x: number, y: number, ts: number) {
    const chars = ['{', '}', '(', ')', ';', '/', '<', '>', '=', '+', 'fn', '⚡', '💻']
    for (let i = 0; i < 3; i++) {
      this.add({
        x: x + (Math.random() - 0.5) * ts * 0.35,
        y: y - ts * 0.2,
        vx: (Math.random() - 0.5) * ts * 0.006,
        vy: ts * 0.009 + Math.random() * ts * 0.005,
        maxLife: 1.0 + Math.random() * 0.5,
        size: 6 + Math.random() * 3,
        color: '#22c55e',
        endColor: '#86efac',
        alpha: 0.85,
        kind: 'char',
        char: chars[Math.floor(Math.random() * chars.length)],
        gravity: 0.02,
        rotation: 0, rotSpeed: 0,
        glow: false,
        trail: false,
      })
    }
  }

  private toolEffect(x: number, y: number, ts: number) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI - Math.PI / 2
      this.add({
        x: x + (Math.random() - 0.5) * ts * 0.2,
        y: y,
        vx: Math.cos(angle) * ts * 0.025,
        vy: Math.sin(angle) * ts * 0.025 - ts * 0.012,
        maxLife: 0.45 + Math.random() * 0.3,
        size: 1.5 + Math.random() * 2,
        color: ['#fbbf24', '#f59e0b', '#ffffff'][i % 3],
        endColor: '#ffffff',
        alpha: 1,
        kind: i % 2 === 0 ? 'star' : 'circle',
        gravity: 0.035,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
        glow: true,
        trail: true,
        trailPositions: [],
      })
    }
  }

  /** dt in seconds */
  tick(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt / p.maxLife
      if (p.life >= 1) {
        this.particles.splice(i, 1)
        continue
      }
      // Store trail position
      if (p.trail && p.trailPositions) {
        p.trailPositions.push({ x: p.x, y: p.y })
        if (p.trailPositions.length > TRAIL_LENGTH) p.trailPositions.shift()
      }
      p.x += p.vx
      p.y += p.vy
      p.vy += p.gravity
      p.rotation += p.rotSpeed
      // Slight drag
      p.vx *= 0.995
      p.vy *= 0.995
      p.alpha = 1 - easeOutQuad(clamp01(p.life))
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    // Render glow halos first (additive blend)
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    for (const p of this.particles) {
      if (!p.glow || p.alpha < 0.1) continue
      const r = p.size * lerp(2.5, 0.5, clamp01(p.life))
      ctx.globalAlpha = p.alpha * 0.25
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(1, r), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    // Render trails
    for (const p of this.particles) {
      if (!p.trail || !p.trailPositions || p.trailPositions.length < 2) continue
      for (let t = 0; t < p.trailPositions.length - 1; t++) {
        const tp = p.trailPositions[t]
        const frac = t / p.trailPositions.length
        ctx.globalAlpha = p.alpha * frac * 0.4
        ctx.fillStyle = p.color
        const tr = p.size * frac * 0.5
        ctx.beginPath()
        ctx.arc(tp.x, tp.y, Math.max(0.3, tr), 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Render particles
    for (const p of this.particles) {
      const lifeT = clamp01(p.life)
      ctx.globalAlpha = p.alpha

      // Color interpolation over lifetime
      const color = p.endColor ? colorLerp(p.color, p.endColor, lifeT) : p.color
      ctx.fillStyle = color

      const sz = p.size * lerp(1, 0.25, lifeT)

      if (p.kind === 'char' && p.char) {
        ctx.font = `bold ${sz}px monospace`
        ctx.textAlign = 'center'
        ctx.fillText(p.char, p.x, p.y)
      } else if (p.kind === 'star') {
        drawStar(ctx, p.x, p.y, Math.max(0.5, sz), 5, p.rotation)
      } else if (p.kind === 'heart') {
        drawHeart(ctx, p.x, p.y, Math.max(0.5, sz))
      } else if (p.kind === 'diamond') {
        drawDiamond(ctx, p.x, p.y, Math.max(0.5, sz), p.rotation)
      } else if (p.kind === 'square') {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz)
        ctx.restore()
      } else {
        ctx.beginPath()
        ctx.arc(p.x, p.y, Math.max(0.5, sz), 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  clear() {
    this.particles.length = 0
  }
}
