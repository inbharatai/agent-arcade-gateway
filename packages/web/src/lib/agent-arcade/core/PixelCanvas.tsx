/**
 * PixelCanvas â€” world-class pixel-art game renderer
 *
 * Rendering pipeline:
 * 1. Background + sky gradient
 * 2. Floor with perspective + ambient occlusion
 * 3. Walls with animated details (monitors, LEDs, radar)
 * 4. Y-sorted scene objects (desks, props, characters)
 * 5. Particles
 * 6. UI overlay (bubbles, names, progress, selection)
 * 7. Post-processing (vignette, bloom glow, scanlines, atmospheric haze)
 *
 * Features:
 * - 60fps render with delta-time (separate sprite anim tick at 200ms)
 * - A* pathfinding with smooth pixel interpolation
 * - Per-object dynamic shadows with perspective
 * - Ambient floating dust motes & light particles
 * - Dynamic glow halos from monitors + accent objects
 * - Animated monitor screens (scrolling fake code, blinking cursor)
 * - Breathing idle animation (subtle scale oscillation)
 * - Screen shake on error/done events
 * - Post-processing: vignette, bloom simulation, atmospheric fog
 * - Y-sorted depth rendering for proper overlap
 * - Hover detection + animated selection ring with glow trail
 * - Spawn pop-in with bounce easing + confetti
 * - Smooth progress bars with animated stripe & sparkle
 * - Enhanced speech bubbles with pixel-perfect borders
 * - Audio integration hooks
 * - Reduced-motion accessibility
 */

'use client'

import React, { useRef, useEffect, useMemo, useCallback } from 'react'
import { Agent, AgentState, STATE_VISUALS } from '../types'
import { getTheme, ThemeDef } from '../themes'
import {
  DESK_POSITIONS, assignDesk, findPath, createMovementState,
  startMovement, tickMovement, MovementState,
} from '../movement'
import { getCharacterSheet, stateToFrame, SPRITE_SIZE, PIXEL_CONFIGS, CHARACTER_CLASSES } from '../sprites'
import { ParticleSystem } from './particles'
import { lerp, easeInOut, easeOutBounce, pulse, clamp01, smoothStep } from './tween'

// â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GRID_W = 16
const GRID_H = 10
const RENDER_MS = 16     // ~60fps render
const ANIM_MS = 200      // sprite frame cycle rate (slightly faster)
const MOVE_SPEED = 3.0   // pixels per render tick

// Ambient mote config
const MAX_MOTES = 40
interface DustMote { x: number; y: number; vx: number; vy: number; size: number; alpha: number; phase: number }

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function normalizeHexColor(color: string): string {
  const trimmed = color.trim()
  if (!trimmed.startsWith('#')) return '#000000'
  const hex = trimmed.slice(1)
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  }
  if (hex.length >= 6) return `#${hex.slice(0, 6)}`
  return '#000000'
}

function contrastTextColor(bg: string): string {
  const hex = normalizeHexColor(bg).slice(1)
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255
  // Perceived luminance; threshold tuned for pixel fonts.
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 0.62 ? '#111827' : '#f8fafc'
}

function getBubbleText(agent: Agent, fallbackLabel: string): string {
  // Priority: task description (what user wants) > latest message > label > state
  if (agent.task && agent.task.trim()) {
    const model = agent.aiModel ? ` [${agent.aiModel}]` : ''
    return `${agent.task}${model}`
  }
  const latestMessage = agent.messages[agent.messages.length - 1]
  if (latestMessage && latestMessage.trim()) {
    const model = agent.aiModel ? ` [${agent.aiModel}]` : ''
    return `${latestMessage}${model}`
  }
  if (agent.label && agent.label.trim()) {
    const model = agent.aiModel ? ` [${agent.aiModel}]` : ''
    return `${agent.label}${model}`
  }
  return agent.aiModel ? `${fallbackLabel} [${agent.aiModel}]` : fallbackLabel
}

function getWanderTarget(state: AgentState, deskPos: { x: number; y: number }): { x: number; y: number } | null {
  switch (state) {
    case 'reading':  return { x: clamp(deskPos.x - 1.5, 1.5, GRID_W - 2), y: deskPos.y }
    case 'thinking': return { x: clamp(deskPos.x + 0.8, 1.5, GRID_W - 2), y: clamp(deskPos.y - 0.8, 1.5, GRID_H - 2) }
    case 'tool':     return { x: clamp(deskPos.x + 1.5, 1.5, GRID_W - 2), y: clamp(deskPos.y + 0.5, 1.5, GRID_H - 2) }
    case 'moving':   return { x: clamp(deskPos.x + 2, 1.5, GRID_W - 2), y: deskPos.y }
    default: return null
  }
}

// â”€â”€ Callback interface for audio events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface CanvasAudioCallbacks {
  onSpawn?: (agentId: string) => void
  onStateChange?: (agentId: string, newState: AgentState) => void
  onDone?: (agentId: string) => void
  onError?: (agentId: string) => void
  onSelect?: (agentId: string | null) => void
}

interface CanvasProps {
  agents: Agent[]
  selectedAgentId?: string | null
  onSelectAgent?: (id: string | null) => void
  theme?: string
  pixelLevel?: string
  zoom?: number
  reducedMotion?: boolean
  width?: number
  height?: number
  audioCallbacks?: CanvasAudioCallbacks
}

export function PixelCanvas({
  agents,
  selectedAgentId,
  onSelectAgent,
  theme: themeId = 'office',
  pixelLevel = '16bit',
  zoom = 1,
  reducedMotion = false,
  width: propWidth,
  height: propHeight,
  audioCallbacks,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const tickRef = useRef(0)
  const animTickRef = useRef(0)
  const lastRenderRef = useRef(0)
  const lastAnimRef = useRef(0)
  const hoveredRef = useRef<string | null>(null)
  const timeRef = useRef(0)  // global seconds elapsed

  const moveStatesRef = useRef<Map<string, MovementState>>(new Map())
  const prevStatesRef = useRef<Map<string, AgentState>>(new Map())
  const spawnAnimRef = useRef<Map<string, number>>(new Map())
  const knownAgentsRef = useRef<Set<string>>(new Set())
  const smoothProgressRef = useRef<Map<string, number>>(new Map())
  const particlesRef = useRef<ParticleSystem>(new ParticleSystem())

  // Screen shake
  const shakeRef = useRef<{ intensity: number; decay: number }>({ intensity: 0, decay: 0 })

  // Ambient dust motes
  const motesRef = useRef<DustMote[]>([])

  const theme = useMemo(() => getTheme(themeId), [themeId])
  const pxConf = useMemo(() => PIXEL_CONFIGS[pixelLevel] || PIXEL_CONFIGS['16bit'], [pixelLevel])
  const tileSize = pxConf.tileSize

  const canvasW = propWidth || GRID_W * tileSize
  const canvasH = propHeight || GRID_H * tileSize

  // Initialize ambient motes
  useEffect(() => {
    if (motesRef.current.length === 0) {
      for (let i = 0; i < MAX_MOTES; i++) {
        motesRef.current.push({
          x: Math.random() * canvasW / zoom,
          y: Math.random() * canvasH / zoom,
          vx: (Math.random() - 0.5) * 0.3,
          vy: -0.1 - Math.random() * 0.2,
          size: 0.5 + Math.random() * 1.5,
          alpha: 0.1 + Math.random() * 0.25,
          phase: Math.random() * Math.PI * 2,
        })
      }
    }
  }, [canvasW, canvasH, zoom])

  const chars = useMemo(() => {
    return agents.map((agent, i) => {
      const desk = agent.position || assignDesk(i)
      return {
        agent,
        index: i,
        gridX: desk.x,
        gridY: desk.y,
        deskX: assignDesk(i).x,
        deskY: assignDesk(i).y,
        charClass: agent.characterClass || CHARACTER_CLASSES[i % CHARACTER_CLASSES.length],
      }
    })
  }, [agents])

  // â”€â”€ Detect state changes, spawns, and drive movement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const moveStates = moveStatesRef.current
    const prevStates = prevStatesRef.current
    const spawnAnims = spawnAnimRef.current
    const known = knownAgentsRef.current
    const particles = particlesRef.current

    for (const c of chars) {
      const id = c.agent.id
      const desk = { x: c.deskX, y: c.deskY }

      if (!moveStates.has(id)) {
        const ms = createMovementState(desk, tileSize)
        ms.speed = MOVE_SPEED
        moveStates.set(id, ms)
      }

      if (!known.has(id)) {
        known.add(id)
        spawnAnims.set(id, 0)
        const px = desk.x * tileSize + tileSize * 0.75
        const py = desk.y * tileSize - tileSize * 0.3
        particles.emit('spawn', px, py, tileSize)
        audioCallbacks?.onSpawn?.(id)
        // Screen shake on spawn
        shakeRef.current = { intensity: 3, decay: 0.92 }
      }

      const prevState = prevStates.get(id)
      if (prevState !== c.agent.state) {
        prevStates.set(id, c.agent.state)

        if (prevState !== undefined) {
          audioCallbacks?.onStateChange?.(id, c.agent.state)
          if (c.agent.state === 'done') {
            audioCallbacks?.onDone?.(id)
            shakeRef.current = { intensity: 4, decay: 0.9 }
          } else if (c.agent.state === 'error') {
            audioCallbacks?.onError?.(id)
            shakeRef.current = { intensity: 6, decay: 0.88 }
          }
        }

        const ms = moveStates.get(id)!
        const target = getWanderTarget(c.agent.state, desk)
        if (target) {
          const fromGrid = { x: Math.round(ms.pixelX / tileSize), y: Math.round(ms.pixelY / tileSize) }
          const toGrid = { x: Math.round(target.x), y: Math.round(target.y) }
          const path = findPath(fromGrid, toGrid)
          startMovement(ms, path, tileSize)
        } else if (ms.moving) {
          const fromGrid = { x: Math.round(ms.pixelX / tileSize), y: Math.round(ms.pixelY / tileSize) }
          const path = findPath(fromGrid, desk)
          startMovement(ms, path, tileSize)
        }
      }
    }

    const currentIds = new Set(chars.map(c => c.agent.id))
    for (const id of known) {
      if (!currentIds.has(id)) {
        known.delete(id); moveStates.delete(id); prevStates.delete(id)
        spawnAnims.delete(id); smoothProgressRef.current.delete(id)
      }
    }
  }, [chars, tileSize, audioCallbacks])

  // â”€â”€ Main render loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Initialise timing refs on mount (avoids Date.now() during render)
    const initNow = Date.now()
    if (lastRenderRef.current === 0) lastRenderRef.current = initNow
    if (lastAnimRef.current === 0) lastAnimRef.current = initNow

    const particles = particlesRef.current

    const render = () => {
      const now = Date.now()
      const dtRender = now - lastRenderRef.current
      const dtSec = dtRender / 1000

      if (dtRender >= RENDER_MS) {
        tickRef.current++
        lastRenderRef.current = now
        timeRef.current += dtSec

        if (!reducedMotion) {
          for (const ms of moveStatesRef.current.values()) tickMovement(ms, tileSize)
          // Decay screen shake
          const shake = shakeRef.current
          shake.intensity *= shake.decay
          if (shake.intensity < 0.1) shake.intensity = 0
        }

        for (const [id, progress] of spawnAnimRef.current) {
          if (progress < 1) spawnAnimRef.current.set(id, Math.min(1, progress + 0.04))
        }
      }

      // Sprite anim tick
      if (now - lastAnimRef.current >= ANIM_MS) {
        animTickRef.current++
        lastAnimRef.current = now

        if (!reducedMotion) {
          for (const c of chars) {
            const ms = moveStatesRef.current.get(c.agent.id)
            const px = ms ? ms.pixelX + tileSize * 0.75 : c.gridX * tileSize + tileSize * 0.75
            const py = ms ? ms.pixelY - tileSize * 0.3 : c.gridY * tileSize - tileSize * 0.3
            if (c.agent.state === 'thinking') particles.emit('thinking', px, py, tileSize)
            else if (c.agent.state === 'writing') particles.emit('writing', px, py, tileSize)
            else if (c.agent.state === 'tool') particles.emit('tool', px, py, tileSize)
          }
        }
      }

      const tick = reducedMotion ? 0 : tickRef.current
      const animTick = reducedMotion ? 0 : animTickRef.current
      const gTime = timeRef.current

      if (!reducedMotion) particles.tick(dtSec)

      // Advance ambient motes
      if (!reducedMotion) {
        const wLimit = canvasW / zoom
        const hLimit = canvasH / zoom
        for (const m of motesRef.current) {
          m.x += m.vx + Math.sin(gTime * 0.5 + m.phase) * 0.15
          m.y += m.vy
          if (m.y < -5) { m.y = hLimit + 5; m.x = Math.random() * wLimit }
          if (m.x < -5) m.x = wLimit + 5
          if (m.x > wLimit + 5) m.x = -5
        }
      }

      ctx.imageSmoothingEnabled = pxConf.smoothing
      ctx.save()

      // â”€â”€ Screen shake â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const shakeX = reducedMotion ? 0 : (Math.random() - 0.5) * shakeRef.current.intensity * 2
      const shakeY = reducedMotion ? 0 : (Math.random() - 0.5) * shakeRef.current.intensity * 2
      ctx.translate(shakeX, shakeY)
      ctx.scale(zoom, zoom)

      const w = canvasW / zoom
      const h = canvasH / zoom

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // LAYER 1: Floor
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      drawFloor(ctx, theme, tileSize, w, h, gTime)

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // LAYER 2: Walls
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      drawWalls(ctx, theme, tileSize, w, h, tick, gTime)

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // LAYER 3: Ambient glow halos (beneath everything)
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      if (!reducedMotion) drawAmbientGlow(ctx, theme, tileSize, w, h, gTime)

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // LAYER 4: Props (background layer)
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      drawProps(ctx, theme, tileSize, gTime, tick)

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // LAYER 5: Y-sorted desks + characters
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // Collect all drawables with Y positions for sorting
      type Drawable = { y: number; draw: () => void }
      const drawables: Drawable[] = []

      // Desks
      for (let i = 0; i < DESK_POSITIONS.length; i++) {
        const pos = DESK_POSITIONS[i]
        const dy = pos.y * tileSize
        const agentState = agents[i]?.state
        drawables.push({
          y: dy + tileSize,
          draw: () => drawDesk(ctx, pos.x * tileSize, dy, tileSize, theme, agentState, gTime),
        })
      }

      // Characters
      for (const c of chars) {
        const ms = moveStatesRef.current.get(c.agent.id)
        const spawnProg = spawnAnimRef.current.get(c.agent.id) ?? 1
        let drawX: number, drawY: number
        if (ms) { drawX = ms.pixelX + tileSize * 0.75; drawY = ms.pixelY - tileSize * 0.3 }
        else { drawX = c.gridX * tileSize + tileSize * 0.75; drawY = c.gridY * tileSize - tileSize * 0.3 }

        drawables.push({
          y: drawY + tileSize * 0.8,
          draw: () => {
            const sheet = getCharacterSheet(c.charClass, pixelLevel)
            const frame = stateToFrame(c.agent.state, animTick)
            const sw = SPRITE_SIZE * pxConf.scale
            const sh = SPRITE_SIZE * pxConf.scale

            // Spawn animation with bounce easing
            const spawnT = spawnProg < 1 ? easeOutBounce(clamp01(spawnProg)) : 1
            const charScale = tileSize * 0.8 * spawnT
            const spawnAlpha = clamp01(spawnProg * 2.5)

            ctx.globalAlpha = spawnAlpha

            // Character shadow (perspective ellipse)
            ctx.fillStyle = theme.colors.shadow
            ctx.beginPath()
            ctx.ellipse(drawX, drawY + tileSize * 0.82, tileSize * 0.38 * spawnT, tileSize * 0.1, 0, 0, Math.PI * 2)
            ctx.fill()

            // Breathing animation (idle subtle scale oscillation)
            const isIdle = c.agent.state === 'idle' || c.agent.state === 'waiting'
            const breathScale = isIdle && !reducedMotion ? 1 + Math.sin(gTime * 2.5 + c.index * 1.3) * 0.012 : 1
            const bobOff = (c.agent.state !== 'idle' && !reducedMotion) ? Math.sin(tick * 0.3) * 2 : 0
            const finalScale = charScale * breathScale

            // Flip sprite based on facing direction
            const facingLeft = ms?.facing === 'left'
            if (facingLeft) {
              ctx.save()
              ctx.translate(drawX, 0)
              ctx.scale(-1, 1)
              ctx.drawImage(
                sheet,
                frame * SPRITE_SIZE * pxConf.scale, 0, sw, sh,
                -finalScale / 2, drawY - finalScale / 2 + bobOff,
                finalScale, finalScale,
              )
              ctx.restore()
            } else {
              ctx.drawImage(
                sheet,
                frame * SPRITE_SIZE * pxConf.scale, 0, sw, sh,
                drawX - finalScale / 2, drawY - finalScale / 2 + bobOff,
                finalScale, finalScale,
              )
            }

            ctx.globalAlpha = 1

            // Trust halo — colored ring around character feet based on trust score
            const trust = c.agent.trustScore ?? 0.5
            if (!reducedMotion || trust < 0.5) {
              const trustHaloR = tileSize * 0.42
              const trustHaloColor = trust >= 0.8 ? '#10b981' : trust >= 0.5 ? '#f59e0b' : '#ef4444'
              const trustHaloAlpha = 0.15 + trust * 0.35
              ctx.globalAlpha = trustHaloAlpha
              ctx.strokeStyle = trustHaloColor
              ctx.lineWidth = 1.5
              ctx.beginPath()
              ctx.ellipse(drawX, drawY + tileSize * 0.78, trustHaloR, trustHaloR * 0.28, 0, 0, Math.PI * 2 * trust)
              ctx.stroke()
              // Error pulse ring
              if (c.agent.errorCount > 0 && !reducedMotion) {
                const errPulse = 0.3 + Math.abs(Math.sin(gTime * 3)) * 0.4
                ctx.globalAlpha = errPulse
                ctx.strokeStyle = '#ef4444'
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.ellipse(drawX, drawY + tileSize * 0.78, trustHaloR + 2, trustHaloR * 0.28 + 1, 0, 0, Math.PI * 2)
                ctx.stroke()
              }
              ctx.globalAlpha = 1
            }

            // Name tag with rounded badge style
            const isSelected = selectedAgentId === c.agent.id
            const isHovered = hoveredRef.current === c.agent.id
            const tagW = tileSize * 0.95
            const tagH = tileSize * 0.22
            const tagX = drawX - tagW / 2
            const tagY = drawY - tileSize * 0.72

            ctx.fillStyle = isSelected ? theme.colors.accent : isHovered ? theme.colors.accent + '90' : theme.colors.bubble + 'e0'
            ctx.beginPath()
            ctx.roundRect(tagX, tagY, tagW, tagH, 3)
            ctx.fill()
            ctx.strokeStyle = isSelected ? theme.colors.accent : theme.colors.bubbleBorder + '80'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.roundRect(tagX, tagY, tagW, tagH, 3)
            ctx.stroke()

            const tagBg = isSelected || isHovered ? theme.colors.accent : theme.colors.bubble
            ctx.fillStyle = contrastTextColor(tagBg)
            ctx.font = `bold ${Math.max(9, tileSize * 0.18)}px monospace`
            ctx.textAlign = 'center'
            const nameLabel = c.agent.aiModel
              ? `${c.agent.name.slice(0, 7)}·${c.agent.aiModel.slice(0, 6)}`
              : c.agent.name.slice(0, 10)
            ctx.fillText(nameLabel, drawX, tagY + tagH * 0.78)

            // State icon
            const vis = STATE_VISUALS[c.agent.state]
            ctx.font = `${tileSize * 0.26}px sans-serif`
            ctx.fillText(vis.icon, drawX + tileSize * 0.48, drawY - tileSize * 0.28)

            // Selection ring â€” double ring with glow
            if (isSelected) {
              const pt = pulse((tick * 0.035) % 1)
              const r1 = tileSize * (0.46 + pt * 0.06)
              const r2 = tileSize * (0.52 + pt * 0.06)

              // Outer glow
              ctx.shadowColor = theme.colors.accent
              ctx.shadowBlur = 8
              ctx.strokeStyle = theme.colors.accent + '60'
              ctx.lineWidth = 3
              ctx.setLineDash([])
              ctx.beginPath()
              ctx.ellipse(drawX, drawY + tileSize * 0.2, r2, r2, 0, 0, Math.PI * 2)
              ctx.stroke()
              ctx.shadowBlur = 0

              // Inner marching ants
              ctx.strokeStyle = theme.colors.accent
              ctx.lineWidth = 1.5
              ctx.setLineDash([5, 3])
              ctx.lineDashOffset = tick * 0.6
              ctx.beginPath()
              ctx.ellipse(drawX, drawY + tileSize * 0.2, r1, r1, 0, 0, Math.PI * 2)
              ctx.stroke()
              ctx.setLineDash([])
              ctx.lineDashOffset = 0
            }

            // Hover glow ring
            if (isHovered && !isSelected) {
              ctx.strokeStyle = theme.colors.accent + '40'
              ctx.lineWidth = 2
              ctx.shadowColor = theme.colors.accent
              ctx.shadowBlur = 5
              ctx.beginPath()
              ctx.ellipse(drawX, drawY + tileSize * 0.2, tileSize * 0.48, tileSize * 0.48, 0, 0, Math.PI * 2)
              ctx.stroke()
              ctx.shadowBlur = 0
            }

            // Speech bubble
            const showBubble =
              c.agent.state !== 'idle' ||
              (c.agent.messages.length > 0 && now - c.agent.lastUpdate < 9000) ||
              isSelected
            if (showBubble) {
              const bubbleText = getBubbleText(c.agent, vis.label).slice(0, 48)
              const isThought = c.agent.state === 'thinking'
              drawBubble(ctx, drawX, drawY - tileSize * 0.88, bubbleText, theme, tileSize, isThought, tick)
            }

            // Progress bar â€” animated stripe + sparkle
            const targetProgress = c.agent.progress
            const currentSmooth = smoothProgressRef.current.get(c.agent.id) ?? targetProgress
            const newSmooth = lerp(currentSmooth, targetProgress, 0.08)
            smoothProgressRef.current.set(c.agent.id, newSmooth)

            if (newSmooth > 0.01 && newSmooth < 0.995) {
              const bw = tileSize * 0.72
              const bh = 6
              const bx = drawX - bw / 2
              const by = drawY + tileSize * 0.92
              // Background track
              ctx.fillStyle = theme.colors.wall + '80'
              ctx.beginPath()
              ctx.roundRect(bx, by, bw, bh, 3)
              ctx.fill()
              // Fill with glow
              const fillW = bw * newSmooth
              ctx.shadowColor = vis.color
              ctx.shadowBlur = 6
              ctx.fillStyle = vis.color
              ctx.beginPath()
              ctx.roundRect(bx, by, fillW, bh, 3)
              ctx.fill()
              // Animated diagonal stripes
              if (!reducedMotion) {
                ctx.save()
                ctx.beginPath()
                ctx.roundRect(bx, by, fillW, bh, 3)
                ctx.clip()
                ctx.globalAlpha = 0.15
                ctx.fillStyle = '#ffffff'
                const stripeW = 4
                for (let sx = -bh + (tick * 0.5 % (stripeW * 2)); sx < fillW; sx += stripeW * 2) {
                  ctx.beginPath()
                  ctx.moveTo(bx + sx, by + bh)
                  ctx.lineTo(bx + sx + bh, by)
                  ctx.lineTo(bx + sx + bh + stripeW, by)
                  ctx.lineTo(bx + sx + stripeW, by + bh)
                  ctx.fill()
                }
                ctx.restore()
              }
              ctx.shadowBlur = 0
              // Sparkle at progress tip
              if (!reducedMotion && newSmooth > 0.05) {
                const sparkleAlpha = 0.5 + Math.sin(gTime * 8) * 0.5
                ctx.globalAlpha = sparkleAlpha
                ctx.fillStyle = '#ffffff'
                ctx.beginPath()
                ctx.arc(bx + fillW - 1, by + bh / 2, 2.5, 0, Math.PI * 2)
                ctx.fill()
                ctx.globalAlpha = 1
              }
              // Percentage text
              ctx.fillStyle = theme.colors.text
              ctx.font = `bold ${Math.max(7, tileSize * 0.12)}px monospace`
              ctx.textAlign = 'center'
              ctx.fillText(`${Math.round(newSmooth * 100)}%`, drawX, by + bh + tileSize * 0.13)
            }

            // Done/error periodic particles
            if (c.agent.state === 'done' && spawnProg >= 1 && animTick % 6 === 0) {
              particles.emit('done', drawX, drawY, tileSize)
            }
            if (c.agent.state === 'error' && spawnProg >= 1 && animTick % 5 === 0) {
              particles.emit('error', drawX, drawY, tileSize)
            }
          },
        })
      }

      // Y-sort and draw
      drawables.sort((a, b) => a.y - b.y)
      for (const d of drawables) d.draw()

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // LAYER 6: Relationship lines
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      for (const c of chars) {
        if (!c.agent.parentAgentId) continue
        const parent = chars.find(p => p.agent.id === c.agent.parentAgentId)
        if (!parent) continue
        const msChild = moveStatesRef.current.get(c.agent.id)
        const msParent = moveStatesRef.current.get(parent.agent.id)
        const cx1 = msChild ? msChild.pixelX + tileSize * 0.75 : c.gridX * tileSize + tileSize * 0.75
        const cy1 = msChild ? msChild.pixelY : c.gridY * tileSize
        const px1 = msParent ? msParent.pixelX + tileSize * 0.75 : parent.gridX * tileSize + tileSize * 0.75
        const py1 = msParent ? msParent.pixelY : parent.gridY * tileSize

        // Gradient line
        const grad = ctx.createLinearGradient(px1, py1, cx1, cy1)
        grad.addColorStop(0, theme.colors.accent + '60')
        grad.addColorStop(1, theme.colors.accent + '20')
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.lineDashOffset = tick * 0.4
        ctx.beginPath()
        ctx.moveTo(px1, py1)
        ctx.lineTo(cx1, cy1)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineDashOffset = 0
      }

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // LAYER 7: Particles
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      if (!reducedMotion) particles.render(ctx)

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // LAYER 8: Ambient dust motes
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      if (!reducedMotion) {
        for (const m of motesRef.current) {
          ctx.globalAlpha = m.alpha * (0.5 + Math.sin(gTime + m.phase) * 0.5)
          ctx.fillStyle = theme.colors.wallHighlight
          ctx.beginPath()
          ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      // LAYER 9: Post-processing â€” Vignette + CRT + atmospheric haze
      // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
      if (!reducedMotion) {
        // Vignette: radial gradient darkening edges
        const vigGrad = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.75)
        vigGrad.addColorStop(0, 'rgba(0,0,0,0)')
        vigGrad.addColorStop(1, `rgba(0,0,0,${pxConf.crt ? 0.4 : 0.25})`)
        ctx.fillStyle = vigGrad
        ctx.fillRect(0, 0, w, h)

        // Scanlines (enhanced for CRT mode)
        if (pxConf.scanlines) {
          ctx.globalAlpha = 0.12
          ctx.fillStyle = '#000000'
          for (let sy = 0; sy < h; sy += 2) {
            ctx.fillRect(0, sy, w, 1)
          }
          ctx.globalAlpha = 1
        } else {
          // Subtle default scanlines
          ctx.globalAlpha = 0.03
          ctx.fillStyle = '#000000'
          for (let sy = 0; sy < h; sy += 3) {
            ctx.fillRect(0, sy, w, 1)
          }
          ctx.globalAlpha = 1
        }

        // CRT effects (Ultra Retro mode)
        if (pxConf.crt) {
          // RGB fringing (chromatic aberration) â€” colored edge strips
          ctx.globalAlpha = 0.03
          ctx.fillStyle = '#ff0000'
          ctx.fillRect(1, 0, 2, h) // left red fringe
          ctx.fillStyle = '#0000ff'
          ctx.fillRect(w - 3, 0, 2, h) // right blue fringe
          ctx.globalAlpha = 1

          // Screen flicker
          const flicker = Math.sin(gTime * 60) > 0.97 ? 0.06 : 0
          if (flicker > 0) {
            ctx.globalAlpha = flicker
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, w, h)
            ctx.globalAlpha = 1
          }

          // CRT curvature â€” darkened corners for barrel distortion illusion
          ctx.globalAlpha = 0.15
          ctx.fillStyle = '#000000'
          // Top-left corner
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.lineTo(w * 0.08, 0)
          ctx.quadraticCurveTo(0, 0, 0, h * 0.08)
          ctx.fill()
          // Top-right corner
          ctx.beginPath()
          ctx.moveTo(w, 0)
          ctx.lineTo(w - w * 0.08, 0)
          ctx.quadraticCurveTo(w, 0, w, h * 0.08)
          ctx.fill()
          // Bottom-left corner
          ctx.beginPath()
          ctx.moveTo(0, h)
          ctx.lineTo(w * 0.08, h)
          ctx.quadraticCurveTo(0, h, 0, h - h * 0.08)
          ctx.fill()
          // Bottom-right corner
          ctx.beginPath()
          ctx.moveTo(w, h)
          ctx.lineTo(w - w * 0.08, h)
          ctx.quadraticCurveTo(w, h, w, h - h * 0.08)
          ctx.fill()
          ctx.globalAlpha = 1

          // Phosphor glow â€” ambient tint overlay
          ctx.globalAlpha = 0.02
          ctx.fillStyle = theme.colors.accent
          ctx.fillRect(0, 0, w, h)
          ctx.globalAlpha = 1
        }

        // Ambient tint overlay (per-theme atmosphere)
        if (theme.ambientTint) {
          ctx.globalAlpha = 0.03
          ctx.fillStyle = theme.ambientTint
          ctx.fillRect(0, 0, w, h)
          ctx.globalAlpha = 1
        }
      }

      // â”€â”€ Empty state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (agents.length === 0) {
        ctx.fillStyle = theme.colors.text + '88'
        ctx.font = `bold ${tileSize * 0.45}px monospace`
        ctx.textAlign = 'center'
        ctx.fillText('ðŸŽ® Waiting for agentsâ€¦', w / 2, h / 2 - 20)
        ctx.font = `${tileSize * 0.25}px monospace`
        ctx.fillText('Connect an agent SDK to get started', w / 2, h / 2 + 15)
      }

      ctx.restore()
      animRef.current = requestAnimationFrame(render)
    }

    animRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animRef.current)
  }, [agents, chars, selectedAgentId, theme, pxConf, pixelLevel, zoom, reducedMotion, canvasW, canvasH, tileSize])

  // â”€â”€ Mouse move for hover â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    const mx = (e.clientX - rect.left) * sx / zoom
    const my = (e.clientY - rect.top) * sy / zoom

    let found: string | null = null
    for (const c of chars) {
      const ms = moveStatesRef.current.get(c.agent.id)
      const cx = ms ? ms.pixelX + tileSize * 0.75 : c.gridX * tileSize + tileSize * 0.75
      const cy = ms ? ms.pixelY - tileSize * 0.3 : c.gridY * tileSize - tileSize * 0.3
      if (mx >= cx - tileSize * 0.5 && mx <= cx + tileSize * 0.5 &&
          my >= cy - tileSize * 0.7 && my <= cy + tileSize) {
        found = c.agent.id
        break
      }
    }
    hoveredRef.current = found
    if (canvas) canvas.style.cursor = found ? 'pointer' : 'default'
  }, [chars, tileSize, zoom])

  // â”€â”€ Click handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !onSelectAgent) return
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    const mx = (e.clientX - rect.left) * sx / zoom
    const my = (e.clientY - rect.top) * sy / zoom

    for (const c of chars) {
      const ms = moveStatesRef.current.get(c.agent.id)
      const cx = ms ? ms.pixelX + tileSize * 0.75 : c.gridX * tileSize + tileSize * 0.75
      const cy = ms ? ms.pixelY - tileSize * 0.3 : c.gridY * tileSize - tileSize * 0.3
      if (mx >= cx - tileSize * 0.5 && mx <= cx + tileSize * 0.5 &&
          my >= cy - tileSize * 0.7 && my <= cy + tileSize) {
        const newId = selectedAgentId === c.agent.id ? null : c.agent.id
        onSelectAgent(newId)
        audioCallbacks?.onSelect?.(newId)
        return
      }
    }
    onSelectAgent(null)
    audioCallbacks?.onSelect?.(null)
  }, [chars, tileSize, zoom, selectedAgentId, onSelectAgent, audioCallbacks])

  return (
    <canvas
      ref={canvasRef}
      width={canvasW}
      height={canvasH}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      className="rounded-lg border border-border cursor-pointer w-full"
      style={{ imageRendering: pxConf.smoothing ? 'auto' : 'pixelated', maxWidth: '100%' }}
    />
  )
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DRAWING PRIMITIVES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function drawFloor(ctx: CanvasRenderingContext2D, theme: ThemeDef, ts: number, w: number, h: number, gTime: number) {
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const isAlt = (x + y) % 2 === 1
      ctx.fillStyle = isAlt ? theme.colors.floorAlt : theme.colors.floor
      ctx.fillRect(x * ts, y * ts, ts, ts)

      if (theme.floorPattern === 'wood') {
        ctx.fillStyle = theme.colors.floorAlt + '35'
        for (let i = 0; i < 4; i++) {
          const gy = y * ts + ts * (0.15 + i * 0.22)
          ctx.fillRect(x * ts, gy, ts, 1)
        }
        // Wood knot
        if ((x * 7 + y * 3) % 11 === 0) {
          ctx.fillStyle = theme.colors.floorAlt + '20'
          ctx.beginPath()
          ctx.arc(x * ts + ts * 0.6, y * ts + ts * 0.5, ts * 0.08, 0, Math.PI * 2)
          ctx.fill()
        }
      } else if (theme.floorPattern === 'grid') {
        ctx.strokeStyle = theme.colors.floorAlt + '25'
        ctx.lineWidth = 0.5
        ctx.strokeRect(x * ts, y * ts, ts, ts)
        // Cross marks at intersections
        if ((x + y) % 3 === 0) {
          ctx.strokeStyle = theme.colors.accent + '10'
          ctx.beginPath()
          ctx.moveTo(x * ts + ts * 0.4, y * ts + ts * 0.5)
          ctx.lineTo(x * ts + ts * 0.6, y * ts + ts * 0.5)
          ctx.stroke()
        }
      } else if (theme.floorPattern === 'metal') {
        ctx.fillStyle = theme.colors.floorAlt + '20'
        const nx = x * ts; const ny = y * ts
        ctx.fillRect(nx + ts * 0.08, ny + ts * 0.08, ts * 0.04, ts * 0.04)
        ctx.fillRect(nx + ts * 0.88, ny + ts * 0.88, ts * 0.04, ts * 0.04)
        ctx.fillRect(nx + ts * 0.08, ny + ts * 0.88, ts * 0.04, ts * 0.04)
        ctx.fillRect(nx + ts * 0.88, ny + ts * 0.08, ts * 0.04, ts * 0.04)
        // Diamond plate pattern
        if (isAlt) {
          ctx.fillStyle = theme.colors.floorAlt + '08'
          ctx.beginPath()
          ctx.moveTo(nx + ts * 0.5, ny + ts * 0.2)
          ctx.lineTo(nx + ts * 0.8, ny + ts * 0.5)
          ctx.lineTo(nx + ts * 0.5, ny + ts * 0.8)
          ctx.lineTo(nx + ts * 0.2, ny + ts * 0.5)
          ctx.fill()
        }
      } else if (theme.floorPattern === 'grass') {
        ctx.fillStyle = theme.colors.floorAlt + '40'
        for (let i = 0; i < 5; i++) {
          const gx = x * ts + ((x * 7 + i * 13) % ts)
          const gy = y * ts + ((y * 11 + i * 17) % ts)
          ctx.fillRect(gx, gy, 1.5, 3 + Math.sin(gTime + x + i) * 1)
        }
        // Occasional flower
        if ((x * 3 + y * 7) % 19 === 0) {
          ctx.fillStyle = ['#fbbf24', '#f472b6', '#a78bfa'][(x + y) % 3]
          ctx.beginPath()
          ctx.arc(x * ts + ts * 0.3, y * ts + ts * 0.6, ts * 0.04, 0, Math.PI * 2)
          ctx.fill()
        }
      } else if (theme.floorPattern === 'stars') {
        // Deep space starfield floor â€” twinkling stars on dark void
        const seed = (x * 31 + y * 17) % 97
        // Distant stars
        if (seed < 30) {
          const twinkle = 0.3 + Math.sin(gTime * 2 + seed) * 0.3
          ctx.globalAlpha = twinkle
          ctx.fillStyle = '#ffffff'
          const sx = x * ts + (seed * 3.7) % ts
          const sy = y * ts + (seed * 7.1) % ts
          ctx.beginPath()
          ctx.arc(sx, sy, 0.5 + (seed % 3) * 0.3, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }
        // Nebula wisps
        if ((x + y * 5) % 23 === 0) {
          ctx.globalAlpha = 0.04
          ctx.fillStyle = theme.colors.accent
          ctx.beginPath()
          ctx.arc(x * ts + ts * 0.5, y * ts + ts * 0.5, ts * 0.4, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }
      } else if (theme.floorPattern === 'stone') {
        // Dungeon flagstone floor â€” cracked stone slabs with moss
        ctx.strokeStyle = '#00000018'
        ctx.lineWidth = 1.5
        ctx.strokeRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2)
        // Cracks
        if ((x * 13 + y * 7) % 9 < 3) {
          ctx.strokeStyle = '#00000015'
          ctx.lineWidth = 0.5
          ctx.beginPath()
          ctx.moveTo(x * ts + ts * 0.2, y * ts + ts * 0.3)
          ctx.lineTo(x * ts + ts * 0.6, y * ts + ts * 0.7)
          ctx.stroke()
        }
        // Moss patches
        if ((x * 3 + y * 11) % 17 === 0) {
          ctx.fillStyle = '#22c55e18'
          ctx.beginPath()
          ctx.arc(x * ts + ts * 0.7, y * ts + ts * 0.8, ts * 0.1, 0, Math.PI * 2)
          ctx.fill()
        }
      } else if (theme.floorPattern === 'circuit') {
        // PCB circuit board pattern with flowing data traces
        ctx.strokeStyle = theme.colors.accent + '18'
        ctx.lineWidth = 0.8
        // Horizontal trace
        if (y % 2 === 0) {
          ctx.beginPath()
          ctx.moveTo(x * ts, y * ts + ts * 0.5)
          ctx.lineTo(x * ts + ts, y * ts + ts * 0.5)
          ctx.stroke()
        }
        // Vertical trace
        if (x % 3 === 0) {
          ctx.beginPath()
          ctx.moveTo(x * ts + ts * 0.5, y * ts)
          ctx.lineTo(x * ts + ts * 0.5, y * ts + ts)
          ctx.stroke()
        }
        // Solder pads
        if ((x + y) % 4 === 0) {
          ctx.fillStyle = theme.colors.accent + '25'
          ctx.beginPath()
          ctx.arc(x * ts + ts * 0.5, y * ts + ts * 0.5, ts * 0.06, 0, Math.PI * 2)
          ctx.fill()
        }
        // Flowing data pulse
        const pulseX = ((gTime * 30 + y * 20) % (GRID_W * ts))
        if (Math.abs(pulseX - x * ts) < ts) {
          ctx.fillStyle = theme.colors.accent + '30'
          ctx.fillRect(x * ts, y * ts + ts * 0.45, ts * 0.15, ts * 0.1)
        }
      }
    }
  }

  // â”€â”€ Ambient occlusion at walls (subtle shadow gradient) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const aoSize = ts * 0.5
  const aoTop = ctx.createLinearGradient(0, 0, 0, aoSize)
  aoTop.addColorStop(0, 'rgba(0,0,0,0.12)')
  aoTop.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = aoTop
  ctx.fillRect(0, ts * 0.4, w, aoSize)

  const aoLeft = ctx.createLinearGradient(0, 0, aoSize, 0)
  aoLeft.addColorStop(0, 'rgba(0,0,0,0.08)')
  aoLeft.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = aoLeft
  ctx.fillRect(0, 0, aoSize, h)
}

function drawWalls(ctx: CanvasRenderingContext2D, theme: ThemeDef, ts: number, w: number, h: number, tick: number, gTime: number) {
  const wh = ts * 0.4
  ctx.fillStyle = theme.colors.wall
  ctx.fillRect(0, 0, w, wh)
  ctx.fillRect(0, h - wh, w, wh)
  ctx.fillRect(0, 0, wh, h)
  ctx.fillRect(w - wh, 0, wh, h)

  // Top wall highlight edge
  ctx.fillStyle = theme.colors.wallHighlight
  ctx.fillRect(0, 0, w, 2)
  ctx.fillRect(0, wh - 2, w, 2)

  if (theme.wallStyle === 'neon') {
    // Animated neon strips with pulsing glow
    const neonPulse = 0.4 + Math.sin(gTime * 3) * 0.2
    ctx.shadowColor = theme.colors.accent
    ctx.shadowBlur = 12
    ctx.fillStyle = theme.colors.accent + Math.round(neonPulse * 255).toString(16).padStart(2, '0')
    ctx.fillRect(ts * 2, 4, ts * 3, 3)
    ctx.fillRect(ts * 7, 4, ts * 4, 3)
    ctx.fillRect(ts * 12, 4, ts * 2, 3)
    // Vertical neon accents
    ctx.fillRect(ts * 0.5, ts * 1, 3, ts * 3)
    ctx.fillRect(w - ts * 0.5 - 3, ts * 1, 3, ts * 3)
    ctx.shadowBlur = 0
    // "GAME ON" neon text
    ctx.shadowColor = '#f472b6'
    ctx.shadowBlur = 10
    ctx.fillStyle = '#f472b6'
    ctx.font = `bold ${ts * 0.18}px monospace`
    ctx.textAlign = 'center'
    ctx.fillText('GAME ON', ts * 8, wh * 0.65)
    ctx.shadowBlur = 0
  } else if (theme.wallStyle === 'brick') {
    // Detailed brick pattern with depth
    ctx.fillStyle = theme.colors.wallHighlight + '20'
    const brickH = ts * 0.18
    const brickW = ts * 0.45
    for (let by = 0; by < wh; by += brickH) {
      const offset = ((by / brickH) % 2) * brickW * 0.5
      for (let bx = offset; bx < w; bx += brickW) {
        // Mortar lines
        ctx.fillRect(bx, by, 1, brickH)
      }
      ctx.fillRect(0, by, w, 1)
    }
    // Window frame
    ctx.fillStyle = '#4a5568'
    ctx.fillRect(ts * 6, 3, ts * 2.5, wh - 6)
    ctx.fillStyle = '#87ceeb40'
    ctx.fillRect(ts * 6 + 2, 5, ts * 2.5 - 4, wh - 10)
    // Window cross
    ctx.fillStyle = '#4a5568'
    ctx.fillRect(ts * 7.2, 3, 2, wh - 6)
    ctx.fillRect(ts * 6, wh * 0.45, ts * 2.5, 2)
  } else if (theme.wallStyle === 'panel') {
    // War-room: animated radar + status monitors + tactical map
    // Radar screen
    ctx.fillStyle = '#0a2e1f'
    ctx.fillRect(ts * 2, 3, ts * 1.5, wh - 6)
    ctx.strokeStyle = theme.colors.accent + '80'
    ctx.lineWidth = 1
    ctx.strokeRect(ts * 2, 3, ts * 1.5, wh - 6)
    // Animated radar sweep
    ctx.fillStyle = theme.colors.accent + '30'
    ctx.beginPath()
    const radarCx = ts * 2.75; const radarCy = wh / 2
    const radarR = ts * 0.5
    ctx.arc(radarCx, radarCy, radarR, 0, Math.PI * 2)
    ctx.fill()
    // Sweep line
    ctx.strokeStyle = theme.colors.accent
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(radarCx, radarCy)
    ctx.lineTo(radarCx + Math.cos(gTime * 2) * radarR, radarCy + Math.sin(gTime * 2) * radarR)
    ctx.stroke()
    // Radar blips
    const blipPhase = gTime * 0.5
    ctx.fillStyle = theme.colors.accent
    ctx.beginPath()
    ctx.arc(radarCx + Math.cos(blipPhase) * radarR * 0.6, radarCy + Math.sin(blipPhase) * radarR * 0.4, 2, 0, Math.PI * 2)
    ctx.fill()

    // Status monitors with scrolling data
    for (let i = 0; i < 3; i++) {
      const mx = ts * (5 + i * 2.5)
      ctx.fillStyle = '#0f1a0f'
      ctx.fillRect(mx, 4, ts * 1.8, wh - 8)
      ctx.fillStyle = theme.colors.accent + '25'
      for (let j = 0; j < 4; j++) {
        const lineY = 7 + ((j + tick * 0.05) % 4) * (wh / 6)
        const lineW = ts * (0.8 + Math.sin(j + i) * 0.4)
        ctx.fillRect(mx + 3, lineY, lineW, 1.5)
      }
      // Blinking status LED
      ctx.fillStyle = (tick + i * 7) % 20 < 15 ? theme.colors.accent : '#ff0000'
      ctx.beginPath()
      ctx.arc(mx + ts * 1.6, 7, 2, 0, Math.PI * 2)
      ctx.fill()
    }

    // Tactical map with animated pins
    ctx.fillStyle = '#3d2b1f'
    ctx.fillRect(ts * 12, 2, ts * 2.5, wh - 4)
    ctx.fillStyle = '#5c4a3a'
    ctx.fillRect(ts * 12, 2, ts * 2.5, 2) // frame top
    ctx.fillStyle = theme.colors.accent
    const pinPos = [[0.5, 0.3], [1.2, 0.5], [1.8, 0.2], [0.8, 0.7]]
    for (const [px, py] of pinPos) {
      ctx.beginPath()
      ctx.arc(ts * 12 + ts * px, wh * py + 2, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (theme.wallStyle === 'glass') {
    // Cyber-lab: holographic displays + data streams
    ctx.fillStyle = theme.colors.accent + '08'
    ctx.fillRect(ts * 1.5, 2, ts * 4, wh - 4)
    ctx.fillRect(ts * 7, 2, ts * 3, wh - 4)
    ctx.fillRect(ts * 11.5, 2, ts * 3, wh - 4)
    // Reflection streaks
    ctx.strokeStyle = theme.colors.accent + '25'
    ctx.lineWidth = 0.5
    for (let i = 0; i < 6; i++) {
      const lx = ts * (2 + i * 2.2)
      ctx.beginPath()
      ctx.moveTo(lx, 2)
      ctx.lineTo(lx + ts * 0.4, wh - 4)
      ctx.stroke()
    }
    // Animated holographic data
    ctx.fillStyle = theme.colors.accent + '40'
    const dataOff = (gTime * 15) % (wh * 2)
    for (let dy = -wh; dy < wh; dy += 8) {
      const dw = ts * (0.3 + Math.sin(dy * 0.1 + gTime) * 0.2)
      ctx.fillRect(ts * 8, (dy + dataOff) % wh, dw, 1.5)
    }
    // Holographic HUD ring
    ctx.strokeStyle = theme.colors.accent + '30'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(ts * 13, wh * 0.45, ts * 0.5, gTime % (Math.PI * 2), gTime % (Math.PI * 2) + Math.PI * 1.5)
    ctx.stroke()
  } else if (theme.wallStyle === 'hedge') {
    // Campus-ops: animated hedge + birds + sign
    ctx.fillStyle = '#22c55e30'
    for (let hx = 0; hx < w; hx += ts * 0.25) {
      const hh = wh * (0.5 + Math.sin(hx * 0.08 + gTime * 0.3) * 0.3)
      ctx.fillRect(hx, wh - hh, ts * 0.25, hh)
    }
    // Leaf clusters
    ctx.fillStyle = '#15803d50'
    for (let hx = 0; hx < w; hx += ts * 0.4) {
      const r = ts * (0.1 + Math.sin(hx * 0.2) * 0.04)
      ctx.beginPath()
      ctx.arc(hx + ts * 0.15, wh * 0.35, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // Animated bird
    {
      const birdX = (gTime * 30) % (w + 40) - 20
      ctx.fillStyle = '#1c1917'
      ctx.beginPath()
      ctx.moveTo(birdX, wh * 0.2)
      ctx.quadraticCurveTo(birdX - 4, wh * 0.1, birdX - 8, wh * 0.15)
      ctx.quadraticCurveTo(birdX - 4, wh * 0.2, birdX, wh * 0.2)
      ctx.quadraticCurveTo(birdX + 4, wh * 0.1, birdX + 8, wh * 0.15)
      ctx.quadraticCurveTo(birdX + 4, wh * 0.2, birdX, wh * 0.2)
      ctx.fill()
    }
    // Garden sign
    ctx.fillStyle = '#92400e'
    ctx.fillRect(ts * 7, 2, ts * 2, wh - 6)
    ctx.fillStyle = '#b45309'
    ctx.fillRect(ts * 7, 2, ts * 2, 2)
    ctx.fillStyle = '#fef3c7'
    ctx.font = `bold ${Math.max(7, ts * 0.13)}px monospace`
    ctx.textAlign = 'center'
    ctx.fillText('ðŸŒ³ CAMPUS', ts * 8, wh * 0.6)
  } else if (theme.wallStyle === 'viewport') {
    // Deep-space: viewport windows with stars, nebula, and planet
    // Main viewport
    ctx.fillStyle = '#0a0a1a'
    ctx.fillRect(ts * 3, 3, ts * 5, wh - 6)
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 2
    ctx.strokeRect(ts * 3, 3, ts * 5, wh - 6)
    // Cross frame
    ctx.fillStyle = '#475569'
    ctx.fillRect(ts * 5.5 - 1, 3, 2, wh - 6)
    ctx.fillRect(ts * 3, wh * 0.45, ts * 5, 2)
    // Stars through viewport
    for (let i = 0; i < 12; i++) {
      const sx = ts * 3.2 + (i * 37.3) % (ts * 4.6)
      const sy = 6 + (i * 19.7) % (wh - 12)
      const twink = 0.4 + Math.sin(gTime * 3 + i * 2.1) * 0.4
      ctx.globalAlpha = twink
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(sx, sy, 1, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // Distant planet
    ctx.fillStyle = '#818cf840'
    ctx.beginPath()
    ctx.arc(ts * 6.5, wh * 0.35, ts * 0.25, 0, Math.PI * 2)
    ctx.fill()
    // Planet ring
    ctx.strokeStyle = '#818cf830'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(ts * 6.5, wh * 0.35, ts * 0.4, ts * 0.08, -0.3, 0, Math.PI * 2)
    ctx.stroke()
    // Side viewport
    ctx.fillStyle = '#0a0a1a'
    ctx.fillRect(ts * 10, 3, ts * 3, wh - 6)
    ctx.strokeStyle = '#475569'
    ctx.strokeRect(ts * 10, 3, ts * 3, wh - 6)
    // Nebula glow in side viewport
    ctx.globalAlpha = 0.15 + Math.sin(gTime) * 0.05
    ctx.fillStyle = '#a78bfa'
    ctx.beginPath()
    ctx.arc(ts * 11.5, wh * 0.4, ts * 0.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    // Status lights along wall
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = (tick + i * 5) % 30 < 20 ? theme.colors.accent : '#334155'
      ctx.beginPath()
      ctx.arc(ts * (0.8 + i * 0.3), wh * 0.5, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (theme.wallStyle === 'dungeon') {
    // Dungeon: rough stone walls with torches and dripping water
    // Stone block pattern
    ctx.fillStyle = theme.colors.wallHighlight + '15'
    const stoneH = ts * 0.2
    const stoneW = ts * 0.5
    for (let by = 0; by < wh; by += stoneH) {
      const offset = ((by / stoneH) % 2) * stoneW * 0.5
      for (let bx = offset; bx < w; bx += stoneW) {
        ctx.strokeStyle = '#00000025'
        ctx.lineWidth = 1
        ctx.strokeRect(bx, by, stoneW, stoneH)
      }
    }
    // Torches (animated flame)
    for (const tx of [ts * 3, ts * 8, ts * 13]) {
      // Torch bracket
      ctx.fillStyle = '#78716c'
      ctx.fillRect(tx, wh * 0.25, ts * 0.08, wh * 0.4)
      ctx.fillRect(tx - ts * 0.06, wh * 0.2, ts * 0.2, ts * 0.06)
      // Flame
      const flameH = ts * 0.15 + Math.sin(gTime * 8 + tx) * ts * 0.04
      const flameW = ts * 0.1 + Math.sin(gTime * 6 + tx) * ts * 0.02
      ctx.fillStyle = '#fbbf24'
      ctx.beginPath()
      ctx.ellipse(tx + ts * 0.04, wh * 0.18, flameW, flameH, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f97316'
      ctx.beginPath()
      ctx.ellipse(tx + ts * 0.04, wh * 0.2, flameW * 0.6, flameH * 0.6, 0, 0, Math.PI * 2)
      ctx.fill()
      // Torch glow
      ctx.globalAlpha = 0.08 + Math.sin(gTime * 5 + tx) * 0.03
      ctx.fillStyle = '#fbbf24'
      ctx.beginPath()
      ctx.arc(tx + ts * 0.04, wh * 0.2, ts * 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    // Chains
    ctx.strokeStyle = '#71717a50'
    ctx.lineWidth = 1.5
    for (const cx of [ts * 5.5, ts * 10.5]) {
      ctx.beginPath()
      for (let cy = 0; cy < wh * 0.7; cy += 4) {
        const sway = Math.sin(gTime * 1.5 + cy * 0.1) * 1.5
        ctx.lineTo(cx + sway, cy)
      }
      ctx.stroke()
    }
  } else if (theme.wallStyle === 'terminal') {
    // Hacker bunker: scrolling green terminal text + exposed wiring
    // Multiple terminal screens
    for (let i = 0; i < 4; i++) {
      const sx = ts * (1 + i * 3.5)
      ctx.fillStyle = '#0a0f0a'
      ctx.fillRect(sx, 3, ts * 2.5, wh - 6)
      ctx.strokeStyle = theme.colors.accent + '40'
      ctx.lineWidth = 1
      ctx.strokeRect(sx, 3, ts * 2.5, wh - 6)
      // Scrolling code text
      ctx.fillStyle = theme.colors.accent + '60'
      ctx.font = `${Math.max(5, ts * 0.07)}px monospace`
      for (let j = 0; j < 5; j++) {
        const lineY = 8 + ((j * 5 + tick * 0.3) % (wh - 10))
        const lineW = ts * (0.5 + ((i * 3 + j * 7) % 5) * 0.3)
        ctx.fillRect(sx + 3, lineY, lineW, 1.5)
      }
      // Cursor blink
      if (Math.sin(gTime * 4 + i) > 0) {
        ctx.fillStyle = theme.colors.accent
        ctx.fillRect(sx + 3, 8 + ((tick * 0.3) % (wh - 10)), 4, 2)
      }
    }
    // Exposed wiring along bottom of wall
    ctx.strokeStyle = '#ef444460'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, wh - 3)
    for (let wx = 0; wx < w; wx += ts * 0.3) {
      ctx.lineTo(wx, wh - 3 + Math.sin(wx * 0.1) * 2)
    }
    ctx.stroke()
    ctx.strokeStyle = '#3b82f660'
    ctx.beginPath()
    ctx.moveTo(0, wh - 5)
    for (let wx = 0; wx < w; wx += ts * 0.3) {
      ctx.lineTo(wx, wh - 5 + Math.cos(wx * 0.08) * 2)
    }
    ctx.stroke()
  }
}

// â”€â”€ Ambient glow from monitors and accent objects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function drawAmbientGlow(ctx: CanvasRenderingContext2D, theme: ThemeDef, ts: number, _w: number, _h: number, gTime: number) {
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.globalAlpha = 0.08 + Math.sin(gTime * 0.8) * 0.03

  // Desk monitor glows
  for (const pos of DESK_POSITIONS) {
    const gx = pos.x * ts + ts * 0.7
    const gy = pos.y * ts + ts * 0.35
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, ts * 1.2)
    grad.addColorStop(0, theme.colors.accent)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(gx - ts * 1.2, gy - ts * 1.2, ts * 2.4, ts * 2.4)
  }

  ctx.restore()
}

// â”€â”€ Environment props â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function drawProps(ctx: CanvasRenderingContext2D, theme: ThemeDef, ts: number, gTime: number, tick: number) {
  const id = theme.id

  if (id === 'office') {
    // Water cooler with animated bubbles
    ctx.fillStyle = '#93c5fd'
    ctx.fillRect(ts * 1.2, ts * 4.5, ts * 0.3, ts * 0.6)
    ctx.fillStyle = '#60a5fa'
    ctx.fillRect(ts * 1.15, ts * 4.5, ts * 0.4, ts * 0.15)
    // Bubbles
    ctx.fillStyle = '#ffffff40'
    const bubbleY = ts * 4.7 + Math.sin(gTime * 3) * ts * 0.1
    ctx.beginPath(); ctx.arc(ts * 1.3, bubbleY, 2, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(ts * 1.35, bubbleY - 5, 1.5, 0, Math.PI * 2); ctx.fill()

    // Potted plant with swaying leaves
    ctx.fillStyle = '#92400e'
    ctx.fillRect(ts * 1, ts * 7, ts * 0.4, ts * 0.3)
    ctx.fillStyle = '#22c55e'
    const plantSway = Math.sin(gTime * 1.5) * ts * 0.03
    ctx.beginPath()
    ctx.arc(ts * 1.2 + plantSway, ts * 6.75, ts * 0.28, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#16a34a'
    ctx.beginPath()
    ctx.arc(ts * 1.15 + plantSway * 0.5, ts * 6.85, ts * 0.2, 0, Math.PI * 2)
    ctx.fill()

    // Whiteboard with content
    ctx.fillStyle = '#f1f5f9'
    ctx.fillRect(ts * 6, ts * 0.55, ts * 2.5, ts * 0.55)
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 1.5
    ctx.strokeRect(ts * 6, ts * 0.55, ts * 2.5, ts * 0.55)
    // Whiteboard text
    ctx.fillStyle = '#333333'
    ctx.fillRect(ts * 6.2, ts * 0.65, ts * 1.5, 1.5)
    ctx.fillRect(ts * 6.2, ts * 0.8, ts * 1.8, 1.5)
    ctx.fillRect(ts * 6.2, ts * 0.95, ts * 1.2, 1.5)

    // Clock with moving hands
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(ts * 14.5, ts * 0.5, ts * 0.22, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#1e1e1e'
    ctx.lineWidth = 1
    ctx.stroke()
    // Hour hand
    const hourAngle = (gTime * 0.01) % (Math.PI * 2)
    ctx.beginPath()
    ctx.moveTo(ts * 14.5, ts * 0.5)
    ctx.lineTo(ts * 14.5 + Math.cos(hourAngle) * ts * 0.1, ts * 0.5 + Math.sin(hourAngle) * ts * 0.1)
    ctx.stroke()
    // Minute hand
    const minAngle = (gTime * 0.1) % (Math.PI * 2)
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(ts * 14.5, ts * 0.5)
    ctx.lineTo(ts * 14.5 + Math.cos(minAngle) * ts * 0.15, ts * 0.5 + Math.sin(minAngle) * ts * 0.15)
    ctx.stroke()
  } else if (id === 'war-room') {
    // Strategy table with holographic projection
    ctx.fillStyle = '#57534e'
    ctx.fillRect(ts * 6.5, ts * 4, ts * 3, ts * 1.5)
    ctx.fillStyle = '#78716c'
    ctx.fillRect(ts * 6.5, ts * 4, ts * 3, ts * 0.15)
    // Table edge highlight
    ctx.fillStyle = theme.colors.accent + '20'
    ctx.fillRect(ts * 6.5, ts * 4, ts * 3, 1)
    // Table hologram
    ctx.globalAlpha = 0.15 + Math.sin(gTime * 2) * 0.08
    ctx.fillStyle = theme.colors.accent
    ctx.beginPath()
    ctx.moveTo(ts * 7.5, ts * 3.2)
    ctx.lineTo(ts * 8.5, ts * 3.2)
    ctx.lineTo(ts * 9, ts * 4)
    ctx.lineTo(ts * 7, ts * 4)
    ctx.fill()
    ctx.globalAlpha = 1

    // Ammo crates
    ctx.fillStyle = '#44403c'
    ctx.fillRect(ts * 1, ts * 8, ts * 0.6, ts * 0.4)
    ctx.fillRect(ts * 1.1, ts * 7.5, ts * 0.5, ts * 0.4)
    ctx.fillStyle = theme.colors.accent + '50'
    ctx.fillRect(ts * 1.15, ts * 8.05, ts * 0.3, ts * 0.05)
    ctx.fillStyle = '#fbbf2480'
    ctx.fillRect(ts * 1.2, ts * 7.55, ts * 0.15, ts * 0.08)

    // Radar dish
    ctx.fillStyle = '#a8a29e'
    ctx.fillRect(ts * 15.1, ts * 3, ts * 0.3, ts * 1.5)
    ctx.beginPath()
    ctx.arc(ts * 15.25, ts * 2.8, ts * 0.35, Math.PI, Math.PI * 2)
    ctx.fillStyle = '#d6d3d1'
    ctx.fill()
    // Rotating dish element
    ctx.strokeStyle = '#a8a29e'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(ts * 15.25, ts * 2.8, ts * 0.15, gTime % (Math.PI * 2), gTime % (Math.PI * 2) + Math.PI)
    ctx.stroke()
  } else if (id === 'retro-arcade') {
    // Arcade cabinets with animated screens
    for (let i = 0; i < 3; i++) {
      const ax = ts * (1 + i * 0.85)
      ctx.fillStyle = ['#581c87', '#1e1b4b', '#7c2d12'][i]
      ctx.fillRect(ax, ts * 3, ts * 0.55, ts * 1.3)
      // Screen with animation
      ctx.fillStyle = theme.colors.accent + '50'
      ctx.fillRect(ax + 3, ts * 3.1, ts * 0.55 - 6, ts * 0.55)
      // Scrolling game content
      ctx.fillStyle = ['#f472b6', '#60a5fa', '#fbbf24'][i]
      const gameY = (gTime * 20 + i * 10) % (ts * 0.55)
      ctx.fillRect(ax + 6, ts * 3.15 + gameY, ts * 0.2, 3)
      // Screen glow
      ctx.shadowColor = theme.colors.accent
      ctx.shadowBlur = 6
      ctx.fillStyle = theme.colors.accent + '15'
      ctx.fillRect(ax + 4, ts * 3.12, ts * 0.4, ts * 0.45)
      ctx.shadowBlur = 0
      // Joystick
      ctx.fillStyle = '#f472b6'
      ctx.beginPath()
      ctx.arc(ax + ts * 0.27, ts * 3.9, ts * 0.04, 0, Math.PI * 2)
      ctx.fill()
    }

    // "ARCADE" neon sign with flicker
    const flickerAlpha = Math.sin(gTime * 12) > -0.3 ? 1 : 0.3
    ctx.globalAlpha = flickerAlpha
    ctx.shadowColor = '#f472b6'
    ctx.shadowBlur = 10
    ctx.fillStyle = '#f472b6'
    ctx.font = `bold ${ts * 0.22}px monospace`
    ctx.textAlign = 'center'
    ctx.fillText('ARCADE', ts * 11, ts * 0.7)
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1

    // Pixel poster
    ctx.fillStyle = '#fef08a20'
    ctx.fillRect(ts * 14, ts * 0.5, ts * 0.9, ts * 0.6)
    // Pixel art on poster
    ctx.fillStyle = '#ef444480'
    ctx.fillRect(ts * 14.15, ts * 0.6, ts * 0.12, ts * 0.12)
    ctx.fillStyle = '#22c55e80'
    ctx.fillRect(ts * 14.35, ts * 0.7, ts * 0.12, ts * 0.12)
  } else if (id === 'cyber-lab') {
    // Server racks with animated LEDs
    for (let i = 0; i < 3; i++) {
      const sy = ts * (2 + i * 2.2)
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(ts * 0.6, sy, ts * 0.55, ts * 1.6)
      ctx.fillStyle = theme.colors.accent + '35'
      for (let j = 0; j < 5; j++) {
        ctx.fillRect(ts * 0.7, sy + ts * (0.12 + j * 0.28), ts * 0.35, ts * 0.04)
      }
      // Animated LEDs
      for (let j = 0; j < 3; j++) {
        const ledOn = ((tick + i * 3 + j * 5) % 8) < 5
        ctx.fillStyle = ledOn ? theme.colors.accent : '#334155'
        ctx.beginPath()
        ctx.arc(ts * 0.65, sy + ts * (0.2 + j * 0.35), 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Data stream effect (animated falling characters)
    ctx.fillStyle = theme.colors.accent + '12'
    ctx.fillRect(ts * 15.2, ts * 1, ts * 0.3, ts * 8)
    ctx.fillStyle = theme.colors.accent + '50'
    ctx.font = `${ts * 0.08}px monospace`
    for (let j = 0; j < 12; j++) {
      const charY = (gTime * 40 + j * 25) % (ts * 8)
      const ch = '01'[(tick + j) % 2]
      ctx.fillText(ch, ts * 15.25, ts * 1 + charY)
    }

    // Hologram projector with rotating hologram
    ctx.fillStyle = '#475569'
    ctx.fillRect(ts * 7.5, ts * 8.5, ts * 1, ts * 0.3)
    // Holographic projection cone
    ctx.globalAlpha = 0.12 + Math.sin(gTime * 1.5) * 0.05
    ctx.fillStyle = theme.colors.accent
    ctx.beginPath()
    ctx.moveTo(ts * 7.6, ts * 8.5)
    ctx.lineTo(ts * 8, ts * 7)
    ctx.lineTo(ts * 8.4, ts * 8.5)
    ctx.fill()
    // Holographic cube
    ctx.strokeStyle = theme.colors.accent + '80'
    ctx.lineWidth = 1
    const cubeAngle = gTime * 2
    const cubeX = ts * 8; const cubeY = ts * 7.5
    const cubeR = ts * 0.2
    ctx.beginPath()
    ctx.rect(cubeX - cubeR * Math.cos(cubeAngle) * 0.7, cubeY - cubeR * 0.5, cubeR * 1.4 * Math.abs(Math.cos(cubeAngle)), cubeR)
    ctx.stroke()
    ctx.globalAlpha = 1
  } else if (id === 'campus-ops') {
    // Large tree with animated canopy
    ctx.fillStyle = '#92400e'
    ctx.fillRect(ts * 1, ts * 3, ts * 0.18, ts * 1.2)
    // Canopy layers (swaying)
    const sway = Math.sin(gTime * 0.8) * ts * 0.04
    ctx.fillStyle = '#22c55e'
    ctx.beginPath(); ctx.arc(ts * 1.09 + sway, ts * 2.6, ts * 0.45, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#16a34a'
    ctx.beginPath(); ctx.arc(ts * 1.09 + sway * 0.6, ts * 2.85, ts * 0.35, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#15803d'
    ctx.beginPath(); ctx.arc(ts * 1.25 + sway * 0.3, ts * 2.5, ts * 0.25, 0, Math.PI * 2); ctx.fill()

    // Bench with detail
    ctx.fillStyle = '#92400e'
    ctx.fillRect(ts * 14, ts * 7.5, ts * 1.3, ts * 0.12)
    ctx.fillRect(ts * 14, ts * 7.65, ts * 1.3, ts * 0.08)
    ctx.fillRect(ts * 14.1, ts * 7.7, ts * 0.08, ts * 0.3)
    ctx.fillRect(ts * 15.1, ts * 7.7, ts * 0.08, ts * 0.3)
    // Bench shadow
    ctx.fillStyle = 'rgba(0,0,0,0.08)'
    ctx.fillRect(ts * 14.05, ts * 8, ts * 1.3, ts * 0.06)

    // Fountain with animated water
    ctx.fillStyle = '#94a3b8'
    ctx.beginPath()
    ctx.ellipse(ts * 7.5, ts * 8.5, ts * 0.55, ts * 0.22, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#60a5fa30'
    ctx.beginPath()
    ctx.ellipse(ts * 7.5, ts * 8.45, ts * 0.45, ts * 0.18, 0, 0, Math.PI * 2)
    ctx.fill()
    // Water spout
    ctx.fillStyle = '#60a5fa40'
    const spoutH = ts * 0.15 + Math.sin(gTime * 4) * ts * 0.04
    ctx.fillRect(ts * 7.48, ts * 8.3 - spoutH, ts * 0.04, spoutH)
    // Water droplets
    ctx.fillStyle = '#60a5fa60'
    ctx.beginPath()
    ctx.arc(ts * 7.5 + Math.sin(gTime * 3) * ts * 0.05, ts * 8.3 - spoutH - 2, 1.5, 0, Math.PI * 2)
    ctx.fill()

    // Bike rack
    ctx.strokeStyle = '#71717a'
    ctx.lineWidth = 1.5
    for (let i = 0; i < 4; i++) {
      ctx.beginPath()
      ctx.arc(ts * (14.2 + i * 0.3), ts * 4, ts * 0.12, 0, Math.PI * 2)
      ctx.stroke()
    }
  } else if (id === 'deep-space') {
    // Airlock door with animated lights
    ctx.fillStyle = '#334155'
    ctx.fillRect(ts * 0.7, ts * 3, ts * 0.6, ts * 2)
    ctx.strokeStyle = theme.colors.accent + '40'
    ctx.lineWidth = 1.5
    ctx.strokeRect(ts * 0.72, ts * 3.02, ts * 0.56, ts * 1.96)
    // Airlock warning lights
    ctx.fillStyle = ((tick % 40) < 20) ? '#ef4444' : '#ef444440'
    ctx.beginPath()
    ctx.arc(ts * 1, ts * 2.8, ts * 0.06, 0, Math.PI * 2)
    ctx.fill()
    // Airlock label
    ctx.fillStyle = theme.colors.accent + '60'
    ctx.font = `bold ${ts * 0.06}px monospace`
    ctx.textAlign = 'center'
    ctx.fillText('AIRLOCK', ts * 1, ts * 5.2)

    // Observation window with deep space view
    ctx.fillStyle = '#0a0a2e'
    ctx.beginPath()
    ctx.arc(ts * 7.5, ts * 5, ts * 1.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 3
    ctx.stroke()
    // Stars in window
    for (let i = 0; i < 8; i++) {
      const sa = (i * 0.785 + gTime * 0.1) % (Math.PI * 2)
      const sr = ts * (0.3 + (i * 0.1))
      const twink = 0.5 + Math.sin(gTime * 2 + i) * 0.5
      ctx.globalAlpha = twink
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(ts * 7.5 + Math.cos(sa) * sr, ts * 5 + Math.sin(sa) * sr, 1, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // Window cross frame
    ctx.strokeStyle = '#475569'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ts * 6.3, ts * 5)
    ctx.lineTo(ts * 8.7, ts * 5)
    ctx.moveTo(ts * 7.5, ts * 3.8)
    ctx.lineTo(ts * 7.5, ts * 6.2)
    ctx.stroke()

    // Navigation console with animated displays
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(ts * 14, ts * 3, ts * 1.5, ts * 2)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(ts * 14.1, ts * 3.1, ts * 1.3, ts * 0.8)
    // Animated star chart
    ctx.strokeStyle = theme.colors.accent + '40'
    ctx.lineWidth = 0.5
    for (let i = 0; i < 5; i++) {
      const px = ts * 14.3 + (i * 0.2) * ts
      const py = ts * 3.3 + Math.sin(gTime + i) * ts * 0.15
      ctx.beginPath()
      ctx.arc(px, py, 2, 0, Math.PI * 2)
      ctx.stroke()
    }
    // Console buttons
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = ['#ef4444', '#22c55e', '#3b82f6', '#fbbf24'][i]
      ctx.beginPath()
      ctx.arc(ts * (14.3 + i * 0.3), ts * 4.5, ts * 0.04, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (id === 'dungeon-terminal') {
    // Wall torches (background layer - larger)
    for (const [tx, ty] of [[ts * 1.5, ts * 2], [ts * 14.5, ts * 2], [ts * 1.5, ts * 7], [ts * 14.5, ts * 7]]) {
      ctx.fillStyle = '#78716c'
      ctx.fillRect(tx, ty, ts * 0.1, ts * 0.5)
      ctx.fillRect(tx - ts * 0.08, ty - ts * 0.05, ts * 0.26, ts * 0.08)
      // Large flame
      const fH = ts * 0.25 + Math.sin(gTime * 7 + tx + ty) * ts * 0.06
      ctx.fillStyle = '#fbbf24cc'
      ctx.beginPath()
      ctx.ellipse(tx + ts * 0.05, ty - ts * 0.05, ts * 0.08, fH, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f97316aa'
      ctx.beginPath()
      ctx.ellipse(tx + ts * 0.05, ty, ts * 0.05, fH * 0.4, 0, 0, Math.PI * 2)
      ctx.fill()
      // Light pool
      ctx.globalAlpha = 0.06 + Math.sin(gTime * 4 + tx) * 0.02
      ctx.fillStyle = '#fbbf24'
      ctx.beginPath()
      ctx.arc(tx, ty, ts * 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    // Skull decoration
    ctx.fillStyle = '#e5e7eb'
    ctx.beginPath()
    ctx.arc(ts * 7.5, ts * 1.5, ts * 0.18, 0, Math.PI * 2)
    ctx.fill()
    // Eye sockets
    ctx.fillStyle = '#1c1917'
    ctx.beginPath()
    ctx.arc(ts * 7.42, ts * 1.47, ts * 0.04, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(ts * 7.58, ts * 1.47, ts * 0.04, 0, Math.PI * 2)
    ctx.fill()
    // Glowing eyes
    ctx.fillStyle = theme.colors.accent + '80'
    ctx.beginPath()
    ctx.arc(ts * 7.42, ts * 1.47, ts * 0.02, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(ts * 7.58, ts * 1.47, ts * 0.02, 0, Math.PI * 2)
    ctx.fill()

    // Chains from ceiling
    ctx.strokeStyle = '#71717a60'
    ctx.lineWidth = 1.5
    for (const cx of [ts * 4, ts * 11]) {
      ctx.beginPath()
      for (let cy = ts * 0.5; cy < ts * 3; cy += 5) {
        const sway = Math.sin(gTime + cy * 0.05 + cx) * 2
        ctx.lineTo(cx + sway, cy)
      }
      ctx.stroke()
    }

    // Ancient computer terminal (anachronistic)
    ctx.fillStyle = '#44403c'
    ctx.fillRect(ts * 7, ts * 7.5, ts * 2, ts * 1.5)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(ts * 7.1, ts * 7.6, ts * 1.8, ts * 0.8)
    // Screen glow
    ctx.fillStyle = theme.colors.accent + '20'
    ctx.fillRect(ts * 7.1, ts * 7.6, ts * 1.8, ts * 0.8)
    // Scrolling runes
    ctx.fillStyle = theme.colors.accent + '50'
    for (let i = 0; i < 4; i++) {
      const ry = ts * 7.7 + ((i * 6 + tick * 0.2) % (ts * 0.6))
      ctx.fillRect(ts * 7.2, ry, ts * (0.3 + (i * 0.2)), 1.5)
    }
  } else if (id === 'hacker-bunker') {
    // Cable runs across ceiling
    const cables = ['#ef444460', '#22c55e60', '#3b82f660', '#fbbf2460']
    for (let i = 0; i < cables.length; i++) {
      ctx.strokeStyle = cables[i]
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const cy = ts * (0.8 + i * 0.15)
      ctx.moveTo(0, cy)
      for (let cx = 0; cx < GRID_W * ts; cx += ts * 0.5) {
        ctx.lineTo(cx, cy + Math.sin(cx * 0.02 + i) * ts * 0.08)
      }
      ctx.stroke()
    }

    // Multiple monitor wall
    for (let i = 0; i < 3; i++) {
      const mx = ts * (0.8 + i * 0.55)
      ctx.fillStyle = '#0a0f0a'
      ctx.fillRect(mx, ts * 2, ts * 0.45, ts * 0.35)
      ctx.strokeStyle = theme.colors.accent + '30'
      ctx.lineWidth = 0.5
      ctx.strokeRect(mx, ts * 2, ts * 0.45, ts * 0.35)
      // Screen content
      ctx.fillStyle = theme.colors.accent + '40'
      for (let j = 0; j < 3; j++) {
        ctx.fillRect(mx + 2, ts * 2.05 + j * ts * 0.08, ts * (0.15 + (j * 0.08)), 1)
      }
    }

    // Pizza box (hacker essential)
    ctx.fillStyle = '#92400e'
    ctx.fillRect(ts * 14, ts * 8, ts * 0.8, ts * 0.1)
    ctx.fillRect(ts * 14, ts * 7.95, ts * 0.8, ts * 0.05)
    ctx.fillStyle = '#b45309'
    ctx.fillRect(ts * 14.05, ts * 8.01, ts * 0.7, ts * 0.06)

    // Energy drink cans
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#22c55e', '#3b82f6', '#f472b6'][i]
      ctx.fillRect(ts * (14.2 + i * 0.2), ts * 7.6, ts * 0.08, ts * 0.18)
      ctx.fillStyle = '#d4d4d8'
      ctx.fillRect(ts * (14.2 + i * 0.2), ts * 7.6, ts * 0.08, ts * 0.03)
    }

    // Server rack with blinking lights
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(ts * 15, ts * 2.5, ts * 0.5, ts * 4)
    ctx.fillStyle = '#0f172a'
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(ts * 15.05, ts * (2.7 + i * 0.55), ts * 0.4, ts * 0.35)
    }
    // LEDs
    for (let i = 0; i < 6; i++) {
      const ledOn = ((tick + i * 4) % 12) < 8
      ctx.fillStyle = ledOn ? theme.colors.accent : '#334155'
      ctx.beginPath()
      ctx.arc(ts * 15.08, ts * (2.8 + i * 0.55), 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawDesk(ctx: CanvasRenderingContext2D, dx: number, dy: number, ts: number, theme: ThemeDef, agentState?: AgentState, gTime: number = 0) {
  const w = ts * 1.5
  const h = ts

  // Shadow (softer, spread)
  ctx.fillStyle = theme.colors.shadow
  ctx.beginPath()
  ctx.ellipse(dx + w / 2 + 3, dy + h + 2, w * 0.52, h * 0.12, 0, 0, Math.PI * 2)
  ctx.fill()

  if (theme.deskStyle === 'wood') {
    ctx.fillStyle = theme.colors.desk
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 3); ctx.fill()
    ctx.fillStyle = theme.colors.deskHighlight
    ctx.fillRect(dx + 2, dy + 1, w - 4, h * 0.2)
    // Wood grain
    ctx.fillStyle = theme.colors.deskHighlight + '25'
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(dx + 5, dy + h * (0.3 + i * 0.2), w - 10, 1)
    }
    // Coffee mug with steam
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(dx + w - ts * 0.2, dy + ts * 0.7, ts * 0.09, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#92400e'
    ctx.beginPath()
    ctx.arc(dx + w - ts * 0.2, dy + ts * 0.68, ts * 0.06, 0, Math.PI * 2)
    ctx.fill()
    // Steam
    ctx.globalAlpha = 0.2
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(dx + w - ts * 0.2 + Math.sin(gTime * 2) * 2, dy + ts * 0.55, 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(dx + w - ts * 0.18, dy + ts * 0.48, 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    // Papers
    ctx.fillStyle = '#f1f5f9'
    ctx.save()
    ctx.translate(dx + ts * 0.95, dy + ts * 0.7)
    ctx.rotate(0.1)
    ctx.fillRect(0, 0, ts * 0.25, ts * 0.18)
    ctx.restore()
  } else if (theme.deskStyle === 'metal') {
    ctx.fillStyle = theme.colors.desk
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 2); ctx.fill()
    ctx.fillStyle = theme.colors.deskHighlight
    ctx.fillRect(dx + 1, dy + 1, w - 2, h * 0.12)
    // Rivets
    ctx.fillStyle = theme.colors.wallHighlight + '50'
    for (const [rx, ry] of [[3, 3], [w - 5, 3], [3, h - 5], [w - 5, h - 5]]) {
      ctx.beginPath()
      ctx.arc(dx + rx, dy + ry, 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
    // Tactical screen
    ctx.fillStyle = theme.colors.screenBg
    ctx.fillRect(dx + ts * 0.9, dy + ts * 0.28, ts * 0.38, ts * 0.28)
    ctx.fillStyle = theme.colors.accent + '35'
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(dx + ts * 0.95, dy + ts * (0.32 + i * 0.08), ts * 0.22, 1.5)
    }
  } else if (theme.deskStyle === 'neon') {
    ctx.fillStyle = theme.colors.desk
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 3); ctx.fill()
    // Neon edge glow
    ctx.shadowColor = theme.colors.accent
    ctx.shadowBlur = 8
    ctx.strokeStyle = theme.colors.accent + '90'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 3); ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = theme.colors.deskHighlight
    ctx.fillRect(dx + 2, dy + 1, w - 4, h * 0.2)
    // Arcade buttons
    const btnColors = ['#ef4444', '#22c55e', '#3b82f6']
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = btnColors[i]
      ctx.beginPath()
      ctx.arc(dx + w - ts * (0.15 + i * 0.12), dy + ts * 0.65, ts * 0.04, 0, Math.PI * 2)
      ctx.fill()
    }
    // Joystick
    ctx.fillStyle = '#1e1b4b'
    ctx.fillRect(dx + w - ts * 0.35, dy + ts * 0.5, ts * 0.12, ts * 0.2)
    ctx.fillStyle = '#f472b6'
    ctx.beginPath()
    ctx.arc(dx + w - ts * 0.29, dy + ts * 0.47, ts * 0.06, 0, Math.PI * 2)
    ctx.fill()
  } else if (theme.deskStyle === 'glass') {
    ctx.fillStyle = theme.colors.desk + '60'
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 4); ctx.fill()
    ctx.fillStyle = theme.colors.accent + '10'
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 4); ctx.fill()
    ctx.strokeStyle = theme.colors.accent + '35'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 4); ctx.stroke()
    // Holographic monitor floating
    ctx.fillStyle = theme.colors.accent + '18'
    ctx.fillRect(dx + ts * 0.2, dy + ts * 0.05, ts * 0.85, ts * 0.5)
    ctx.strokeStyle = theme.colors.accent + '45'
    ctx.strokeRect(dx + ts * 0.2, dy + ts * 0.05, ts * 0.85, ts * 0.5)
    // Floating keyboard
    ctx.fillStyle = theme.colors.accent + '25'
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(dx + ts * (0.25 + i * 0.12), dy + ts * 0.72, ts * 0.08, ts * 0.04)
    }
  } else if (theme.deskStyle === 'picnic') {
    // Picnic bench planks
    ctx.fillStyle = '#92400e'
    ctx.beginPath(); ctx.roundRect(dx, dy + h * 0.35, w, h * 0.15, 2); ctx.fill()
    ctx.beginPath(); ctx.roundRect(dx, dy + h * 0.65, w, h * 0.15, 2); ctx.fill()
    ctx.fillStyle = '#a3592a'
    ctx.fillRect(dx + 2, dy + h * 0.37, w - 4, 2) // plank highlight
    // Legs
    ctx.fillStyle = '#7c3415'
    ctx.fillRect(dx + ts * 0.1, dy + h * 0.28, ts * 0.08, h * 0.65)
    ctx.fillRect(dx + w - ts * 0.18, dy + h * 0.28, ts * 0.08, h * 0.65)
    // Laptop
    ctx.fillStyle = '#374151'
    ctx.beginPath(); ctx.roundRect(dx + ts * 0.3, dy + ts * 0.12, ts * 0.5, ts * 0.35, 2); ctx.fill()
    ctx.fillStyle = theme.colors.screenBg
    ctx.fillRect(dx + ts * 0.33, dy + ts * 0.16, ts * 0.44, ts * 0.24)
    // Water bottle
    ctx.fillStyle = '#60a5fa'
    ctx.beginPath(); ctx.roundRect(dx + w - ts * 0.2, dy + ts * 0.28, ts * 0.1, ts * 0.22, 2); ctx.fill()
    ctx.fillStyle = '#3b82f6'
    ctx.fillRect(dx + w - ts * 0.19, dy + ts * 0.28, ts * 0.08, ts * 0.04)
  } else if (theme.deskStyle === 'console') {
    // Sci-fi workstation console â€” curved control panel with embedded screens
    ctx.fillStyle = theme.colors.desk
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 4); ctx.fill()
    // Metal edge highlights
    ctx.fillStyle = theme.colors.deskHighlight
    ctx.fillRect(dx + 2, dy + 1, w - 4, h * 0.12)
    // Embedded mini-screens
    ctx.fillStyle = theme.colors.screenBg
    ctx.fillRect(dx + ts * 0.1, dy + ts * 0.25, ts * 0.35, ts * 0.2)
    ctx.fillRect(dx + ts * 0.55, dy + ts * 0.25, ts * 0.35, ts * 0.2)
    // Screen content (blinking data)
    ctx.fillStyle = theme.colors.accent + '40'
    for (let i = 0; i < 2; i++) {
      ctx.fillRect(dx + ts * (0.12 + i * 0.45), dy + ts * 0.28, ts * 0.2, 1)
      ctx.fillRect(dx + ts * (0.12 + i * 0.45), dy + ts * 0.33, ts * 0.15, 1)
    }
    // Colored control buttons
    const btns = ['#ef4444', '#fbbf24', '#22c55e']
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = btns[i]
      ctx.beginPath()
      ctx.arc(dx + ts * (0.2 + i * 0.2), dy + ts * 0.65, ts * 0.035, 0, Math.PI * 2)
      ctx.fill()
    }
    // Throttle slider
    ctx.fillStyle = '#475569'
    ctx.fillRect(dx + w - ts * 0.35, dy + ts * 0.55, ts * 0.2, ts * 0.06)
    ctx.fillStyle = theme.colors.accent
    ctx.fillRect(dx + w - ts * 0.3, dy + ts * 0.54, ts * 0.05, ts * 0.08)
    // Edge glow
    ctx.shadowColor = theme.colors.accent
    ctx.shadowBlur = 4
    ctx.strokeStyle = theme.colors.accent + '35'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 4); ctx.stroke()
    ctx.shadowBlur = 0
  } else if (theme.deskStyle === 'stone') {
    // Stone slab desk â€” rough hewn stone with runes
    ctx.fillStyle = theme.colors.desk
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 2); ctx.fill()
    // Stone texture - rough edges
    ctx.fillStyle = theme.colors.deskHighlight + '30'
    ctx.fillRect(dx + 2, dy + 1, w - 4, h * 0.15)
    // Cracks
    ctx.strokeStyle = '#00000015'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(dx + ts * 0.3, dy + ts * 0.2)
    ctx.lineTo(dx + ts * 0.7, dy + ts * 0.6)
    ctx.stroke()
    // Glowing runes
    ctx.fillStyle = theme.colors.accent + '30'
    const runes = ['â—‡', 'â–³', 'â—‹']
    ctx.font = `${ts * 0.12}px serif`
    for (let i = 0; i < 3; i++) {
      ctx.fillText(runes[i], dx + ts * (0.2 + i * 0.35), dy + ts * 0.85)
    }
    // Candle
    ctx.fillStyle = '#fef3c7'
    ctx.fillRect(dx + w - ts * 0.15, dy + ts * 0.4, ts * 0.06, ts * 0.2)
    ctx.fillStyle = '#fbbf24'
    ctx.beginPath()
    ctx.arc(dx + w - ts * 0.12, dy + ts * 0.38, ts * 0.03, 0, Math.PI * 2)
    ctx.fill()
  } else if (theme.deskStyle === 'holo') {
    // Holographic projected desk â€” translucent with scan lines
    ctx.globalAlpha = 0.5
    ctx.fillStyle = theme.colors.desk
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 3); ctx.fill()
    ctx.globalAlpha = 1
    // Holographic scanlines
    ctx.globalAlpha = 0.08
    ctx.fillStyle = theme.colors.accent
    for (let sy = 0; sy < h; sy += 3) {
      ctx.fillRect(dx, dy + sy, w, 1)
    }
    ctx.globalAlpha = 1
    // Holographic edge glow
    ctx.shadowColor = theme.colors.accent
    ctx.shadowBlur = 8
    ctx.strokeStyle = theme.colors.accent + '60'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.roundRect(dx, dy, w, h, 3); ctx.stroke()
    ctx.shadowBlur = 0
    // Floating holographic keyboard
    ctx.globalAlpha = 0.35
    ctx.fillStyle = theme.colors.accent
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(dx + ts * (0.1 + i * 0.13), dy + ts * 0.7, ts * 0.09, ts * 0.05)
    }
    ctx.globalAlpha = 1
    // Holographic screen projection
    ctx.globalAlpha = 0.2
    ctx.fillStyle = theme.colors.accent
    ctx.fillRect(dx + ts * 0.15, dy + ts * 0.1, ts * 0.8, ts * 0.45)
    ctx.globalAlpha = 1
    ctx.strokeStyle = theme.colors.accent + '40'
    ctx.lineWidth = 0.5
    ctx.strokeRect(dx + ts * 0.15, dy + ts * 0.1, ts * 0.8, ts * 0.45)
  } else {
    ctx.fillStyle = theme.colors.desk
    ctx.fillRect(dx, dy, w, h)
    ctx.fillStyle = theme.colors.deskHighlight
    ctx.fillRect(dx, dy, w, h * 0.22)
  }

  // Monitor (non-picnic/non-glass/non-holo styles)
  if (theme.deskStyle !== 'picnic' && theme.deskStyle !== 'glass' && theme.deskStyle !== 'holo') {
    const monW = ts * 0.88
    const monH = ts * 0.58
    // Monitor stand
    ctx.fillStyle = theme.colors.monitor
    ctx.fillRect(dx + ts * 0.55, dy + ts * 0.05, ts * 0.12, ts * 0.12)
    // Monitor body
    ctx.fillStyle = theme.colors.monitor
    ctx.beginPath(); ctx.roundRect(dx + ts * 0.18, dy + ts * 0.08, monW, monH, 3); ctx.fill()

    // Screen with animated content
    const screenColor = agentState ? STATE_VISUALS[agentState]?.color || theme.colors.screenBg : theme.colors.screenBg
    ctx.fillStyle = screenColor
    ctx.fillRect(dx + ts * 0.23, dy + ts * 0.13, monW - ts * 0.1, monH - ts * 0.1)

    // Fake code lines (animated when writing/tool)
    const isActive = agentState === 'writing' || agentState === 'tool' || agentState === 'reading'
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    for (let i = 0; i < 4; i++) {
      const lineW = ts * (0.2 + Math.sin(i * 2.7 + (isActive ? gTime * 3 : 0)) * 0.15)
      ctx.fillRect(dx + ts * 0.28, dy + ts * (0.18 + i * 0.1), lineW, 1.5)
    }
    // Blinking cursor (when writing)
    if (agentState === 'writing' && Math.sin(gTime * 6) > 0) {
      ctx.fillStyle = '#ffffff80'
      ctx.fillRect(dx + ts * 0.28, dy + ts * 0.48, 2, ts * 0.06)
    }

    // Keyboard
    ctx.fillStyle = theme.colors.keyboard
    ctx.beginPath(); ctx.roundRect(dx + ts * 0.28, dy + ts * 0.72, ts * 0.72, ts * 0.15, 2); ctx.fill()
    // Key rows
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(dx + ts * 0.31, dy + ts * (0.74 + i * 0.04), ts * 0.66, 1)
    }
  }
}

function drawBubble(
  ctx: CanvasRenderingContext2D, x: number, y: number, text: string,
  theme: ThemeDef, ts: number, isThought: boolean = false, tick: number = 0,
) {
    const readableText = contrastTextColor(theme.colors.bubble)

  ctx.font = `bold ${Math.max(9, ts * 0.17)}px monospace`
  const bw = Math.max(ts * 0.8, ctx.measureText(text).width + 18)
  const bh = ts * 0.38
  const bx = x - bw / 2
  const by = y - bh

  const fadeAlpha = smoothStep(clamp01(1 - Math.abs(tick % 200 - 100) / 120))
  ctx.globalAlpha = Math.max(0.75, fadeAlpha)

  // Bubble background with shadow
  ctx.shadowColor = 'rgba(0,0,0,0.15)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetY = 2
  ctx.fillStyle = theme.colors.bubble + 'f0'
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, bh, 5)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0

  // Border
  ctx.strokeStyle = theme.colors.bubbleBorder + '80'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(bx, by, bw, bh, 5)
  ctx.stroke()

  if (isThought) {
    // Thought bubble circles
    ctx.fillStyle = theme.colors.bubble + 'f0'
    ctx.strokeStyle = theme.colors.bubbleBorder + '80'
    for (let i = 0; i < 3; i++) {
      const cr = 3.5 - i * 0.8
      const cy = by + bh + 4 + i * 5
      const cx = x - 3 + i * 3
      ctx.beginPath()
      ctx.arc(cx, cy, cr, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  } else {
    // Speech tail
    ctx.fillStyle = theme.colors.bubble + 'f0'
    ctx.beginPath()
    ctx.moveTo(x - 5, by + bh)
    ctx.lineTo(x, by + bh + 7)
    ctx.lineTo(x + 5, by + bh)
    ctx.fill()
    // Tail border
    ctx.strokeStyle = theme.colors.bubbleBorder + '80'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x - 5, by + bh)
    ctx.lineTo(x, by + bh + 7)
    ctx.lineTo(x + 5, by + bh)
    ctx.stroke()
  }

  // Text with slight shadow
  ctx.fillStyle = readableText + '26'
  ctx.textAlign = 'center'
  ctx.fillText(text.slice(0, 26), x + 0.5, by + bh * 0.67 + 0.5)
  ctx.fillStyle = readableText
  ctx.fillText(text.slice(0, 26), x, by + bh * 0.67)
  ctx.globalAlpha = 1
}
