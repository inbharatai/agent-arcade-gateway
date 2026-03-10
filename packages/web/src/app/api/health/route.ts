import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'agent-arcade-web', protocol: 'v1', ts: Date.now() })
}
