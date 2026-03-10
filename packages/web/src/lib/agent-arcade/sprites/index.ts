/**
 * World-class procedural pixel-art sprite generator
 *
 * Professional-quality character sprites with:
 * - Sub-pixel anti-aliased rendering (arcs, gradients)
 * - Per-pixel shading (highlight / mid / shadow tones)
 * - Detailed eyes (sclera, iris, pupil, catchlight)
 * - Expressive eyebrows per emotion
 * - Body shading & clothing detail (collar, seams, belt)
 * - Per-class accessories (headphones, glasses, beret, etc.)
 * - 13 fully distinct animation frames
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

// ── Accessory drawing per character class ───────────────────────────────────
function drawAccessory(ctx: CanvasRenderingContext2D, x: number, s: number, cls: string, p: FullPalette) {
  switch (cls) {
    case 'developer':
      // Headphones band over hair
      rect(ctx, x + 9, 3, 14, 1, '#555555', s)
      rect(ctx, x + 8, 4, 2, 3, '#333333', s)     // left earpiece
      rect(ctx, x + 22, 4, 2, 3, '#333333', s)     // right earpiece
      px(ctx, x + 8, 5, '#555555', s)               // earpiece highlight
      px(ctx, x + 22, 5, '#555555', s)
      break
    case 'designer':
      // Beret
      rect(ctx, x + 10, 1, 10, 2, '#e11d48', s)
      rect(ctx, x + 9, 2, 12, 2, '#e11d48', s)
      px(ctx, x + 14, 0, '#e11d48', s)              // beret nub
      px(ctx, x + 11, 1, '#fb7185', s)              // beret highlight
      break
    case 'manager':
      // Tie
      rect(ctx, x + 15, 17, 2, 1, p.accent, s)     // knot
      rect(ctx, x + 15, 18, 2, 5, p.accent, s)     // tie body
      px(ctx, x + 15, 23, p.accent, s)              // tie point
      px(ctx, x + 15, 18, p.accentHi, s)            // tie highlight
      // Glasses
      rect(ctx, x + 10, 10, 4, 2, '#a0a0a0', s)
      rect(ctx, x + 17, 10, 4, 2, '#a0a0a0', s)
      rect(ctx, x + 14, 10, 3, 1, '#a0a0a0', s)    // bridge
      break
    case 'researcher':
      // Lab coat collar flaps
      rect(ctx, x + 10, 16, 3, 2, '#f8fafc', s)
      rect(ctx, x + 19, 16, 3, 2, '#f8fafc', s)
      // Glasses
      rect(ctx, x + 10, 10, 4, 2, '#b8b8b8', s)
      rect(ctx, x + 17, 10, 4, 2, '#b8b8b8', s)
      rect(ctx, x + 14, 10, 3, 1, '#b8b8b8', s)
      break
    case 'writer':
      // Pencil behind ear
      rect(ctx, x + 22, 6, 1, 5, '#fbbf24', s)
      px(ctx, x + 22, 11, '#f59e0b', s)             // pencil tip
      px(ctx, x + 22, 6, '#f472b6', s)              // eraser
      break
    case 'engineer':
      // Safety goggles on forehead
      rect(ctx, x + 10, 5, 12, 2, '#fbbf24', s)
      rect(ctx, x + 11, 5, 4, 2, '#92ddfb', s)     // left lens
      rect(ctx, x + 17, 5, 4, 2, '#92ddfb', s)     // right lens
      px(ctx, x + 12, 5, '#c8f0ff', s)              // lens highlight
      px(ctx, x + 18, 5, '#c8f0ff', s)
      break
    case 'hacker':
      // Hood pulled up
      rect(ctx, x + 8, 2, 16, 3, darken(p.shirt, 0.1), s)
      rect(ctx, x + 7, 4, 2, 6, darken(p.shirt, 0.1), s)
      rect(ctx, x + 23, 4, 2, 6, darken(p.shirt, 0.1), s)
      px(ctx, x + 8, 3, lighten(p.shirt, 0.1), s)   // hood edge highlight
      break
    case 'analyst':
      // Earpiece
      px(ctx, x + 22, 10, '#60a5fa', s)
      px(ctx, x + 22, 11, '#3b82f6', s)
      px(ctx, x + 23, 10, '#3b82f6', s)
      break
    case 'strategist':
      // Military beret + star pin
      rect(ctx, x + 9, 1, 14, 2, '#1e3a5f', s)
      rect(ctx, x + 8, 2, 16, 2, '#1e3a5f', s)
      px(ctx, x + 19, 1, '#f59e0b', s)              // gold star
      px(ctx, x + 20, 2, '#fbbf24', s)
      break
    case 'operator':
      // Headset with mic boom
      rect(ctx, x + 9, 3, 14, 1, '#4a5568', s)
      rect(ctx, x + 8, 4, 2, 3, '#2d3748', s)
      rect(ctx, x + 22, 4, 2, 3, '#2d3748', s)
      rect(ctx, x + 7, 11, 3, 1, '#4a5568', s)      // mic boom
      px(ctx, x + 6, 12, '#ed8936', s)               // mic tip
      break
    case 'builder':
      // Hard hat
      rect(ctx, x + 8, 1, 16, 3, '#fbbf24', s)
      rect(ctx, x + 7, 3, 18, 1, '#f59e0b', s)      // brim
      px(ctx, x + 10, 1, '#fef08a', s)               // hat highlight
      break
    case 'reviewer':
      // Monocle on right eye + notepad
      ctx.beginPath()
      ctx.arc((x + 19.5) * s, 10.5 * s, 2.5 * s, 0, Math.PI * 2)
      ctx.strokeStyle = '#a78bfa'
      ctx.lineWidth = s * 0.5
      ctx.stroke()
      px(ctx, x + 22, 12, '#a78bfa', s)              // chain link
      px(ctx, x + 22, 13, '#a78bfa', s)
      break
    case 'runner':
      // Sweatband
      rect(ctx, x + 8, 6, 16, 1, '#dc2626', s)
      px(ctx, x + 9, 6, '#ef4444', s)                // band highlight
      // Speed lines behind body
      ctx.globalAlpha = 0.3
      rect(ctx, x + 4, 19, 3, 1, '#f87171', s)
      rect(ctx, x + 3, 22, 4, 1, '#f87171', s)
      ctx.globalAlpha = 1
      break
    case 'mentor':
      // Wise beard + reading glasses
      rect(ctx, x + 13, 14, 6, 2, '#d1d5db', s)      // beard
      rect(ctx, x + 12, 15, 8, 2, '#d1d5db', s)
      px(ctx, x + 14, 16, '#e5e7eb', s)              // beard highlight
      // Small half-rim glasses
      rect(ctx, x + 10, 10, 4, 1, '#fbbf24', s)
      rect(ctx, x + 17, 10, 4, 1, '#fbbf24', s)
      rect(ctx, x + 14, 10, 3, 1, '#fbbf24', s)
      break
    case 'commander':
      // Officer cap + gold trim + shoulder epaulettes
      rect(ctx, x + 8, 1, 16, 3, '#1e293b', s)       // cap body
      rect(ctx, x + 7, 3, 18, 1, '#0f172a', s)       // visor
      rect(ctx, x + 10, 1, 12, 1, '#fbbf24', s)      // gold band
      px(ctx, x + 16, 0, '#fbbf24', s)                // cap badge
      // Epaulettes
      rect(ctx, x + 7, 17, 3, 1, '#fbbf24', s)
      rect(ctx, x + 22, 17, 3, 1, '#fbbf24', s)
      break
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
  ctx.beginPath()
  ctx.ellipse((x + 16) * s, 30 * s, 8 * s, 2.5 * s, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // ── Legs with shading ─────────────────────────────────────────────
  rect(ctx, x + 11, 25 + legOff, 4, 5, p.pants, s)
  rect(ctx, x + 17, 25 - legOff, 4, 5, p.pants, s)
  // Inner shadow on legs
  px(ctx, x + 14, 26 + legOff, p.pantsSh, s)
  px(ctx, x + 14, 27 + legOff, p.pantsSh, s)
  px(ctx, x + 17, 26 - legOff, p.pantsSh, s)
  px(ctx, x + 17, 27 - legOff, p.pantsSh, s)

  // ── Shoes with sole & highlight ───────────────────────────────────
  rect(ctx, x + 11, 28 + legOff, 4, 2, p.shoes, s)
  rect(ctx, x + 17, 28 - legOff, 4, 2, p.shoes, s)
  // Sole (darker bottom pixel)
  rect(ctx, x + 11, 29 + legOff, 4, 1, p.shoesSh, s)
  rect(ctx, x + 17, 29 - legOff, 4, 1, p.shoesSh, s)
  // Toe highlight
  px(ctx, x + 11, 28 + legOff, p.shoesHi, s)
  px(ctx, x + 17, 28 - legOff, p.shoesHi, s)

  // ── Body torso with shading ───────────────────────────────────────
  rect(ctx, x + 10, 17, 12, 9, p.shirt, s)
  // Left-side highlight column
  rect(ctx, x + 10, 17, 2, 9, p.shirtHi, s)
  // Right-side shadow column
  rect(ctx, x + 20, 17, 2, 9, p.shirtSh, s)
  // Collar (lighter strip at top of shirt)
  rect(ctx, x + 11, 16, 10, 1, p.shirtHi, s)
  rect(ctx, x + 13, 16, 6, 1, lighten(p.shirt, 0.3), s)
  // Center seam line
  px(ctx, x + 16, 18, p.shirtSh, s)
  px(ctx, x + 16, 20, p.shirtSh, s)
  px(ctx, x + 16, 22, p.shirtSh, s)
  // Belt line
  rect(ctx, x + 10, 24, 12, 1, darken(p.pants, 0.1), s)
  px(ctx, x + 16, 24, '#a0a0a0', s)  // belt buckle

  // ── Arms with shading (pose-dependent) ────────────────────────────
  if (isDone) {
    // Arms raised celebration
    rect(ctx, x + 6, 10, 4, 8, p.skin, s)
    rect(ctx, x + 22, 10, 4, 8, p.skin, s)
    // Shirt sleeve
    rect(ctx, x + 6, 15, 4, 3, p.shirt, s)
    rect(ctx, x + 22, 15, 4, 3, p.shirt, s)
    // Hands (fingers spread)
    rect(ctx, x + 6, 9, 4, 2, p.skin, s)
    px(ctx, x + 5, 9, p.skin, s)
    px(ctx, x + 26, 9, p.skin, s)
    // Arm shading
    px(ctx, x + 9, 12, p.skinSh, s)
    px(ctx, x + 22, 12, p.skinSh, s)
  } else if (isThinking) {
    // Left arm normal, right arm up to chin
    rect(ctx, x + 7, 17, 3, 8, p.skin, s)
    px(ctx, x + 9, 19, p.skinSh, s)
    rect(ctx, x + 7, 17, 3, 2, p.shirt, s)
    rect(ctx, x + 22, 13, 3, 6, p.skin, s)
    // Hand on chin
    rect(ctx, x + 20, 13, 3, 2, p.skin, s)
    rect(ctx, x + 22, 17, 3, 2, p.shirt, s)
    px(ctx, x + 24, 15, p.skinSh, s)
  } else if (isReadA || isReadB) {
    const readOff = isReadB ? 1 : 0
    rect(ctx, x + 8, 18 + readOff, 3, 6, p.skin, s)
    rect(ctx, x + 21, 18 + readOff, 3, 6, p.skin, s)
    // Sleeves
    rect(ctx, x + 8, 17, 3, 2, p.shirt, s)
    rect(ctx, x + 21, 17, 3, 2, p.shirt, s)
    // Book/tablet
    rect(ctx, x + 9, 19 + readOff, 14, 5, p.accent, s)
    rect(ctx, x + 10, 20 + readOff, 12, 3, '#ffffff', s)
    // Text lines on book
    rect(ctx, x + 11, 20 + readOff, 4, 1, '#d1d5db', s)
    rect(ctx, x + 11, 22 + readOff, 6, 1, '#d1d5db', s)
    // Book spine highlight
    px(ctx, x + 9, 20 + readOff, p.accentHi, s)
  } else if (isTypeA || isTypeB) {
    const lOff = isTypeA ? 2 : 0
    const rOff = isTypeA ? 0 : 2
    rect(ctx, x + 7, 17 + lOff, 3, 7, p.skin, s)
    rect(ctx, x + 22, 17 + rOff, 3, 7, p.skin, s)
    // Sleeves
    rect(ctx, x + 7, 17, 3, 2, p.shirt, s)
    rect(ctx, x + 22, 17, 3, 2, p.shirt, s)
    // Finger detail
    px(ctx, x + 7, 23 + lOff, p.skinSh, s)
    px(ctx, x + 22, 23 + rOff, p.skinSh, s)
  } else if (isToolA || isToolB) {
    const tOff = isToolB ? 1 : 0
    rect(ctx, x + 7, 17, 3, 8, p.skin, s)
    rect(ctx, x + 7, 17, 3, 2, p.shirt, s)
    rect(ctx, x + 22, 15 + tOff, 3, 6, p.skin, s)
    rect(ctx, x + 22, 17, 3, 2, p.shirt, s)
    // Wrench with detail
    rect(ctx, x + 24, 13 + tOff, 4, 2, '#b0b0b0', s)
    rect(ctx, x + 25, 15 + tOff, 2, 5, '#a0a0a0', s)
    px(ctx, x + 24, 13 + tOff, '#d4d4d4', s)        // wrench highlight
    px(ctx, x + 27, 14 + tOff, '#888888', s)         // wrench shadow
    // Spark particles
    if (isToolA) {
      px(ctx, x + 27, 12, '#fbbf24', s)
      px(ctx, x + 28, 11, '#fef08a', s)
    }
  } else {
    // Default arms with shading
    rect(ctx, x + 7, 17, 3, 8, p.skin, s)
    rect(ctx, x + 22, 17, 3, 8, p.skin, s)
    // Sleeves
    rect(ctx, x + 7, 17, 3, 2, p.shirt, s)
    rect(ctx, x + 22, 17, 3, 2, p.shirt, s)
    // Arm shading (right side darker)
    px(ctx, x + 9, 20, p.skinSh, s)
    px(ctx, x + 9, 22, p.skinSh, s)
    px(ctx, x + 22, 20, p.skinSh, s)
    px(ctx, x + 22, 22, p.skinSh, s)
    // Hands (fist detail)
    px(ctx, x + 7, 24, p.skinSh, s)
    px(ctx, x + 24, 24, p.skinSh, s)
  }

  // ── Neck ──────────────────────────────────────────────────────────
  rect(ctx, x + 14, 15, 4, 2, p.skin, s)
  px(ctx, x + 17, 15, p.skinSh, s)

  // ── Head with sub-pixel shading ───────────────────────────────────
  // Main head circle
  ctx.fillStyle = p.skin
  ctx.beginPath()
  ctx.arc((x + 16) * s, 10.5 * s, 7.2 * s, 0, Math.PI * 2)
  ctx.fill()
  // Highlight (left side of face)
  ctx.fillStyle = p.skinHi
  ctx.beginPath()
  ctx.arc((x + 14.5) * s, 9.5 * s, 4 * s, 0, Math.PI * 2)
  ctx.fill()
  // Reblend with main skin to soften
  ctx.globalAlpha = 0.5
  ctx.fillStyle = p.skin
  ctx.beginPath()
  ctx.arc((x + 16) * s, 10.5 * s, 7 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  // Jaw shadow (subtle chin shading)
  ctx.fillStyle = p.skinSh
  ctx.beginPath()
  ctx.arc((x + 16) * s, 14 * s, 5 * s, 0, Math.PI, false)
  ctx.fill()
  // Cheekbone blend
  ctx.globalAlpha = 0.3
  ctx.fillStyle = p.skin
  ctx.beginPath()
  ctx.arc((x + 16) * s, 13 * s, 5.5 * s, 0, Math.PI, false)
  ctx.fill()
  ctx.globalAlpha = 1

  // ── Hair with volume & highlights ─────────────────────────────────
  // Base hair mass
  rect(ctx, x + 8, 3, 16, 5, p.hair, s)
  rect(ctx, x + 9, 2, 14, 2, p.hair, s)
  // Side volume
  rect(ctx, x + 8, 7, 2, 3, p.hair, s)
  rect(ctx, x + 22, 7, 2, 3, p.hair, s)
  // Shadow underneath
  rect(ctx, x + 9, 7, 14, 1, p.hairSh, s)
  // Top highlight strands
  px(ctx, x + 11, 2, p.hairHi, s)
  px(ctx, x + 13, 3, p.hairHi, s)
  px(ctx, x + 16, 2, p.hairHi, s)
  px(ctx, x + 19, 3, p.hairHi, s)
  px(ctx, x + 21, 2, p.hairHi, s)
  // Part line
  px(ctx, x + 14, 3, p.hairSh, s)

  // ── Eyebrows (expression-dependent) ───────────────────────────────
  const browColor = darken(p.hair, 0.15)
  if (isError) {
    // Angry V brows
    px(ctx, x + 11, 8, browColor, s); px(ctx, x + 12, 9, browColor, s)
    px(ctx, x + 20, 8, browColor, s); px(ctx, x + 19, 9, browColor, s)
  } else if (isDone) {
    // Raised happy brows
    rect(ctx, x + 11, 8, 3, 1, browColor, s)
    rect(ctx, x + 18, 8, 3, 1, browColor, s)
  } else if (isThinking) {
    // One raised, one flat
    px(ctx, x + 11, 8, browColor, s); px(ctx, x + 12, 8, browColor, s)
    px(ctx, x + 18, 7, browColor, s); px(ctx, x + 19, 7, browColor, s); px(ctx, x + 20, 8, browColor, s)
  } else {
    // Neutral brows
    rect(ctx, x + 11, 9, 3, 1, browColor, s)
    rect(ctx, x + 18, 9, 3, 1, browColor, s)
  }

  // ── Eyes (sclera + iris + pupil + catchlight) ─────────────────────
  if (isError) {
    // X-eyes
    px(ctx, x + 11, 10, '#ef4444', s); px(ctx, x + 13, 12, '#ef4444', s)
    px(ctx, x + 13, 10, '#ef4444', s); px(ctx, x + 11, 12, '#ef4444', s)
    px(ctx, x + 18, 10, '#ef4444', s); px(ctx, x + 20, 12, '#ef4444', s)
    px(ctx, x + 20, 10, '#ef4444', s); px(ctx, x + 18, 12, '#ef4444', s)
  } else if (isBlink) {
    // Closed line
    rect(ctx, x + 11, 11, 3, 1, '#1e1e1e', s)
    rect(ctx, x + 18, 11, 3, 1, '#1e1e1e', s)
  } else if (isDone) {
    // Happy ^ ^ eyes
    px(ctx, x + 11, 11, '#1e1e1e', s); px(ctx, x + 12, 10, '#1e1e1e', s); px(ctx, x + 13, 11, '#1e1e1e', s)
    px(ctx, x + 18, 11, '#1e1e1e', s); px(ctx, x + 19, 10, '#1e1e1e', s); px(ctx, x + 20, 11, '#1e1e1e', s)
  } else {
    // Full detailed eyes
    const eyeY = isThinking ? 9 : 10
    // Left eye: sclera
    rect(ctx, x + 11, eyeY, 3, 3, '#ffffff', s)
    // Left eye: iris
    px(ctx, x + 11, eyeY, p.iris, s); px(ctx, x + 12, eyeY, p.iris, s)
    px(ctx, x + 11, eyeY + 1, p.iris, s); px(ctx, x + 12, eyeY + 1, darken(p.iris, 0.3), s)
    // Left eye: pupil
    px(ctx, x + 12, eyeY, '#0a0a0a', s)
    // Left eye: catchlight
    px(ctx, x + 11, eyeY, '#ffffff', s)
    // Left eye: bottom eyelid hint
    px(ctx, x + 12, eyeY + 2, p.skinSh, s)

    // Right eye: sclera
    rect(ctx, x + 18, eyeY, 3, 3, '#ffffff', s)
    // Right eye: iris
    px(ctx, x + 19, eyeY, p.iris, s); px(ctx, x + 18, eyeY, p.iris, s)
    px(ctx, x + 19, eyeY + 1, p.iris, s); px(ctx, x + 18, eyeY + 1, darken(p.iris, 0.3), s)
    // Right eye: pupil
    px(ctx, x + 18, eyeY, '#0a0a0a', s)
    // Right eye: catchlight
    px(ctx, x + 19, eyeY, '#ffffff', s)
    // Right eye: bottom eyelid hint
    px(ctx, x + 18, eyeY + 2, p.skinSh, s)
  }

  // ── Nose (subtle hint) ────────────────────────────────────────────
  if (!isBlink && !isDone) {
    px(ctx, x + 16, 12, p.skinSh, s)
    px(ctx, x + 15, 13, p.skinSh, s)
  }

  // ── Cheek blush ───────────────────────────────────────────────────
  ctx.globalAlpha = 0.2
  ctx.fillStyle = p.blush
  ctx.beginPath()
  ctx.arc((x + 11) * s, 13 * s, 1.5 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc((x + 21) * s, 13 * s, 1.5 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // ── Mouth ─────────────────────────────────────────────────────────
  if (isDone) {
    // Wide smile
    px(ctx, x + 13, 14, '#1e1e1e', s)
    rect(ctx, x + 14, 15, 4, 1, '#1e1e1e', s)
    px(ctx, x + 18, 14, '#1e1e1e', s)
    // Teeth hint
    rect(ctx, x + 14, 14, 4, 1, '#ffffff', s)
  } else if (isError) {
    // Jagged frown
    px(ctx, x + 13, 14, '#1e1e1e', s)
    rect(ctx, x + 14, 15, 4, 1, '#1e1e1e', s)
    px(ctx, x + 18, 14, '#1e1e1e', s)
  } else if (isThinking) {
    // Small "o" mouth
    px(ctx, x + 15, 14, '#1e1e1e', s)
    px(ctx, x + 16, 14, '#1e1e1e', s)
  } else {
    // Neutral line
    rect(ctx, x + 14, 14, 4, 1, '#1e1e1e', s)
  }

  // ── Accent badge on shirt ─────────────────────────────────────────
  rect(ctx, x + 14, 19, 3, 2, p.accent, s)
  px(ctx, x + 14, 19, p.accentHi, s)

  // ── Outline (anti-aliased — inner edge shadow) ────────────────────
  ctx.globalAlpha = 0.6
  rect(ctx, x + 9, 5, 1, 12, p.outline, s)
  rect(ctx, x + 22, 5, 1, 12, p.outline, s)
  rect(ctx, x + 9, 17, 1, 13, p.outline, s)
  rect(ctx, x + 22, 17, 1, 13, p.outline, s)
  ctx.globalAlpha = 1

  // ── Per-class accessory ───────────────────────────────────────────
  drawAccessory(ctx, x, s, characterClass, p)

  // ── Frame-specific overlays ───────────────────────────────────────
  if (isThinking) {
    // Thought dots (ascending, pulsing purple)
    px(ctx, x + 21, 3, '#a855f7', s)
    px(ctx, x + 23, 1, '#c084fc', s)
    px(ctx, x + 24, 0, '#e9d5ff', s)
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
