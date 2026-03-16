// AES-256-GCM encryption using Web Crypto API — no external deps

const KEY_PREFIX = 'arcade-key-'
const PBKDF2_ITERATIONS = 100_000

/** Derive a device fingerprint string from browser environment */
function getDeviceFingerprint(): string {
  if (typeof window === 'undefined') return 'server-side-fallback'
  const parts = [
    navigator.userAgent,
    `${screen.width}x${screen.height}`,
    `${screen.colorDepth}`,
    navigator.language,
    new Date().getTimezoneOffset().toString(),
  ]
  return parts.join('|')
}

/** Hash the fingerprint to use as PBKDF2 password */
async function fingerprintToKey(fingerprint: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const rawKey = enc.encode(fingerprint)

  // Import raw bytes as a base key for PBKDF2
  const baseKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  // Use a fixed salt derived from app name
  const salt = enc.encode('agent-arcade-v3-salt')

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Encode ArrayBuffer to base64 string */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Decode base64 string to Uint8Array */
function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string: IV (12 bytes) + ciphertext.
 */
export async function encryptApiKey(plaintext: string): Promise<string> {
  const key = await fingerprintToKey(getDeviceFingerprint())
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  )
  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.byteLength)
  return bufferToBase64(combined.buffer)
}

/**
 * Decrypt a base64-encoded ciphertext (IV + ciphertext) using AES-256-GCM.
 * Returns the plaintext string.
 */
export async function decryptApiKey(ciphertext: string): Promise<string> {
  const key = await fingerprintToKey(getDeviceFingerprint())
  const combined = base64ToBuffer(ciphertext)
  const iv = combined.slice(0, 12)
  const data = combined.slice(12)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  )
  return new TextDecoder().decode(decrypted)
}

/** Save an API key encrypted in localStorage under `arcade-key-{provider}` */
export async function saveEncryptedApiKey(provider: string, key: string): Promise<void> {
  if (typeof window === 'undefined') return
  const encrypted = await encryptApiKey(key)
  localStorage.setItem(`${KEY_PREFIX}${provider}`, encrypted)
}

/** Load and decrypt an API key from localStorage. Returns null if not found or decryption fails. */
export async function loadDecryptedApiKey(provider: string): Promise<string | null> {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(`${KEY_PREFIX}${provider}`)
  if (!stored) return null
  try {
    return await decryptApiKey(stored)
  } catch {
    return null
  }
}

/** Remove a single provider's encrypted API key from localStorage */
export async function clearApiKey(provider: string): Promise<void> {
  if (typeof window === 'undefined') return
  localStorage.removeItem(`${KEY_PREFIX}${provider}`)
}

/** Remove all encrypted API keys stored by Agent Arcade */
export async function clearAllApiKeys(): Promise<void> {
  if (typeof window === 'undefined') return
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(KEY_PREFIX)) keysToRemove.push(k)
  }
  for (const k of keysToRemove) localStorage.removeItem(k)
}
