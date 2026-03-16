// Hinglish → English normalizer
import { detectLanguage } from './detector'

// Technical terms to preserve exactly
const PRESERVE_TERMS = new Set([
  'React', 'Next.js', 'API', 'JWT', 'OAuth', 'SQL', 'CSS', 'HTML', 'TypeScript',
  'JavaScript', 'useState', 'useEffect', 'async', 'await', 'fetch', 'REST',
  'GraphQL', 'WebSocket', 'Docker', 'Kubernetes', 'Node.js', 'Express', 'FastAPI',
  'PostgreSQL', 'MongoDB', 'Redis', 'Tailwind', 'Prisma', 'Supabase', 'Firebase',
  'GitHub', 'Git', 'npm', 'yarn', 'bun', 'pnpm', 'TypeORM', 'Zod', 'OpenAI',
  'Claude', 'Gemini', 'LangChain', 'Python', 'Rust', 'Go', 'Java', 'PHP',
])

// Hinglish word/phrase → English
const REPLACEMENTS: Array<[RegExp, string]> = [
  // Build/Create
  [/\bbana\s*do\b/gi, 'create'],
  [/\bbanao\b/gi, 'create'],
  [/\bbana\s*de\b/gi, 'create'],
  [/\bbanana\s*hai\b/gi, 'create'],
  [/\bnaya\s+bana[od]\b/gi, 'create new'],
  // Fix
  [/\btheek\s*karo\b/gi, 'fix'],
  [/\bthik\s*karo\b/gi, 'fix'],
  [/\bfix\s*karo\b/gi, 'fix'],
  [/\bsahi\s*karo\b/gi, 'fix'],
  [/\bdurست\s*karo\b/gi, 'fix'],
  // Show/Display
  [/\bdikhao\b/gi, 'show'],
  [/\bdekho\b/gi, 'show'],
  [/\bdikha\s*do\b/gi, 'show'],
  // Improve
  [/\bimprove\s*karo\b/gi, 'improve'],
  [/\bbehtar\s*bana[od]\b/gi, 'improve'],
  [/\baur\s*achha\s*bana[od]\b/gi, 'make it better'],
  [/\bclean\s*bana[od]\b/gi, 'make cleaner'],
  // Tests
  [/\btest\s*likho\b/gi, 'write tests for'],
  [/\btests?\s*bana[od]\b/gi, 'create tests for'],
  // Explain
  [/\bexplain\s*karo\b/gi, 'explain'],
  [/\bsamjhao\b/gi, 'explain'],
  [/\bkya\s+hai\b/gi, 'what is'],
  // Delete/Remove
  [/\bdelete\s*karo\b/gi, 'delete'],
  [/\bhata\s*do\b/gi, 'remove'],
  [/\bhatao\b/gi, 'remove'],
  // Add
  [/\badd\s*karo\b/gi, 'add'],
  [/\bjodo\b/gi, 'add'],
  // Check
  [/\bcheck\s*karo\b/gi, 'check'],
  [/\bdekh\s*lo\b/gi, 'check'],
  // Optimize
  [/\boptimize\s*karo\b/gi, 'optimize'],
  [/\btez\s*bana[od]\b/gi, 'make faster'],
  // Refactor
  [/\brefactor\s*karo\b/gi, 'refactor'],
  [/\bsudhar\s*do\b/gi, 'refactor'],
  // Debug
  [/\bdebug\s*karo\b/gi, 'debug'],
  [/\bbug\s*dhundo\b/gi, 'find bugs in'],
  // Deploy
  [/\bdeploy\s*karo\b/gi, 'deploy'],
  [/\bchala\s*do\b/gi, 'run'],
  [/\brun\s*karo\b/gi, 'run'],
  // Start
  [/\bshuru\s*karo\b/gi, 'start'],
  [/\bstart\s*karo\b/gi, 'start'],
  // Stop
  [/\bbandh\s*karo\b/gi, 'stop'],
  [/\bstop\s*karo\b/gi, 'stop'],
  // Connector words
  [/\bmein\b/gi, 'in'],
  [/\b(?<!\w)me\b/gi, 'in'],
  [/\bke\s+saath\b/gi, 'with'],
  [/\bwala\b/gi, ''],
  [/\bwali\b/gi, ''],
  [/\bhai\b/gi, ''],
  [/\bhain\b/gi, ''],
  [/\bka\b/gi, 'of'],
  [/\bki\b/gi, 'of'],
  [/\bko\b/gi, ''],
  [/\bse\b/gi, 'from'],
  [/\baur\b/gi, 'and'],
  [/\bpar\b/gi, 'on'],
  [/\bnahi\b/gi, 'not'],
  [/\bsirf\b/gi, 'only'],
  [/\bbas\b/gi, 'just'],
  [/\babhi\b/gi, 'now'],
  [/\bjaldi\b/gi, 'quickly'],
  [/\bbohot\s+slow\b/gi, 'very slow'],
  [/\bbahut\s+slow\b/gi, 'very slow'],
  [/\bbohot\b/gi, 'very'],
  [/\bbahut\b/gi, 'very'],
]

// Check if text contains any Hinglish patterns (for short inputs that may fool the detector)
function containsHinglishPatterns(text: string): boolean {
  const hinglishWords = /\b(banao|bana\s*do|theek\s*karo|fix\s*karo|dikhao|dikha\s*do|samjhao|kya\s*hai|hata\s*do|hatao|add\s*karo|jodo|check\s*karo|mein|aur|nahi|hai|karo|likho|yeh|mujhe|abhi|jaldi|bohot|bahut|sirf|bas)\b/i
  return hinglishWords.test(text)
}

export function normalizeHinglish(text: string): { normalized: string; wasTranslated: boolean; originalLang: string } {
  const detection = detectLanguage(text)

  // For Devanagari script, return as-is (full transliteration is complex)
  if (['hi', 'mr'].includes(detection.lang) && detection.confidence > 0.7) {
    return { normalized: text, wasTranslated: false, originalLang: detection.label }
  }

  // Skip non-Hinglish text — but always attempt replacement if Hinglish patterns found
  const isHinglish = detection.lang === 'hinglish' || detection.lang === 'hi' || containsHinglishPatterns(text)
  if (!isHinglish) {
    return { normalized: text, wasTranslated: false, originalLang: detection.label }
  }

  // Apply replacements
  let result = text
  for (const [pattern, replacement] of REPLACEMENTS) {
    result = result.replace(pattern, replacement)
  }

  // Clean up extra spaces
  result = result.replace(/\s{2,}/g, ' ').trim()

  const wasTranslated = result.toLowerCase() !== text.toLowerCase()
  return {
    normalized: result,
    wasTranslated,
    originalLang: detection.label,
  }
}

export function getTranslationPreview(original: string, normalized: string): string {
  if (original === normalized) return ''
  return `Sending as: "${normalized}"`
}
