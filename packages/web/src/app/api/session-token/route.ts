import { createHmac, randomUUID } from 'crypto'
import { SignJWT } from 'jose'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const jwtSecret = process.env.GATEWAY_JWT_SECRET || process.env.JWT_SECRET || ''
  const isProduction = process.env.NODE_ENV === 'production'
  const sessionId = process.env.NEXT_PUBLIC_DEFAULT_SESSION_ID || 'copilot-live'
  const role = (process.env.NEXT_PUBLIC_CLIENT_ROLE || 'viewer') as 'viewer' | 'publisher'
  const ttlSec = Number.parseInt(process.env.SESSION_TOKEN_TTL_SEC || '3600', 10)

  if (!jwtSecret && isProduction) {
    return NextResponse.json({ error: 'JWT secret not configured' }, { status: 500 })
  }

  // Plug-and-play local dev mode: when gateway auth is disabled and no JWT secret
  // is configured, still issue session metadata so the UI can initialize.
  if (!jwtSecret && !isProduction) {
    const devSignature = createHmac('sha256', process.env.SESSION_SIGNING_SECRET || 'agent-arcade-dev-signing')
      .update(sessionId)
      .digest('hex')

    return NextResponse.json({
      token: '',
      sessionId,
      sessionSignature: devSignature,
      expiresInSec: Math.max(60, ttlSec),
      authMode: 'dev-no-auth',
    })
  }

  const now = Date.now()
  const signature = createHmac('sha256', process.env.SESSION_SIGNING_SECRET || jwtSecret)
    .update(sessionId)
    .digest('hex')

  const token = await new SignJWT({
    role,
    sessions: [sessionId],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`web-client-${randomUUID()}`)
    .setJti(randomUUID())
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(`${Math.max(60, ttlSec)}s`)
    .sign(new TextEncoder().encode(jwtSecret))

  return NextResponse.json({
    token,
    sessionId,
    sessionSignature: signature,
    expiresInSec: Math.max(60, ttlSec),
  })
}
