/**
 * World-class procedural pixel-art sprite generator
 *
 * Professional-quality character sprites with:
 * - Sub-pixel anti-aliased rendering (arcs, gradients)
 * - Per-pixel shading (highlight / mid / shadow tones)
 * - Detailed eyes (sclera, iris, pupil, catchlight)
 * - Expressive eyebrows per emotion
 * - Body shading & clothing detail (collar, seams, belt)
 * - Per-class UNIQUE body shapes, silhouettes, and props
 * - 13 fully distinct animation frames
 * - Each of 15 character classes has a distinct recognizable silhouette
 *
 * Zero external assets — 100% canvas-drawn.
 */

// ── Color utilities ─────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}

function darken(hex: string, amt = 0.22): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(
    Math.round(r * (1 - amt)),
    Math.round(g * (1 - amt)),
    Math.round(b * (1 - amt)),
  )
}

function lighten(hex: string, amt = 0.18): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(
    Math.min(255, Math.round(r + (255 - r) * amt)),
    Math.min(255, Math.round(g + (255 - g) * amt)),
    Math.min(255, Math.round(b + (255 - b) * amt)),
  )
}

// ── Palette type with computed shading tones ────────────────────────────────
interface FullPalette {
  skin: string; skinHi: string; skinSh: string
  hair: string; hairHi: string; hairSh: string
  shirt: string; shirtHi: string; shirtSh: string
  pants: string; pantsSh: string
  shoes: string; shoesSh: string; shoesHi: string
  accent: string; accentHi: string
  outline: string
  iris: string
  blush: string
}

function buildPalette(base: { skin: string; hair: string; shirt: string; pants: string; shoes: string; accent: string; outline: string }): FullPalette {
  return {
    skin: base.skin, skinHi: lighten(base.skin, 0.12), skinSh: darken(base.skin, 0.15),
    hair: base.hair, hairHi: lighten(base.hair, 0.28), hairSh: darken(base.hair, 0.2),
    shirt: base.shirt, shirtHi: lighten(base.shirt, 0.16), shirtSh: darken(base.shirt, 0.22),
    pants: base.pants, pantsSh: darken(base.pants, 0.2),
    shoes: base.shoes, shoesSh: darken(base.shoes, 0.25), shoesHi: lighten(base.shoes, 0.15),
    accent: base.accent, accentHi: lighten(base.accent, 0.3),
    outline: base.outline,
    iris: base.accent,
    blush: '#f5a0a0',
  }
}

// ── Base palette data ───────────────────────────────────────────────────────
export const CHARACTER_PALETTES: Record<string, {
  skin: string; hair: string; shirt: string; pants: string;
  shoes: string; accent: string; outline: string
}> = {
  developer:  { skin: '#fce8d0', hair: '#3d2314', shirt: '#2563eb', pants: '#1e293b', shoes: '#475569', accent: '#60a5fa', outline: '#1e1e1e' },
  designer:   { skin: '#d4a574', hair: '#ff6b9d', shirt: '#ec4899', pants: '#7c3aed', shoes: '#a855f7', accent: '#f472b6', outline: '#1e1e1e' },
  manager:    { skin: '#fce8d0', hair: '#6b7280', shirt: '#ffffff', pants: '#1f2937', shoes: '#111827', accent: '#ef4444', outline: '#1e1e1e' },
  researcher: { skin: '#fce8d0', hair: '#854d0e', shirt: '#f8fafc', pants: '#6b7280', shoes: '#374151', accent: '#22c55e', outline: '#1e1e1e' },
  writer:     { skin: '#fce8d0', hair: '#92400e', shirt: '#fef3c7', pants: '#78350f', shoes: '#451a03', accent: '#f59e0b', outline: '#1e1e1e' },
  engineer:   { skin: '#fce8d0', hair: '#292524', shirt: '#f97316', pants: '#1e293b', shoes: '#71717a', accent: '#eab308', outline: '#1e1e1e' },
  hacker:     { skin: '#fce8d0', hair: '#1a1a1a', shirt: '#0a0a0a', pants: '#1a1a1a', shoes: '#333333', accent: '#00ff41', outline: '#1e1e1e' },
  analyst:    { skin: '#d4a574', hair: '#4a3728', shirt: '#0ea5e9', pants: '#334155', shoes: '#475569', accent: '#38bdf8', outline: '#1e1e1e' },
  strategist: { skin: '#fce8d0', hair: '#1e293b', shirt: '#1e3a5f', pants: '#0f172a', shoes: '#1e293b', accent: '#f59e0b', outline: '#1e1e1e' },
  operator:   { skin: '#d4a574', hair: '#292524', shirt: '#4a5568', pants: '#2d3748', shoes: '#4a5568', accent: '#ed8936', outline: '#1e1e1e' },
  builder:    { skin: '#fce8d0', hair: '#78350f', shirt: '#d97706', pants: '#422006', shoes: '#78350f', accent: '#fbbf24', outline: '#1e1e1e' },
  reviewer:   { skin: '#fce8d0', hair: '#581c87', shirt: '#7c3aed', pants: '#2e1065', shoes: '#4c1d95', accent: '#a78bfa', outline: '#1e1e1e' },
  runner:     { skin: '#d4a574', hair: '#1a1a1a', shirt: '#dc2626', pants: '#1f2937', shoes: '#ef4444', accent: '#f87171', outline: '#1e1e1e' },
  mentor:     { skin: '#fce8d0', hair: '#d1d5db', shirt: '#1e40af', pants: '#374151', shoes: '#1f2937', accent: '#93c5fd', outline: '#1e1e1e' },
  commander:  { skin: '#fce8d0', hair: '#0f172a', shirt: '#1e293b', pants: '#0f172a', shoes: '#0f172a', accent: '#fbbf24', outline: '#1e1e1e' },
}

export const SPRITE_SIZE = 32
export const CHARACTER_CLASSES = Object.keys(CHARACTER_PALETTES)

/**
 * Map an AI model name to a character class for model-based coloring.
 * Claude → reviewer (purple), GPT/OpenAI → researcher (green),
 * Gemini → analyst (blue), Mistral → strategist (teal/navy),
 * Ollama/local → hacker (neon green), DeepSeek → operator (orange),
 * Copilot → developer (blue), unknown → undefined (fallback to round-robin).
 */
export function modelToCharacterClass(aiModel?: string): string | undefined {
  if (!aiModel) return undefined
  const m = aiModel.toLowerCase()
  if (m.includes('claude') || m.includes('anthropic'))  return 'reviewer'
  if (m.includes('gpt') || m.includes('openai') || m.includes('o1') || m.includes('o3') || m.includes('o4'))  return 'researcher'
  if (m.includes('gemini') || m.includes('google'))     return 'analyst'
  if (m.includes('mistral') || m.includes('mixtral'))    return 'strategist'
  if (m.includes('ollama') || m.includes('llama') || m.includes('local')) return 'hacker'
  if (m.includes('deepseek'))                            return 'operator'
  if (m.includes('copilot'))                             return 'developer'
  if (m.includes('cursor'))                              return 'engineer'
  if (m.includes('crewai') || m.includes('crew'))        return 'commander'
  if (m.includes('langchain'))                           return 'builder'
  if (m.includes('autogen'))                             return 'mentor'
  return undefined
}

/** Pixel-level configs */
export interface PixelConfig {
  scale: number
  smoothing: boolean
  tileSize: number
  scanlines: boolean
  crt: boolean
  outlineWeight: number
  effectIntensity: number
  label: string
}

export const PIXEL_CONFIGS: Record<string, PixelConfig> = {
  '8bit':  { scale: 1, smoothing: false, tileSize: 32, scanlines: false, crt: false, outlineWeight: 1., effectIntensity: 0.5, label: '8-Bit Raw' },
  '16bit': { scale: 2, smoothing: false, tileSize: 48, scanlines: false, crt: false, outlineWeight: 0.8, effectIntensity: 0.8, label: '16-Bit Polished' },
  '32bit': { scale: 3, smoothing: false, tileSize: 64, scanlines: false, crt: false, outlineWeight: 0.6, effectIntensity: 1.0, label: '32-Bit Premium' },
  'hd':    { scale: 4, smoothing: true,  tileSize: 80, scanlines: false, crt: false, outlineWeight: 0.4, effectIntensity: 1.0, label: 'Hybrid Modern' },
  'crt':   { scale: 2, smoothing: false, tileSize: 48, scanlines: true,  crt: true,  outlineWeight: 1.0, effectIntensity: 1.2, label: 'Ultra Retro CRT' },
}

// ── Primitive helpers ───────────────────────────────────────────────────────
function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, s: number) {
  ctx.fillStyle = color
  ctx.fillRect(x * s, y * s, s, s)
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, s: number) {
  ctx.fillStyle = color
  ctx.fillRect(x * s, y * s, w * s, h * s)
}

// ── Per-class body shape configuration ──────────────────────────────────────
interface BodyShape {
  headY: number         // head center Y offset (lower = taller character)
  headR: number         // head radius
  torsoX: number        // torso left edge relative to center (16)
  torsoW: number        // torso width
  torsoY: number        // torso top Y
  torsoH: number        // torso height
  legW: number          // leg width
  armW: number          // arm width
  shoulderExtra: number // extra shoulder width (epaulettes, suit jacket)
  hunchY: number        // forward lean offset for hunched posture
  leanX: number         // horizontal lean (positive = forward lean)
}

function getBodyShape(cls: string): BodyShape {
  const base: BodyShape = {
    headY: 10.5, headR: 7.2, torsoX: 10, torsoW: 12, torsoY: 17,
    torsoH: 9, legW: 4, armW: 3, shoulderExtra: 0, hunchY: 0, leanX: 0,
  }
  switch (cls) {
    case 'hacker':
      return { ...base, hunchY: 1, headY: 11.5, torsoY: 18 }
    case 'builder':
      return { ...base, torsoX: 8, torsoW: 16, legW: 5, armW: 4, headR: 7.2 }
    case 'engineer':
      return { ...base, torsoX: 9, torsoW: 14, legW: 4, armW: 3 }
    case 'commander':
      return { ...base, headY: 9.5, shoulderExtra: 2, torsoY: 16, torsoH: 10 }
    case 'runner':
      return { ...base, torsoX: 11, torsoW: 10, legW: 3, leanX: 1 }
    case 'mentor':
      return { ...base, headY: 9.5, torsoY: 16, torsoH: 10, headR: 7.5 }
    case 'manager':
      return { ...base, shoulderExtra: 1, torsoW: 13, torsoX: 10 }
    case 'writer':
      return { ...base, hunchY: 0, torsoX: 10, torsoW: 12 }
    case 'reviewer':
      return { ...base, torsoW: 12 }
    case 'researcher':
      return { ...base, torsoH: 10, torsoY: 17 }
    default:
      return base
  }
}

// ── Per-class head/hair drawing ──────────────────────────────────────────────
function drawHead(ctx: CanvasRenderingContext2D, x: number, s: number, cls: string, p: FullPalette, shape: BodyShape) {
  const centerX = x + 16 + shape.leanX
  const centerY = shape.headY + shape.hunchY

  // ── Main head circle ──
  ctx.fillStyle = p.skin
  ctx.beginPath()
  ctx.arc(centerX * s, centerY * s, shape.headR * s, 0, Math.PI * 2)
  ctx.fill()
  // Highlight (left side of face)
  ctx.fillStyle = p.skinHi
  ctx.beginPath()
  ctx.arc((centerX - 1.5) * s, (centerY - 1) * s, 4 * s, 0, Math.PI * 2)
  ctx.fill()
  // Reblend with main skin to soften
  ctx.globalAlpha = 0.5
  ctx.fillStyle = p.skin
  ctx.beginPath()
  ctx.arc(centerX * s, centerY * s, (shape.headR - 0.2) * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  // Jaw shadow
  ctx.fillStyle = p.skinSh
  ctx.beginPath()
  ctx.arc(centerX * s, (centerY + 3.5) * s, 5 * s, 0, Math.PI, false)
  ctx.fill()
  // Cheekbone blend
  ctx.globalAlpha = 0.3
  ctx.fillStyle = p.skin
  ctx.beginPath()
  ctx.arc(centerX * s, (centerY + 2.5) * s, 5.5 * s, 0, Math.PI, false)
  ctx.fill()
  ctx.globalAlpha = 1
}

function drawHair(ctx: CanvasRenderingContext2D, x: number, s: number, cls: string, p: FullPalette, shape: BodyShape) {
  const lx = x + shape.leanX
  const hy = shape.hunchY

  switch (cls) {
    case 'researcher': {
      // Wild messy hair with tufts sticking up
      rect(ctx, lx + 8, 3 + hy, 16, 5, p.hair, s)
      rect(ctx, lx + 9, 2 + hy, 14, 2, p.hair, s)
      rect(ctx, lx + 8, 7 + hy, 2, 3, p.hair, s)
      rect(ctx, lx + 22, 7 + hy, 2, 3, p.hair, s)
      // Wild tufts sticking up
      rect(ctx, lx + 11, 0 + hy, 2, 3, p.hair, s)
      rect(ctx, lx + 15, -1 + hy, 2, 4, p.hair, s)
      rect(ctx, lx + 19, 0 + hy, 2, 3, p.hair, s)
      px(ctx, lx + 12, 0 + hy, p.hairHi, s)
      px(ctx, lx + 16, -1 + hy, p.hairHi, s)
      px(ctx, lx + 20, 0 + hy, p.hairHi, s)
      // Highlight strands
      px(ctx, lx + 11, 2 + hy, p.hairHi, s)
      px(ctx, lx + 16, 2 + hy, p.hairHi, s)
      px(ctx, lx + 21, 2 + hy, p.hairHi, s)
      // Shadow underneath
      rect(ctx, lx + 9, 7 + hy, 14, 1, p.hairSh, s)
      break
    }
    case 'hacker': {
      // Large prominent hood
      const hoodColor = darken(p.shirt, 0.05)
      const hoodDark = darken(p.shirt, 0.15)
      rect(ctx, lx + 7, 1 + hy, 18, 4, hoodColor, s)
      rect(ctx, lx + 6, 3 + hy, 2, 8, hoodColor, s)
      rect(ctx, lx + 24, 3 + hy, 2, 8, hoodColor, s)
      rect(ctx, lx + 6, 5 + hy, 20, 3, hoodColor, s)
      // Hood peak
      rect(ctx, lx + 10, 0 + hy, 12, 2, hoodColor, s)
      // Hood inner shadow
      rect(ctx, lx + 8, 4 + hy, 16, 2, hoodDark, s)
      // Hood edge highlight
      px(ctx, lx + 7, 2 + hy, lighten(p.shirt, 0.15), s)
      px(ctx, lx + 25, 2 + hy, lighten(p.shirt, 0.15), s)
      // Minimal hair visible under hood
      rect(ctx, lx + 9, 6 + hy, 14, 2, p.hair, s)
      break
    }
    case 'mentor': {
      // Distinguished elder hair — thinner on top, grey/white
      rect(ctx, lx + 9, 2 + hy, 14, 4, p.hair, s)
      rect(ctx, lx + 8, 4 + hy, 16, 3, p.hair, s)
      // Receding hairline effect (show skin at front)
      rect(ctx, lx + 10, 2 + hy, 12, 1, p.hair, s)
      // Side volume (longer sides like wise elder)
      rect(ctx, lx + 7, 7 + hy, 3, 5, p.hair, s)
      rect(ctx, lx + 22, 7 + hy, 3, 5, p.hair, s)
      // Highlights
      px(ctx, lx + 12, 2 + hy, p.hairHi, s)
      px(ctx, lx + 16, 2 + hy, p.hairHi, s)
      px(ctx, lx + 20, 3 + hy, p.hairHi, s)
      rect(ctx, lx + 9, 7 + hy, 14, 1, p.hairSh, s)
      break
    }
    case 'commander': {
      // Short military cut under cap (drawn in accessory)
      rect(ctx, lx + 9, 4 + hy, 14, 3, p.hair, s)
      rect(ctx, lx + 8, 6 + hy, 2, 3, p.hair, s)
      rect(ctx, lx + 22, 6 + hy, 2, 3, p.hair, s)
      rect(ctx, lx + 9, 7 + hy, 14, 1, p.hairSh, s)
      break
    }
    case 'designer': {
      // Stylish hair with colorful streaks
      rect(ctx, lx + 8, 3 + hy, 16, 5, p.hair, s)
      rect(ctx, lx + 9, 2 + hy, 14, 2, p.hair, s)
      rect(ctx, lx + 8, 7 + hy, 2, 3, p.hair, s)
      rect(ctx, lx + 22, 7 + hy, 2, 3, p.hair, s)
      // Asymmetric bangs swooping to one side
      rect(ctx, lx + 7, 5 + hy, 3, 4, p.hair, s)
      px(ctx, lx + 7, 5 + hy, p.hairHi, s)
      // Highlights
      px(ctx, lx + 11, 2 + hy, p.hairHi, s)
      px(ctx, lx + 16, 2 + hy, p.hairHi, s)
      px(ctx, lx + 21, 2 + hy, p.hairHi, s)
      rect(ctx, lx + 9, 7 + hy, 14, 1, p.hairSh, s)
      break
    }
    case 'runner': {
      // Short aerodynamic hair
      rect(ctx, lx + 9 + shape.leanX, 3, 14, 4, p.hair, s)
      rect(ctx, lx + 10 + shape.leanX, 2, 12, 2, p.hair, s)
      rect(ctx, lx + 8 + shape.leanX, 6, 2, 2, p.hair, s)
      rect(ctx, lx + 22 + shape.leanX, 6, 2, 2, p.hair, s)
      px(ctx, lx + 12 + shape.leanX, 2, p.hairHi, s)
      px(ctx, lx + 17 + shape.leanX, 2, p.hairHi, s)
      rect(ctx, lx + 10 + shape.leanX, 6, 12, 1, p.hairSh, s)
      break
    }
    default: {
      // Default hair
      rect(ctx, lx + 8, 3 + hy, 16, 5, p.hair, s)
      rect(ctx, lx + 9, 2 + hy, 14, 2, p.hair, s)
      rect(ctx, lx + 8, 7 + hy, 2, 3, p.hair, s)
      rect(ctx, lx + 22, 7 + hy, 2, 3, p.hair, s)
      rect(ctx, lx + 9, 7 + hy, 14, 1, p.hairSh, s)
      px(ctx, lx + 11, 2 + hy, p.hairHi, s)
      px(ctx, lx + 13, 3 + hy, p.hairHi, s)
      px(ctx, lx + 16, 2 + hy, p.hairHi, s)
      px(ctx, lx + 19, 3 + hy, p.hairHi, s)
      px(ctx, lx + 21, 2 + hy, p.hairHi, s)
      px(ctx, lx + 14, 3 + hy, p.hairSh, s)
      break
    }
  }
}

// ── Per-class accessory and prop drawing ────────────────────────────────────
function drawAccessory(
  ctx: CanvasRenderingContext2D, x: number, s: number, cls: string, p: FullPalette,
  frame: number, shape: BodyShape,
) {
  const hy = shape.hunchY
  const lx = x + shape.leanX
  const isTypeA = frame === 4
  const isTypeB = frame === 5
  const isThinking = frame === 8
  const isToolA = frame === 11
  const isToolB = frame === 12
  const isIdle = frame === 0
  const isBlink = frame === 1
  const isDefault = isIdle || isBlink || frame === 2 || frame === 3

  switch (cls) {
    case 'developer': {
      // Large prominent headphones
      rect(ctx, lx + 8, 3, 16, 2, '#555555', s)      // band
      px(ctx, lx + 12, 3, '#777777', s)                // band highlight
      rect(ctx, lx + 7, 4, 3, 4, '#333333', s)        // left earpiece
      rect(ctx, lx + 22, 4, 3, 4, '#333333', s)       // right earpiece
      px(ctx, lx + 7, 5, '#555555', s)                 // earpiece highlight L
      px(ctx, lx + 24, 5, '#555555', s)                // earpiece highlight R
      rect(ctx, lx + 7, 5, 1, 2, '#444444', s)        // cushion L
      rect(ctx, lx + 24, 5, 1, 2, '#444444', s)       // cushion R
      // Coffee mug in idle/blink frames
      if (isDefault) {
        rect(ctx, lx + 5, 22, 3, 3, '#8B4513', s)     // mug body
        px(ctx, lx + 5, 22, '#A0522D', s)              // mug highlight
        rect(ctx, lx + 4, 23, 1, 2, '#8B4513', s)     // handle
        // Steam
        ctx.globalAlpha = 0.5
        px(ctx, lx + 5, 21, '#ffffff', s)
        px(ctx, lx + 6, 20, '#ffffff', s)
        px(ctx, lx + 7, 21, '#ffffff', s)
        ctx.globalAlpha = 1
      }
      break
    }
    case 'designer': {
      // Larger beret
      rect(ctx, lx + 9, 0, 14, 3, '#e11d48', s)
      rect(ctx, lx + 8, 2, 16, 2, '#e11d48', s)
      px(ctx, lx + 14, -1, '#e11d48', s)               // beret nub top
      px(ctx, lx + 15, -1, '#e11d48', s)
      px(ctx, lx + 10, 0, '#fb7185', s)                // beret highlight
      px(ctx, lx + 12, 1, '#fb7185', s)
      // Paint splashes during typing/tool frames
      if (isTypeA || isTypeB || isToolA || isToolB) {
        ctx.globalAlpha = 0.8
        px(ctx, lx + 4, 15, '#ff6b9d', s)
        px(ctx, lx + 27, 12, '#60a5fa', s)
        px(ctx, lx + 3, 20, '#fbbf24', s)
        px(ctx, lx + 28, 18, '#22c55e', s)
        px(ctx, lx + 5, 10, '#a855f7', s)
        ctx.globalAlpha = 1
      }
      break
    }
    case 'manager': {
      // Prominent tie
      rect(ctx, lx + 15, shape.torsoY, 2, 1, p.accent, s)     // knot
      px(ctx, lx + 14, shape.torsoY, p.accent, s)              // knot wing L
      px(ctx, lx + 17, shape.torsoY, p.accent, s)              // knot wing R
      rect(ctx, lx + 15, shape.torsoY + 1, 2, 6, p.accent, s) // tie body
      px(ctx, lx + 15, shape.torsoY + 7, p.accent, s)          // tie point
      px(ctx, lx + 15, shape.torsoY + 1, lighten(p.accent, 0.3), s) // tie highlight
      // Suit jacket lapels (darker lines on sides of shirt)
      rect(ctx, lx + 10, shape.torsoY, 2, shape.torsoH, darken(p.shirt, 0.15), s)
      rect(ctx, lx + 20, shape.torsoY, 2, shape.torsoH, darken(p.shirt, 0.15), s)
      // Glasses
      rect(ctx, lx + 10, 10, 4, 2, '#a0a0a0', s)
      rect(ctx, lx + 17, 10, 4, 2, '#a0a0a0', s)
      rect(ctx, lx + 14, 10, 3, 1, '#a0a0a0', s)      // bridge
      px(ctx, lx + 10, 10, '#c0c0c0', s)               // lens highlight
      break
    }
    case 'researcher': {
      // Big round glasses (taking up more face)
      ctx.beginPath()
      ctx.arc((lx + 12) * s, (11 + hy) * s, 3 * s, 0, Math.PI * 2)
      ctx.strokeStyle = '#b8b8b8'
      ctx.lineWidth = s * 0.7
      ctx.stroke()
      ctx.beginPath()
      ctx.arc((lx + 20) * s, (11 + hy) * s, 3 * s, 0, Math.PI * 2)
      ctx.strokeStyle = '#b8b8b8'
      ctx.lineWidth = s * 0.7
      ctx.stroke()
      rect(ctx, lx + 14, 10 + hy, 4, 1, '#b8b8b8', s) // bridge
      // Lens shine
      px(ctx, lx + 10, 9 + hy, '#e0e0e0', s)
      px(ctx, lx + 18, 9 + hy, '#e0e0e0', s)
      // Lab coat extension below belt — extends down over pants
      rect(ctx, lx + 9, shape.torsoY + shape.torsoH, 14, 3, '#f8fafc', s)
      rect(ctx, lx + 9, shape.torsoY + shape.torsoH + 1, 6, 2, lighten('#f8fafc', 0.05), s)
      rect(ctx, lx + 17, shape.torsoY + shape.torsoH + 1, 6, 2, darken('#f8fafc', 0.05), s)
      // Lab coat collar flaps
      rect(ctx, lx + 10, shape.torsoY - 1, 3, 2, '#f8fafc', s)
      rect(ctx, lx + 19, shape.torsoY - 1, 3, 2, '#f8fafc', s)
      // Book prop in default pose
      if (isDefault) {
        rect(ctx, lx + 4, 20, 4, 5, '#22c55e', s)     // book cover
        rect(ctx, lx + 5, 21, 2, 3, '#ffffff', s)      // pages
        px(ctx, lx + 4, 20, lighten('#22c55e', 0.2), s) // book highlight
      }
      break
    }
    case 'writer': {
      // Pencil held in hand (visible)
      if (isDefault || isThinking) {
        rect(ctx, lx + 5, 20, 1, 6, '#fbbf24', s)     // pencil shaft
        px(ctx, lx + 5, 26, '#333333', s)               // pencil tip
        px(ctx, lx + 5, 20, '#f472b6', s)               // eraser
      }
      // Notebook held in other hand
      if (isDefault) {
        rect(ctx, lx + 23, 19, 5, 6, '#f5e6c8', s)    // notebook
        rect(ctx, lx + 23, 19, 5, 1, '#d4a574', s)     // binding
        // Text lines
        rect(ctx, lx + 24, 21, 3, 1, '#c0a888', s)
        rect(ctx, lx + 24, 23, 2, 1, '#c0a888', s)
      }
      break
    }
    case 'engineer': {
      // Safety goggles ON FACE (not forehead)
      rect(ctx, lx + 9, 9 + hy, 14, 3, '#fbbf24', s)  // goggle strap
      rect(ctx, lx + 10, 9 + hy, 5, 3, '#92ddfb', s)   // left lens
      rect(ctx, lx + 17, 9 + hy, 5, 3, '#92ddfb', s)   // right lens
      rect(ctx, lx + 10, 9 + hy, 5, 1, '#c8f0ff', s)   // left lens highlight
      rect(ctx, lx + 17, 9 + hy, 5, 1, '#c8f0ff', s)   // right lens highlight
      px(ctx, lx + 15, 10 + hy, '#fbbf24', s)           // nose bridge
      px(ctx, lx + 16, 10 + hy, '#fbbf24', s)
      // MORE dramatic sparks during tool frames
      if (isToolA || isToolB) {
        const sparkOff = isToolB ? 1 : 0
        px(ctx, lx + 27, 11 + sparkOff, '#fbbf24', s)
        px(ctx, lx + 28, 10, '#fef08a', s)
        px(ctx, lx + 26, 9 + sparkOff, '#fbbf24', s)
        px(ctx, lx + 29, 12, '#fef08a', s)
        px(ctx, lx + 25, 11, '#ff8c00', s)
        ctx.globalAlpha = 0.6
        px(ctx, lx + 28, 8, '#fbbf24', s)
        px(ctx, lx + 30, 11, '#fef08a', s)
        px(ctx, lx + 27, 13, '#ff8c00', s)
        ctx.globalAlpha = 1
      }
      break
    }
    case 'hacker': {
      // Glowing green eyes are handled in eye drawing
      // Floating laptop in typing frames
      if (isTypeA || isTypeB) {
        const tOff = isTypeA ? 0 : 1
        rect(ctx, lx + 8, 20 + tOff, 16, 2, '#222222', s)  // laptop base
        rect(ctx, lx + 9, 14 + tOff, 14, 6, '#111111', s)  // laptop screen
        rect(ctx, lx + 10, 15 + tOff, 12, 4, '#0a1a0a', s) // screen inner
        // Green code lines
        rect(ctx, lx + 11, 15 + tOff, 4, 1, '#00ff41', s)
        rect(ctx, lx + 11, 17 + tOff, 6, 1, '#00ff41', s)
        px(ctx, lx + 12, 16 + tOff, '#00ff41', s)
        // Screen glow
        ctx.globalAlpha = 0.15
        rect(ctx, lx + 8, 12 + tOff, 18, 10, '#00ff41', s)
        ctx.globalAlpha = 1
      }
      break
    }
    case 'analyst': {
      // Earpiece
      px(ctx, lx + 22, 10, '#60a5fa', s)
      px(ctx, lx + 22, 11, '#3b82f6', s)
      px(ctx, lx + 23, 10, '#3b82f6', s)
      // Floating data visualization
      ctx.globalAlpha = 0.85
      // Mini bar chart
      px(ctx, lx + 26, 6, '#38bdf8', s)
      rect(ctx, lx + 27, 4, 1, 3, '#22d3ee', s)
      rect(ctx, lx + 28, 5, 1, 2, '#38bdf8', s)
      rect(ctx, lx + 29, 3, 1, 4, '#0ea5e9', s)
      // Chart base line
      rect(ctx, lx + 25, 7, 6, 1, '#60a5fa', s)
      ctx.globalAlpha = 1
      break
    }
    case 'strategist': {
      // Larger military beret
      rect(ctx, lx + 8, 0 + hy, 16, 3, '#1e3a5f', s)
      rect(ctx, lx + 7, 2 + hy, 18, 2, '#1e3a5f', s)
      rect(ctx, lx + 6, 3 + hy, 20, 1, darken('#1e3a5f', 0.1), s) // brim
      px(ctx, lx + 9, 0 + hy, lighten('#1e3a5f', 0.2), s)          // highlight
      // Gold star pin (larger)
      px(ctx, lx + 20, 0 + hy, '#fbbf24', s)
      px(ctx, lx + 19, 1 + hy, '#fbbf24', s)
      px(ctx, lx + 21, 1 + hy, '#fbbf24', s)
      px(ctx, lx + 20, 1 + hy, '#f59e0b', s)
      // Holographic element during thinking
      if (isThinking) {
        ctx.globalAlpha = 0.7
        px(ctx, lx + 25, 10, '#00FFFF', s)
        px(ctx, lx + 26, 9, '#00FFFF', s)
        px(ctx, lx + 27, 10, '#00FFFF', s)
        px(ctx, lx + 26, 11, '#00FFFF', s)
        ctx.globalAlpha = 0.4
        px(ctx, lx + 26, 8, '#00FFFF', s)
        px(ctx, lx + 28, 10, '#00FFFF', s)
        ctx.globalAlpha = 1
      }
      break
    }
    case 'operator': {
      // Headset with prominent mic boom
      rect(ctx, lx + 8, 3, 16, 2, '#4a5568', s)        // headband
      px(ctx, lx + 14, 3, '#718096', s)                  // band highlight
      rect(ctx, lx + 7, 4, 3, 4, '#2d3748', s)          // left earpiece
      rect(ctx, lx + 22, 4, 3, 4, '#2d3748', s)         // right earpiece
      px(ctx, lx + 7, 5, '#4a5568', s)                   // highlight
      // Prominent mic boom
      rect(ctx, lx + 7, 8, 1, 4, '#4a5568', s)          // boom arm
      rect(ctx, lx + 5, 11, 3, 2, '#2d3748', s)         // mic head
      px(ctx, lx + 5, 11, '#ed8936', s)                  // mic indicator LED
      // Holographic HUD display
      ctx.globalAlpha = 0.6
      rect(ctx, lx + 2, 8, 4, 3, '#ed8936', s)
      px(ctx, lx + 3, 9, '#fbbf24', s)
      px(ctx, lx + 4, 8, '#ffffff', s)
      ctx.globalAlpha = 1
      break
    }
    case 'builder': {
      // Large prominent hard hat
      rect(ctx, lx + 6, 0, 20, 4, '#FF8C00', s)        // hat body (orange)
      rect(ctx, lx + 5, 3, 22, 2, '#e67e00', s)         // brim
      rect(ctx, lx + 8, 0, 16, 1, '#FFA940', s)         // hat highlight
      px(ctx, lx + 10, 1, '#fef08a', s)                  // reflective strip
      px(ctx, lx + 14, 1, '#fef08a', s)
      px(ctx, lx + 18, 1, '#fef08a', s)
      px(ctx, lx + 22, 1, '#fef08a', s)
      // Steel-toe boots (drawn over shoes — larger)
      rect(ctx, lx + 9, 28, 6, 2, '#71717a', s)         // left boot
      rect(ctx, lx + 17, 28, 6, 2, '#71717a', s)        // right boot
      px(ctx, lx + 9, 28, '#a0a0a0', s)                  // steel toe cap L
      px(ctx, lx + 10, 28, '#a0a0a0', s)
      px(ctx, lx + 17, 28, '#a0a0a0', s)                 // steel toe cap R
      px(ctx, lx + 18, 28, '#a0a0a0', s)
      break
    }
    case 'reviewer': {
      // Large gold monocle
      ctx.beginPath()
      ctx.arc((lx + 19.5) * s, 10.5 * s, 3.5 * s, 0, Math.PI * 2)
      ctx.strokeStyle = '#FFD700'
      ctx.lineWidth = s * 0.8
      ctx.stroke()
      // Monocle glint
      px(ctx, lx + 17, 8, '#fffacd', s)
      // Chain hanging from monocle
      px(ctx, lx + 22, 13, '#FFD700', s)
      px(ctx, lx + 23, 14, '#FFD700', s)
      px(ctx, lx + 23, 15, '#DAA520', s)
      px(ctx, lx + 22, 16, '#DAA520', s)
      // Clipboard in default pose
      if (isDefault) {
        rect(ctx, lx + 4, 18, 4, 7, '#8B7355', s)      // clipboard board
        rect(ctx, lx + 5, 19, 2, 5, '#ffffff', s)       // paper
        px(ctx, lx + 5, 18, '#a0a0a0', s)               // clip
        px(ctx, lx + 6, 18, '#a0a0a0', s)
        // Tiny text lines
        rect(ctx, lx + 5, 20, 2, 1, '#c0c0c0', s)
        rect(ctx, lx + 5, 22, 1, 1, '#c0c0c0', s)
      }
      break
    }
    case 'runner': {
      // Prominent sweatband
      rect(ctx, lx + 8 + shape.leanX, 5, 16, 2, '#dc2626', s)
      px(ctx, lx + 9 + shape.leanX, 5, '#ef4444', s)    // highlight
      px(ctx, lx + 12 + shape.leanX, 5, '#ef4444', s)
      // Speed lines (more dramatic)
      ctx.globalAlpha = 0.4
      rect(ctx, lx + 2, 17, 5, 1, '#f87171', s)
      rect(ctx, lx + 1, 20, 6, 1, '#f87171', s)
      rect(ctx, lx + 3, 23, 4, 1, '#f87171', s)
      rect(ctx, lx + 0, 26, 5, 1, '#f87171', s)
      ctx.globalAlpha = 1
      break
    }
    case 'mentor': {
      // Large flowing beard
      rect(ctx, lx + 12, 14, 8, 3, '#d1d5db', s)       // upper beard
      rect(ctx, lx + 11, 15, 10, 3, '#d1d5db', s)      // mid beard
      rect(ctx, lx + 12, 17, 8, 3, '#d1d5db', s)       // lower beard
      rect(ctx, lx + 13, 19, 6, 2, '#d1d5db', s)       // beard tip
      px(ctx, lx + 15, 20, '#e5e7eb', s)                // tip detail
      px(ctx, lx + 13, 15, '#e5e7eb', s)                // highlight
      px(ctx, lx + 17, 16, '#e5e7eb', s)
      px(ctx, lx + 20, 15, '#b0b8c4', s)                // shadow
      // Half-rim reading glasses
      rect(ctx, lx + 10, 10, 4, 1, '#fbbf24', s)
      rect(ctx, lx + 17, 10, 4, 1, '#fbbf24', s)
      rect(ctx, lx + 14, 10, 3, 1, '#fbbf24', s)
      // Staff/cane prop
      if (isDefault || isThinking) {
        rect(ctx, lx + 3, 10, 1, 20, '#8B6914', s)      // staff shaft
        px(ctx, lx + 3, 10, '#DAA520', s)                // staff top ornament
        px(ctx, lx + 2, 10, '#DAA520', s)
        px(ctx, lx + 4, 10, '#DAA520', s)
        px(ctx, lx + 3, 9, '#FFD700', s)                 // top gem
        px(ctx, lx + 3, 29, '#6B4E12', s)                // staff bottom
      }
      break
    }
    case 'commander': {
      // Officer cap with gold trim
      rect(ctx, lx + 7, 0, 18, 4, '#1e293b', s)         // cap body
      rect(ctx, lx + 6, 3, 20, 2, '#0f172a', s)          // visor
      rect(ctx, lx + 9, 0, 14, 1, '#fbbf24', s)          // gold band
      px(ctx, lx + 16, -1, '#fbbf24', s)                  // cap badge
      px(ctx, lx + 15, -1, '#fbbf24', s)
      px(ctx, lx + 16, 0, '#FFD700', s)                   // badge shine
      // Large epaulettes (gold trimmed)
      rect(ctx, lx + 6, shape.torsoY, 4, 2, '#fbbf24', s)
      rect(ctx, lx + 22, shape.torsoY, 4, 2, '#fbbf24', s)
      px(ctx, lx + 5, shape.torsoY, '#fbbf24', s)         // fringe L
      px(ctx, lx + 5, shape.torsoY + 1, '#DAA520', s)
      px(ctx, lx + 26, shape.torsoY, '#fbbf24', s)        // fringe R
      px(ctx, lx + 26, shape.torsoY + 1, '#DAA520', s)
      // Medal on chest
      px(ctx, lx + 14, shape.torsoY + 2, '#fbbf24', s)
      px(ctx, lx + 15, shape.torsoY + 3, '#FFD700', s)
      break
    }
  }
}

// ── Per-class eye override ──────────────────────────────────────────────────
function getIrisColor(cls: string, p: FullPalette): string {
  if (cls === 'hacker') return '#00FF41'
  return p.iris
}

function drawEyeGlow(ctx: CanvasRenderingContext2D, x: number, s: number, cls: string) {
  if (cls === 'hacker') {
    // Glowing green eyes aura
    ctx.globalAlpha = 0.2
    ctx.fillStyle = '#00FF41'
    ctx.beginPath()
    ctx.arc((x + 12) * s, 11 * s, 3 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc((x + 19) * s, 11 * s, 3 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

// ── Character frame drawing ─────────────────────────────────────────────────
// Frames: 0=idle, 1=blink, 2=walkL, 3=walkR, 4=typeA, 5=typeB, 6=readA, 7=readB
// Extended: 8=thinking, 9=error, 10=done, 11=toolA, 12=toolB
const TOTAL_FRAMES = 13

function drawCharacterFrame(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  basePalette: { skin: string; hair: string; shirt: string; pants: string; shoes: string; accent: string; outline: string },
  frame: number,
  scale: number,
  characterClass: string = 'developer',
) {
  const s = scale
  const x = offsetX
  const p = buildPalette(basePalette)
  const shape = getBodyShape(characterClass)
  const hy = shape.hunchY
  const lx = shape.leanX

  const isBlink = frame === 1
  const isWalk2 = frame === 2
  const isWalk3 = frame === 3
  const isTypeA = frame === 4
  const isTypeB = frame === 5
  const isReadA = frame === 6
  const isReadB = frame === 7
  const isThinking = frame === 8
  const isError = frame === 9
  const isDone = frame === 10
  const isToolA = frame === 11
  const isToolB = frame === 12

  const legOff = isWalk2 ? 1 : isWalk3 ? -1 : isDone ? -1 : 0

  // ── Ground shadow (soft ellipse) ──────────────────────────────────
  ctx.save()
  ctx.globalAlpha = 0.25
  ctx.fillStyle = '#000000'
  const shadowW = characterClass === 'builder' ? 10 : characterClass === 'runner' ? 6 : 8
  ctx.beginPath()
  ctx.ellipse((x + 16 + lx) * s, 30 * s, shadowW * s, 2.5 * s, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // ── Legs with shading ─────────────────────────────────────────────
  const legX1 = x + lx + (16 - Math.floor(shape.torsoW / 2)) + 1
  const legX2 = x + lx + (16 + Math.floor(shape.torsoW / 2)) - shape.legW - 1
  const legY = shape.torsoY + shape.torsoH + hy

  rect(ctx, legX1, legY + legOff, shape.legW, 5, p.pants, s)
  rect(ctx, legX2, legY - legOff, shape.legW, 5, p.pants, s)
  // Inner shadow on legs
  px(ctx, legX1 + shape.legW - 1, legY + 1 + legOff, p.pantsSh, s)
  px(ctx, legX1 + shape.legW - 1, legY + 2 + legOff, p.pantsSh, s)
  px(ctx, legX2, legY + 1 - legOff, p.pantsSh, s)
  px(ctx, legX2, legY + 2 - legOff, p.pantsSh, s)

  // ── Shoes with sole & highlight ───────────────────────────────────
  const shoeY1 = legY + 3 + legOff
  const shoeY2 = legY + 3 - legOff
  const shoeW = characterClass === 'builder' ? shape.legW + 2 : shape.legW
  const shoeX1 = characterClass === 'builder' ? legX1 - 1 : legX1
  const shoeX2 = characterClass === 'builder' ? legX2 - 1 : legX2

  rect(ctx, shoeX1, shoeY1, shoeW, 2, p.shoes, s)
  rect(ctx, shoeX2, shoeY2, shoeW, 2, p.shoes, s)
  // Sole (darker bottom pixel)
  rect(ctx, shoeX1, shoeY1 + 1, shoeW, 1, p.shoesSh, s)
  rect(ctx, shoeX2, shoeY2 + 1, shoeW, 1, p.shoesSh, s)
  // Toe highlight
  px(ctx, shoeX1, shoeY1, p.shoesHi, s)
  px(ctx, shoeX2, shoeY2, p.shoesHi, s)

  // ── Body torso with shading ───────────────────────────────────────
  const torsoLeft = x + lx + shape.torsoX
  const torsoTop = shape.torsoY + hy

  rect(ctx, torsoLeft, torsoTop, shape.torsoW, shape.torsoH, p.shirt, s)
  // Left-side highlight column
  rect(ctx, torsoLeft, torsoTop, 2, shape.torsoH, p.shirtHi, s)
  // Right-side shadow column
  rect(ctx, torsoLeft + shape.torsoW - 2, torsoTop, 2, shape.torsoH, p.shirtSh, s)
  // Collar
  const collarLeft = x + lx + 11
  rect(ctx, collarLeft, torsoTop - 1, shape.torsoW - 2, 1, p.shirtHi, s)
  rect(ctx, collarLeft + 2, torsoTop - 1, shape.torsoW - 6, 1, lighten(p.shirt, 0.3), s)

  // Shoulder extensions
  if (shape.shoulderExtra > 0) {
    rect(ctx, torsoLeft - shape.shoulderExtra, torsoTop, shape.shoulderExtra, 2, p.shirtSh, s)
    rect(ctx, torsoLeft + shape.torsoW, torsoTop, shape.shoulderExtra, 2, p.shirtSh, s)
  }

  // Center seam line
  const cx = x + lx + 16
  px(ctx, cx, torsoTop + 1, p.shirtSh, s)
  px(ctx, cx, torsoTop + 3, p.shirtSh, s)
  px(ctx, cx, torsoTop + 5, p.shirtSh, s)
  // Belt line
  rect(ctx, torsoLeft, torsoTop + shape.torsoH - 1, shape.torsoW, 1, darken(p.pants, 0.1), s)
  px(ctx, cx, torsoTop + shape.torsoH - 1, '#a0a0a0', s)  // belt buckle

  // ── Arms with shading (pose-dependent) ────────────────────────────
  const armLeft = torsoLeft - shape.armW
  const armRight = torsoLeft + shape.torsoW
  const armTop = torsoTop

  if (isDone) {
    // Arms raised celebration
    rect(ctx, armLeft, torsoTop - 7, shape.armW + 1, 8, p.skin, s)
    rect(ctx, armRight, torsoTop - 7, shape.armW + 1, 8, p.skin, s)
    // Shirt sleeve
    rect(ctx, armLeft, torsoTop - 2, shape.armW + 1, 3, p.shirt, s)
    rect(ctx, armRight, torsoTop - 2, shape.armW + 1, 3, p.shirt, s)
    // Hands (fingers spread)
    rect(ctx, armLeft, torsoTop - 8, shape.armW + 1, 2, p.skin, s)
    px(ctx, armLeft - 1, torsoTop - 8, p.skin, s)
    px(ctx, armRight + shape.armW + 1, torsoTop - 8, p.skin, s)
    // Arm shading
    px(ctx, armLeft + shape.armW, torsoTop - 5, p.skinSh, s)
    px(ctx, armRight, torsoTop - 5, p.skinSh, s)
  } else if (isThinking) {
    // Left arm normal, right arm up to chin
    rect(ctx, armLeft, armTop, shape.armW, 8, p.skin, s)
    px(ctx, armLeft + shape.armW - 1, armTop + 2, p.skinSh, s)
    rect(ctx, armLeft, armTop, shape.armW, 2, p.shirt, s)
    rect(ctx, armRight, armTop - 4, shape.armW, 6, p.skin, s)
    // Hand on chin
    rect(ctx, armRight - 2, armTop - 4, shape.armW, 2, p.skin, s)
    rect(ctx, armRight, armTop, shape.armW, 2, p.shirt, s)
    px(ctx, armRight + shape.armW, armTop - 2, p.skinSh, s)
  } else if (isReadA || isReadB) {
    const readOff = isReadB ? 1 : 0
    rect(ctx, armLeft + 1, armTop + 1 + readOff, shape.armW, 6, p.skin, s)
    rect(ctx, armRight - 1, armTop + 1 + readOff, shape.armW, 6, p.skin, s)
    // Sleeves
    rect(ctx, armLeft + 1, armTop, shape.armW, 2, p.shirt, s)
    rect(ctx, armRight - 1, armTop, shape.armW, 2, p.shirt, s)
    // Book/tablet
    rect(ctx, armLeft + 2, armTop + 2 + readOff, shape.torsoW + 2, 5, p.accent, s)
    rect(ctx, armLeft + 3, armTop + 3 + readOff, shape.torsoW, 3, '#ffffff', s)
    // Text lines on book
    rect(ctx, armLeft + 4, armTop + 3 + readOff, 4, 1, '#d1d5db', s)
    rect(ctx, armLeft + 4, armTop + 5 + readOff, 6, 1, '#d1d5db', s)
    // Book spine highlight
    px(ctx, armLeft + 2, armTop + 3 + readOff, p.accentHi, s)
  } else if (isTypeA || isTypeB) {
    const lOff = isTypeA ? 2 : 0
    const rOff = isTypeA ? 0 : 2
    rect(ctx, armLeft, armTop + lOff, shape.armW, 7, p.skin, s)
    rect(ctx, armRight, armTop + rOff, shape.armW, 7, p.skin, s)
    // Sleeves
    rect(ctx, armLeft, armTop, shape.armW, 2, p.shirt, s)
    rect(ctx, armRight, armTop, shape.armW, 2, p.shirt, s)
    // Finger detail
    px(ctx, armLeft, armTop + 6 + lOff, p.skinSh, s)
    px(ctx, armRight, armTop + 6 + rOff, p.skinSh, s)
  } else if (isToolA || isToolB) {
    const tOff = isToolB ? 1 : 0
    rect(ctx, armLeft, armTop, shape.armW, 8, p.skin, s)
    rect(ctx, armLeft, armTop, shape.armW, 2, p.shirt, s)
    rect(ctx, armRight, armTop - 2 + tOff, shape.armW, 6, p.skin, s)
    rect(ctx, armRight, armTop, shape.armW, 2, p.shirt, s)
    // Wrench with detail
    rect(ctx, armRight + shape.armW, armTop - 4 + tOff, 4, 2, '#b0b0b0', s)
    rect(ctx, armRight + shape.armW + 1, armTop - 2 + tOff, 2, 5, '#a0a0a0', s)
    px(ctx, armRight + shape.armW, armTop - 4 + tOff, '#d4d4d4', s)   // wrench highlight
    px(ctx, armRight + shape.armW + 3, armTop - 3 + tOff, '#888888', s) // wrench shadow
    // Spark particles
    if (isToolA) {
      px(ctx, armRight + shape.armW + 3, armTop - 5, '#fbbf24', s)
      px(ctx, armRight + shape.armW + 4, armTop - 6, '#fef08a', s)
    }
  } else {
    // Default arms with shading
    rect(ctx, armLeft, armTop, shape.armW, 8, p.skin, s)
    rect(ctx, armRight, armTop, shape.armW, 8, p.skin, s)
    // Sleeves
    rect(ctx, armLeft, armTop, shape.armW, 2, p.shirt, s)
    rect(ctx, armRight, armTop, shape.armW, 2, p.shirt, s)
    // Arm shading (right side darker)
    px(ctx, armLeft + shape.armW - 1, armTop + 3, p.skinSh, s)
    px(ctx, armLeft + shape.armW - 1, armTop + 5, p.skinSh, s)
    px(ctx, armRight, armTop + 3, p.skinSh, s)
    px(ctx, armRight, armTop + 5, p.skinSh, s)
    // Hands (fist detail)
    px(ctx, armLeft, armTop + 7, p.skinSh, s)
    px(ctx, armRight + shape.armW - 1, armTop + 7, p.skinSh, s)
  }

  // ── Neck ──────────────────────────────────────────────────────────
  const neckY = torsoTop - 2
  rect(ctx, x + lx + 14, neckY, 4, 2, p.skin, s)
  px(ctx, x + lx + 17, neckY, p.skinSh, s)

  // ── Head ──────────────────────────────────────────────────────────
  drawHead(ctx, x + lx, s, characterClass, p, shape)

  // ── Hair ──────────────────────────────────────────────────────────
  drawHair(ctx, x, s, characterClass, p, shape)

  // ── Eyebrows (expression-dependent) ───────────────────────────────
  const browColor = darken(p.hair, 0.15)
  const browY = Math.round(shape.headY + hy) - 2
  if (isError) {
    // Angry V brows
    px(ctx, x + lx + 11, browY, browColor, s); px(ctx, x + lx + 12, browY + 1, browColor, s)
    px(ctx, x + lx + 20, browY, browColor, s); px(ctx, x + lx + 19, browY + 1, browColor, s)
  } else if (isDone) {
    // Raised happy brows
    rect(ctx, x + lx + 11, browY, 3, 1, browColor, s)
    rect(ctx, x + lx + 18, browY, 3, 1, browColor, s)
  } else if (isThinking) {
    // One raised, one flat
    px(ctx, x + lx + 11, browY, browColor, s); px(ctx, x + lx + 12, browY, browColor, s)
    px(ctx, x + lx + 18, browY - 1, browColor, s); px(ctx, x + lx + 19, browY - 1, browColor, s); px(ctx, x + lx + 20, browY, browColor, s)
  } else {
    // Neutral brows
    rect(ctx, x + lx + 11, browY + 1, 3, 1, browColor, s)
    rect(ctx, x + lx + 18, browY + 1, 3, 1, browColor, s)
  }

  // ── Eye glow for hacker ─────────────────────────────────────────
  drawEyeGlow(ctx, x + lx, s, characterClass)

  // ── Eyes (sclera + iris + pupil + catchlight) ─────────────────────
  const eyeBaseY = Math.round(shape.headY + hy) - 0.5
  const irisColor = getIrisColor(characterClass, p)

  if (isError) {
    // X-eyes
    px(ctx, x + lx + 11, eyeBaseY, '#ef4444', s); px(ctx, x + lx + 13, eyeBaseY + 2, '#ef4444', s)
    px(ctx, x + lx + 13, eyeBaseY, '#ef4444', s); px(ctx, x + lx + 11, eyeBaseY + 2, '#ef4444', s)
    px(ctx, x + lx + 18, eyeBaseY, '#ef4444', s); px(ctx, x + lx + 20, eyeBaseY + 2, '#ef4444', s)
    px(ctx, x + lx + 20, eyeBaseY, '#ef4444', s); px(ctx, x + lx + 18, eyeBaseY + 2, '#ef4444', s)
  } else if (isBlink) {
    // Closed line
    rect(ctx, x + lx + 11, eyeBaseY + 1, 3, 1, '#1e1e1e', s)
    rect(ctx, x + lx + 18, eyeBaseY + 1, 3, 1, '#1e1e1e', s)
  } else if (isDone) {
    // Happy ^ ^ eyes
    px(ctx, x + lx + 11, eyeBaseY + 1, '#1e1e1e', s); px(ctx, x + lx + 12, eyeBaseY, '#1e1e1e', s); px(ctx, x + lx + 13, eyeBaseY + 1, '#1e1e1e', s)
    px(ctx, x + lx + 18, eyeBaseY + 1, '#1e1e1e', s); px(ctx, x + lx + 19, eyeBaseY, '#1e1e1e', s); px(ctx, x + lx + 20, eyeBaseY + 1, '#1e1e1e', s)
  } else {
    // Full detailed eyes
    const eyeY = isThinking ? eyeBaseY - 1 : eyeBaseY
    // Engineer with goggles — eyes behind lenses (still visible but muted)
    if (characterClass === 'engineer') {
      ctx.globalAlpha = 0.7
    }
    // Left eye: sclera
    rect(ctx, x + lx + 11, eyeY, 3, 3, '#ffffff', s)
    // Left eye: iris
    px(ctx, x + lx + 11, eyeY, irisColor, s); px(ctx, x + lx + 12, eyeY, irisColor, s)
    px(ctx, x + lx + 11, eyeY + 1, irisColor, s); px(ctx, x + lx + 12, eyeY + 1, darken(irisColor, 0.3), s)
    // Left eye: pupil
    px(ctx, x + lx + 12, eyeY, '#0a0a0a', s)
    // Left eye: catchlight
    px(ctx, x + lx + 11, eyeY, '#ffffff', s)
    // Left eye: bottom eyelid hint
    px(ctx, x + lx + 12, eyeY + 2, p.skinSh, s)

    // Right eye: sclera
    rect(ctx, x + lx + 18, eyeY, 3, 3, '#ffffff', s)
    // Right eye: iris
    px(ctx, x + lx + 19, eyeY, irisColor, s); px(ctx, x + lx + 18, eyeY, irisColor, s)
    px(ctx, x + lx + 19, eyeY + 1, irisColor, s); px(ctx, x + lx + 18, eyeY + 1, darken(irisColor, 0.3), s)
    // Right eye: pupil
    px(ctx, x + lx + 18, eyeY, '#0a0a0a', s)
    // Right eye: catchlight
    px(ctx, x + lx + 19, eyeY, '#ffffff', s)
    // Right eye: bottom eyelid hint
    px(ctx, x + lx + 18, eyeY + 2, p.skinSh, s)

    if (characterClass === 'engineer') {
      ctx.globalAlpha = 1
    }
  }

  // ── Nose (subtle hint) ────────────────────────────────────────────
  if (!isBlink && !isDone) {
    px(ctx, x + lx + 16, Math.round(shape.headY + hy) + 1, p.skinSh, s)
    px(ctx, x + lx + 15, Math.round(shape.headY + hy) + 2, p.skinSh, s)
  }

  // ── Cheek blush ───────────────────────────────────────────────────
  ctx.globalAlpha = 0.2
  ctx.fillStyle = p.blush
  ctx.beginPath()
  ctx.arc((x + lx + 11) * s, (shape.headY + hy + 2.5) * s, 1.5 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc((x + lx + 21) * s, (shape.headY + hy + 2.5) * s, 1.5 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // ── Mouth ─────────────────────────────────────────────────────────
  const mouthY = Math.round(shape.headY + hy) + 3
  if (isDone) {
    // Wide smile
    px(ctx, x + lx + 13, mouthY, '#1e1e1e', s)
    rect(ctx, x + lx + 14, mouthY + 1, 4, 1, '#1e1e1e', s)
    px(ctx, x + lx + 18, mouthY, '#1e1e1e', s)
    // Teeth hint
    rect(ctx, x + lx + 14, mouthY, 4, 1, '#ffffff', s)
  } else if (isError) {
    // Jagged frown
    px(ctx, x + lx + 13, mouthY, '#1e1e1e', s)
    rect(ctx, x + lx + 14, mouthY + 1, 4, 1, '#1e1e1e', s)
    px(ctx, x + lx + 18, mouthY, '#1e1e1e', s)
  } else if (isThinking) {
    // Small "o" mouth
    px(ctx, x + lx + 15, mouthY, '#1e1e1e', s)
    px(ctx, x + lx + 16, mouthY, '#1e1e1e', s)
  } else {
    // Neutral line
    rect(ctx, x + lx + 14, mouthY, 4, 1, '#1e1e1e', s)
  }

  // ── Accent badge on shirt ─────────────────────────────────────────
  if (characterClass !== 'manager' && characterClass !== 'commander') {
    rect(ctx, x + lx + 14, torsoTop + 2, 3, 2, p.accent, s)
    px(ctx, x + lx + 14, torsoTop + 2, p.accentHi, s)
  }

  // ── Outline (anti-aliased — inner edge shadow) ────────────────────
  ctx.globalAlpha = 0.6
  const olLeft = torsoLeft - 1
  const olRight = torsoLeft + shape.torsoW
  rect(ctx, olLeft, 5 + hy, 1, 12, p.outline, s)
  rect(ctx, olRight, 5 + hy, 1, 12, p.outline, s)
  rect(ctx, olLeft, torsoTop, 1, shape.torsoH + 8, p.outline, s)
  rect(ctx, olRight, torsoTop, 1, shape.torsoH + 8, p.outline, s)
  ctx.globalAlpha = 1

  // ── Per-class accessory & props ───────────────────────────────────
  drawAccessory(ctx, x, s, characterClass, p, frame, shape)

  // ── Frame-specific overlays ───────────────────────────────────────
  if (isThinking) {
    // Thought dots (ascending, pulsing purple)
    px(ctx, x + lx + 21, 3 + hy, '#a855f7', s)
    px(ctx, x + lx + 23, 1 + hy, '#c084fc', s)
    px(ctx, x + lx + 24, 0, '#e9d5ff', s)
  } else if (isDone) {
    // Sparkle stars with proper star shape
    px(ctx, x + 5, 5, '#fbbf24', s); px(ctx, x + 6, 4, '#fbbf24', s); px(ctx, x + 6, 6, '#fbbf24', s)
    px(ctx, x + 7, 5, '#fbbf24', s)  // left star
    px(ctx, x + 25, 3, '#fbbf24', s); px(ctx, x + 26, 2, '#fbbf24', s); px(ctx, x + 26, 4, '#fbbf24', s)
    px(ctx, x + 27, 3, '#fbbf24', s) // right star
    px(ctx, x + 15, 0, '#fde68a', s) // top sparkle
  } else if (isError) {
    // Red tint overlay + danger lines
    ctx.fillStyle = 'rgba(239,68,68,0.12)'
    ctx.fillRect((x + 8) * s, 3 * s, 16 * s, 28 * s)
    // Danger exclamation
    px(ctx, x + 24, 2, '#ef4444', s)
    px(ctx, x + 24, 3, '#ef4444', s)
    px(ctx, x + 24, 5, '#ef4444', s)
  }
}

/**
 * Generate a sprite sheet with 13 frames for 1 character type.
 * Frames: 0=idle, 1=blink, 2=walkL, 3=walkR, 4=typeA, 5=typeB,
 *         6=readA, 7=readB, 8=thinking, 9=error, 10=done, 11=toolA, 12=toolB
 */
export function generateCharacterSheet(characterClass: string, pixelLevel: string = '16bit'): HTMLCanvasElement {
  const palette = CHARACTER_PALETTES[characterClass] || CHARACTER_PALETTES.developer
  const config = PIXEL_CONFIGS[pixelLevel] || PIXEL_CONFIGS['16bit']
  const s = config.scale
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_SIZE * TOTAL_FRAMES * s
  canvas.height = SPRITE_SIZE * s
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = config.smoothing
  for (let f = 0; f < TOTAL_FRAMES; f++) {
    drawCharacterFrame(ctx, f * SPRITE_SIZE, palette, f, s, characterClass)
  }
  return canvas
}

/** Map AgentState → sprite frame index */
export function stateToFrame(state: string, tick: number): number {
  switch (state) {
    case 'idle': return tick % 4 === 3 ? 1 : 0        // occasional blink
    case 'thinking': return 8                           // hand on chin
    case 'reading': return tick % 2 === 0 ? 6 : 7      // page turn
    case 'writing': return tick % 2 === 0 ? 4 : 5      // keystroke
    case 'tool': return tick % 2 === 0 ? 11 : 12       // wrench swing
    case 'waiting': return tick % 3 === 0 ? 1 : 0      // frequent blinks
    case 'moving': return tick % 4 < 2 ? 2 : 3         // walk cycle
    case 'error': return 9                              // X-eyes
    case 'done': return 10                              // arms-up celebration
    default: return 0
  }
}

// ── Pre-generate all sprites ────────────────────────────────────────────────
const spriteCache = new Map<string, HTMLCanvasElement>()

export function getCharacterSheet(characterClass: string, pixelLevel: string): HTMLCanvasElement {
  const key = `${characterClass}_${pixelLevel}`
  if (!spriteCache.has(key)) {
    spriteCache.set(key, generateCharacterSheet(characterClass, pixelLevel))
  }
  return spriteCache.get(key)!
}

export function clearSpriteCache() {
  spriteCache.clear()
}
