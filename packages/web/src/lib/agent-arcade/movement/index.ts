/**
 * Grid-based movement & simple pathfinding for Agent Arcade
 *
 * Agents are assigned desk/grid positions and can move between them
 * using deterministic A*-like pathfinding with smooth interpolation.
 */

export interface GridPos { x: number; y: number }

// ── Desk layout ─────────────────────────────────────────────────────────────
export const DESK_POSITIONS: GridPos[] = [
  { x: 3, y: 2 }, { x: 8, y: 2 }, { x: 13, y: 2 },
  { x: 3, y: 5 }, { x: 8, y: 5 }, { x: 13, y: 5 },
  { x: 3, y: 8 }, { x: 8, y: 8 }, { x: 13, y: 8 },
]

/** Assign an agent a desk based on its index */
export function assignDesk(agentIndex: number): GridPos {
  return DESK_POSITIONS[agentIndex % DESK_POSITIONS.length]
}

// ── Pathfinding ─────────────────────────────────────────────────────────────
const GRID_W = 16
const GRID_H = 10

interface PathNode { x: number; y: number; g: number; h: number; parent?: PathNode }

function heuristic(a: GridPos, b: GridPos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

/**
 * Simple A* pathfinding on a 16×10 grid.
 * Returns array of grid positions from start to end (inclusive).
 * Walls occupy row 0 and row 9, col 0 and col 15.
 */
export function findPath(from: GridPos, to: GridPos): GridPos[] {
  if (from.x === to.x && from.y === to.y) return [from]

  const blocked = new Set<string>()
  // Walls
  for (let x = 0; x < GRID_W; x++) { blocked.add(`${x},0`); blocked.add(`${x},${GRID_H - 1}`) }
  for (let y = 0; y < GRID_H; y++) { blocked.add(`0,${y}`); blocked.add(`${GRID_W - 1},${y}`) }
  // Desks occupy their position (agents can still sit at them)
  // We don't block desk tiles since agents sit there

  const open: PathNode[] = [{ ...from, g: 0, h: heuristic(from, to) }]
  const closed = new Set<string>()

  while (open.length > 0) {
    open.sort((a, b) => (a.g + a.h) - (b.g + b.h))
    const current = open.shift()!
    const key = `${current.x},${current.y}`

    if (current.x === to.x && current.y === to.y) {
      // Reconstruct
      const path: GridPos[] = []
      let node: PathNode | undefined = current
      while (node) { path.unshift({ x: node.x, y: node.y }); node = node.parent }
      return path
    }

    closed.add(key)

    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = current.x + dx
      const ny = current.y + dy
      const nk = `${nx},${ny}`
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue
      if (closed.has(nk) || blocked.has(nk)) continue
      const g = current.g + 1
      const existing = open.find(n => n.x === nx && n.y === ny)
      if (existing && existing.g <= g) continue
      if (existing) open.splice(open.indexOf(existing), 1)
      open.push({ x: nx, y: ny, g, h: heuristic({ x: nx, y: ny }, to), parent: current })
    }
  }

  // No path found — just return start→end directly
  return [from, to]
}

// ── Smooth interpolation with easing ────────────────────────────────────────
export interface MovementState {
  path: GridPos[]
  pathIndex: number
  pixelX: number
  pixelY: number
  targetPixelX: number
  targetPixelY: number
  moving: boolean
  speed: number          // pixels per frame
  segStartX: number      // start of current segment (for easing)
  segStartY: number
  segProgress: number    // 0→1 along current segment
  segLength: number
  facing: 'left' | 'right'  // direction character faces
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function createMovementState(pos: GridPos, tileSize: number): MovementState {
  return {
    path: [],
    pathIndex: 0,
    pixelX: pos.x * tileSize,
    pixelY: pos.y * tileSize,
    targetPixelX: pos.x * tileSize,
    targetPixelY: pos.y * tileSize,
    moving: false,
    speed: 2,
    segStartX: pos.x * tileSize,
    segStartY: pos.y * tileSize,
    segProgress: 0,
    segLength: 0,
    facing: 'right',
  }
}

export function startMovement(state: MovementState, path: GridPos[], tileSize: number): void {
  if (path.length < 2) return
  state.path = path
  state.pathIndex = 1
  state.moving = true
  state.segStartX = state.pixelX
  state.segStartY = state.pixelY
  state.targetPixelX = path[1].x * tileSize
  state.targetPixelY = path[1].y * tileSize
  const dx = state.targetPixelX - state.segStartX
  const dy = state.targetPixelY - state.segStartY
  state.segLength = Math.sqrt(dx * dx + dy * dy)
  state.segProgress = 0
  if (dx !== 0) state.facing = dx > 0 ? 'right' : 'left'
}

/**
 * Advance movement by one frame with eased interpolation.
 * Returns true if still moving.
 */
export function tickMovement(state: MovementState, tileSize: number): boolean {
  if (!state.moving) return false

  // Advance progress along segment
  const step = state.segLength > 0 ? state.speed / state.segLength : 1
  state.segProgress = Math.min(1, state.segProgress + step)

  // Apply easing curve
  const t = easeInOutCubic(state.segProgress)
  state.pixelX = state.segStartX + (state.targetPixelX - state.segStartX) * t
  state.pixelY = state.segStartY + (state.targetPixelY - state.segStartY) * t

  if (state.segProgress >= 1) {
    state.pixelX = state.targetPixelX
    state.pixelY = state.targetPixelY
    state.pathIndex++

    if (state.pathIndex >= state.path.length) {
      state.moving = false
      return false
    }

    // Begin next segment
    state.segStartX = state.pixelX
    state.segStartY = state.pixelY
    state.targetPixelX = state.path[state.pathIndex].x * tileSize
    state.targetPixelY = state.path[state.pathIndex].y * tileSize
    const dx = state.targetPixelX - state.segStartX
    const dy = state.targetPixelY - state.segStartY
    state.segLength = Math.sqrt(dx * dx + dy * dy)
    state.segProgress = 0
    if (dx !== 0) state.facing = dx > 0 ? 'right' : 'left'
    return true
  }

  return true
}
