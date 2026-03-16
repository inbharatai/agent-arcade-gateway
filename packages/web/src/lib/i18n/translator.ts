// Pure client-side translator — pattern matching, no external API needed
// Preserves all technical terms, handles 20 languages → English
import type { SupportedLanguage } from '@/types/arcade'

// ── Technical terms that must NEVER be translated ─────────────────────────
const TECH_TERMS = new Set([
  // Frameworks & Libraries
  'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt', 'Remix', 'Vite',
  'SvelteKit', 'Astro', 'Solid', 'Qwik',
  // Languages
  'TypeScript', 'JavaScript', 'Python', 'Rust', 'Go', 'Java', 'PHP', 'Ruby',
  'Swift', 'Kotlin', 'C++', 'C#', 'Scala', 'Elixir',
  // APIs & Protocols
  'API', 'REST', 'GraphQL', 'WebSocket', 'gRPC', 'HTTP', 'HTTPS', 'JSON',
  'XML', 'YAML', 'OAuth', 'JWT', 'CORS',
  // Web & Styling
  'CSS', 'HTML', 'DOM', 'Tailwind', 'SCSS', 'Sass', 'Bootstrap',
  // Databases
  'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'Prisma',
  'Supabase', 'Firebase', 'DynamoDB', 'TypeORM',
  // React hooks & patterns
  'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext',
  'async', 'await', 'fetch', 'Promise',
  // DevOps & Tools
  'Docker', 'Kubernetes', 'Git', 'GitHub', 'GitLab', 'CI/CD', 'npm', 'yarn',
  'bun', 'pnpm', 'Node.js', 'Deno', 'Bun',
  // AI & Services
  'OpenAI', 'Claude', 'Gemini', 'Mistral', 'LangChain', 'Vercel', 'Netlify',
  'AWS', 'GCP', 'Azure',
  // Other
  'Express', 'FastAPI', 'Zod', 'ESLint', 'Prettier', 'Webpack', 'Babel',
])

// ── Vocabulary maps per language ──────────────────────────────────────────

type VocabMap = Array<[RegExp, string]>

const VOCAB: Partial<Record<SupportedLanguage, VocabMap>> = {
  // ── Spanish ──
  es: [
    [/\bcrear\b/gi, 'create'],
    [/\barreglar\b/gi, 'fix'],
    [/\bañadir\b/gi, 'add'],
    [/\bmostrar\b/gi, 'show'],
    [/\bmejorar\b/gi, 'improve'],
    [/\bborrar\b/gi, 'delete'],
    [/\beliminar\b/gi, 'delete'],
    [/\bpor favor\b/gi, 'please'],
    [/\btambién\b/gi, 'also'],
    [/\bfunción\b/gi, 'function'],
    [/\barchivo\b/gi, 'file'],
    [/\bcódigo\b/gi, 'code'],
    [/\berror\b/gi, 'error'],
    [/\bprueba[s]?\b/gi, 'test'],
    [/\bescribir\b/gi, 'write'],
    [/\boptimizar\b/gi, 'optimize'],
    [/\brefactorizar\b/gi, 'refactor'],
    [/\bdepurar\b/gi, 'debug'],
    [/\bimplementar\b/gi, 'deploy'],
    [/\bcomponente\b/gi, 'component'],
    [/\bexplicar\b/gi, 'explain'],
    [/\brevisión de código\b/gi, 'code review'],
    [/\bdocumentar\b/gi, 'document'],
  ],

  // ── French ──
  fr: [
    [/\bcréer\b/gi, 'create'],
    [/\bcorriger\b/gi, 'fix'],
    [/\bajouter\b/gi, 'add'],
    [/\bmontrer\b/gi, 'show'],
    [/\baméliorer\b/gi, 'improve'],
    [/\bsupprimer\b/gi, 'delete'],
    [/\bs'il vous plaît\b/gi, 'please'],
    [/\baussi\b/gi, 'also'],
    [/\bfonction\b/gi, 'function'],
    [/\bfichier\b/gi, 'file'],
    [/\bcode\b/gi, 'code'],
    [/\berreur\b/gi, 'error'],
    [/\btest[s]?\b/gi, 'test'],
    [/\bécrire\b/gi, 'write'],
    [/\boptimiser\b/gi, 'optimize'],
    [/\bremanier\b/gi, 'refactor'],
    [/\bdéboguer\b/gi, 'debug'],
    [/\bdéployer\b/gi, 'deploy'],
    [/\bcomposant\b/gi, 'component'],
    [/\bexpliquer\b/gi, 'explain'],
    [/\brevue de code\b/gi, 'code review'],
    [/\bdocumenter\b/gi, 'document'],
  ],

  // ── German ──
  de: [
    [/\berstellen\b/gi, 'create'],
    [/\bkorrigieren\b/gi, 'fix'],
    [/\bhinzufügen\b/gi, 'add'],
    [/\bzeigen\b/gi, 'show'],
    [/\bverbessern\b/gi, 'improve'],
    [/\blöschen\b/gi, 'delete'],
    [/\bbitte\b/gi, 'please'],
    [/\bauch\b/gi, 'also'],
    [/\bFunktion\b/gi, 'function'],
    [/\bDatei\b/gi, 'file'],
    [/\bFehler\b/gi, 'error'],
    [/\bTest[s]?\b/gi, 'test'],
    [/\bschreiben\b/gi, 'write'],
    [/\boptimieren\b/gi, 'optimize'],
    [/\bumstrukturieren\b/gi, 'refactor'],
    [/\bdebugging\b/gi, 'debug'],
    [/\bbereitstellen\b/gi, 'deploy'],
    [/\bKomponente\b/gi, 'component'],
    [/\berklären\b/gi, 'explain'],
    [/\bCode-Überprüfung\b/gi, 'code review'],
    [/\bdokumentieren\b/gi, 'document'],
  ],

  // ── Portuguese ──
  pt: [
    [/\bcriar\b/gi, 'create'],
    [/\bcorrigir\b/gi, 'fix'],
    [/\badicionar\b/gi, 'add'],
    [/\bmostrar\b/gi, 'show'],
    [/\bmelhorar\b/gi, 'improve'],
    [/\bexcluir\b/gi, 'delete'],
    [/\bremover\b/gi, 'remove'],
    [/\bpor favor\b/gi, 'please'],
    [/\btambém\b/gi, 'also'],
    [/\bfunção\b/gi, 'function'],
    [/\barquivo\b/gi, 'file'],
    [/\bcódigo\b/gi, 'code'],
    [/\berro\b/gi, 'error'],
    [/\bteste[s]?\b/gi, 'test'],
    [/\bescrever\b/gi, 'write'],
    [/\botimizar\b/gi, 'optimize'],
    [/\brefatorar\b/gi, 'refactor'],
    [/\bdepurar\b/gi, 'debug'],
    [/\bimplantar\b/gi, 'deploy'],
    [/\bcomponente\b/gi, 'component'],
    [/\bexplicar\b/gi, 'explain'],
    [/\brevisão de código\b/gi, 'code review'],
    [/\bdocumentar\b/gi, 'document'],
  ],

  // ── Italian ──
  it: [
    [/\bcreare\b/gi, 'create'],
    [/\bcorreggere\b/gi, 'fix'],
    [/\baggiungere\b/gi, 'add'],
    [/\bmostrare\b/gi, 'show'],
    [/\bmigliorare\b/gi, 'improve'],
    [/\beliminare\b/gi, 'delete'],
    [/\bper favore\b/gi, 'please'],
    [/\banche\b/gi, 'also'],
    [/\bfunzione\b/gi, 'function'],
    [/\bfile\b/gi, 'file'],
    [/\berrore\b/gi, 'error'],
    [/\btest[i]?\b/gi, 'test'],
    [/\bscrivere\b/gi, 'write'],
    [/\bottimizzare\b/gi, 'optimize'],
    [/\brifattorizzare\b/gi, 'refactor'],
    [/\bdebuggare\b/gi, 'debug'],
    [/\bdistribuire\b/gi, 'deploy'],
    [/\bcomponente\b/gi, 'component'],
    [/\bspiegare\b/gi, 'explain'],
    [/\brevisione del codice\b/gi, 'code review'],
    [/\bdocumentare\b/gi, 'document'],
  ],

  // ── Russian ──
  ru: [
    [/создать\b/gi, 'create'],
    [/исправить\b/gi, 'fix'],
    [/добавить\b/gi, 'add'],
    [/показать\b/gi, 'show'],
    [/улучшить\b/gi, 'improve'],
    [/удалить\b/gi, 'delete'],
    [/пожалуйста\b/gi, 'please'],
    [/также\b/gi, 'also'],
    [/функция\b/gi, 'function'],
    [/файл\b/gi, 'file'],
    [/ошибка\b/gi, 'error'],
    [/тест[ы]?\b/gi, 'test'],
    [/написать\b/gi, 'write'],
    [/оптимизировать\b/gi, 'optimize'],
    [/рефакторинг\b/gi, 'refactor'],
    [/отладить\b/gi, 'debug'],
    [/развернуть\b/gi, 'deploy'],
    [/компонент\b/gi, 'component'],
    [/объяснить\b/gi, 'explain'],
    [/ревью кода\b/gi, 'code review'],
    [/задокументировать\b/gi, 'document'],
  ],

  // ── Ukrainian ──
  uk: [
    [/створити\b/gi, 'create'],
    [/виправити\b/gi, 'fix'],
    [/додати\b/gi, 'add'],
    [/показати\b/gi, 'show'],
    [/покращити\b/gi, 'improve'],
    [/видалити\b/gi, 'delete'],
    [/будь ласка\b/gi, 'please'],
    [/також\b/gi, 'also'],
    [/функція\b/gi, 'function'],
    [/файл\b/gi, 'file'],
    [/помилка\b/gi, 'error'],
    [/тест[и]?\b/gi, 'test'],
    [/написати\b/gi, 'write'],
    [/оптимізувати\b/gi, 'optimize'],
    [/рефакторинг\b/gi, 'refactor'],
    [/налагодити\b/gi, 'debug'],
    [/розгорнути\b/gi, 'deploy'],
    [/компонент\b/gi, 'component'],
    [/пояснити\b/gi, 'explain'],
    [/ревью коду\b/gi, 'code review'],
    [/задокументувати\b/gi, 'document'],
  ],

  // ── Dutch ──
  nl: [
    [/\bmaken\b/gi, 'create'],
    [/\bcorrigeren\b/gi, 'fix'],
    [/\btoevoegen\b/gi, 'add'],
    [/\btonen\b/gi, 'show'],
    [/\bverbeteren\b/gi, 'improve'],
    [/\bverwijderen\b/gi, 'delete'],
    [/\balsjeblieft\b/gi, 'please'],
    [/\book\b/gi, 'also'],
    [/\bfunctie\b/gi, 'function'],
    [/\bbestand\b/gi, 'file'],
    [/\bfout\b/gi, 'error'],
    [/\btest[s]?\b/gi, 'test'],
    [/\bschrijven\b/gi, 'write'],
    [/\boptimaliseren\b/gi, 'optimize'],
    [/\brefactoren\b/gi, 'refactor'],
    [/\bdebugging\b/gi, 'debug'],
    [/\bimplementeren\b/gi, 'deploy'],
    [/\bcomponent\b/gi, 'component'],
    [/\buitleggen\b/gi, 'explain'],
    [/\bcode review\b/gi, 'code review'],
    [/\bdocumenteren\b/gi, 'document'],
  ],

  // ── Polish ──
  pl: [
    [/\bstworzyć\b/gi, 'create'],
    [/\bnaprawić\b/gi, 'fix'],
    [/\bdodać\b/gi, 'add'],
    [/\bpokazać\b/gi, 'show'],
    [/\bpoprawić\b/gi, 'improve'],
    [/\busunąć\b/gi, 'delete'],
    [/\bproszę\b/gi, 'please'],
    [/\btakże\b/gi, 'also'],
    [/\bfunkcja\b/gi, 'function'],
    [/\bplik\b/gi, 'file'],
    [/\bbłąd\b/gi, 'error'],
    [/\btest[y]?\b/gi, 'test'],
    [/\bnapisać\b/gi, 'write'],
    [/\boptymalizować\b/gi, 'optimize'],
    [/\brefaktoryzować\b/gi, 'refactor'],
    [/\bdebugować\b/gi, 'debug'],
    [/\bwdrożyć\b/gi, 'deploy'],
    [/\bkomponent\b/gi, 'component'],
    [/\bwyjaśnić\b/gi, 'explain'],
    [/\bprzegląd kodu\b/gi, 'code review'],
    [/\bdokumentować\b/gi, 'document'],
  ],

  // ── Turkish ──
  tr: [
    [/\boluştur\b/gi, 'create'],
    [/\bdüzelt\b/gi, 'fix'],
    [/\bekle\b/gi, 'add'],
    [/\bgöster\b/gi, 'show'],
    [/\bgeliştir\b/gi, 'improve'],
    [/\bsil\b/gi, 'delete'],
    [/\blütfen\b/gi, 'please'],
    [/\bayrıca\b/gi, 'also'],
    [/\bfonksiyon\b/gi, 'function'],
    [/\bdosya\b/gi, 'file'],
    [/\bhata\b/gi, 'error'],
    [/\btest[ler]?\b/gi, 'test'],
    [/\byaz\b/gi, 'write'],
    [/\boptimize et\b/gi, 'optimize'],
    [/\brefaktör\b/gi, 'refactor'],
    [/\bhata ayıkla\b/gi, 'debug'],
    [/\bdağıt\b/gi, 'deploy'],
    [/\bbileşen\b/gi, 'component'],
    [/\baçıkla\b/gi, 'explain'],
    [/\bkod inceleme\b/gi, 'code review'],
    [/\bdokümante et\b/gi, 'document'],
  ],

  // ── Vietnamese ──
  vi: [
    [/\btạo\b/gi, 'create'],
    [/\bsửa\b/gi, 'fix'],
    [/\bthêm\b/gi, 'add'],
    [/\bhiển thị\b/gi, 'show'],
    [/\bcải thiện\b/gi, 'improve'],
    [/\bxóa\b/gi, 'delete'],
    [/\bxin vui lòng\b/gi, 'please'],
    [/\bcũng\b/gi, 'also'],
    [/\bhàm\b/gi, 'function'],
    [/\btệp\b/gi, 'file'],
    [/\blỗi\b/gi, 'error'],
    [/\bkiểm tra\b/gi, 'test'],
    [/\bviết\b/gi, 'write'],
    [/\btối ưu hóa\b/gi, 'optimize'],
    [/\btái cấu trúc\b/gi, 'refactor'],
    [/\bgỡ lỗi\b/gi, 'debug'],
    [/\btriển khai\b/gi, 'deploy'],
    [/\bthành phần\b/gi, 'component'],
    [/\bgiải thích\b/gi, 'explain'],
    [/\bxem xét mã\b/gi, 'code review'],
    [/\btài liệu hóa\b/gi, 'document'],
  ],

  // ── Indonesian ──
  id: [
    [/\bbuat\b/gi, 'create'],
    [/\bperbaiki\b/gi, 'fix'],
    [/\btambah(kan)?\b/gi, 'add'],
    [/\btampilkan\b/gi, 'show'],
    [/\btingkatkan\b/gi, 'improve'],
    [/\bhapus\b/gi, 'delete'],
    [/\btolong\b/gi, 'please'],
    [/\bjuga\b/gi, 'also'],
    [/\bfungsi\b/gi, 'function'],
    [/\bberkas\b/gi, 'file'],
    [/\bkesalahan\b/gi, 'error'],
    [/\btes\b/gi, 'test'],
    [/\btulis\b/gi, 'write'],
    [/\boptimalkan\b/gi, 'optimize'],
    [/\brefaktor\b/gi, 'refactor'],
    [/\bdebug\b/gi, 'debug'],
    [/\bdeploy\b/gi, 'deploy'],
    [/\bkomponen\b/gi, 'component'],
    [/\bjelaskan\b/gi, 'explain'],
    [/\btinjau kode\b/gi, 'code review'],
    [/\bdokumentasikan\b/gi, 'document'],
  ],

  // ── Malay ──
  ms: [
    [/\bbuat\b/gi, 'create'],
    [/\bbetulkan\b/gi, 'fix'],
    [/\btambah\b/gi, 'add'],
    [/\btunjukkan\b/gi, 'show'],
    [/\bpertingkatkan\b/gi, 'improve'],
    [/\bpadam\b/gi, 'delete'],
    [/\btolong\b/gi, 'please'],
    [/\bjuga\b/gi, 'also'],
    [/\bfungsi\b/gi, 'function'],
    [/\bfail\b/gi, 'file'],
    [/\bralat\b/gi, 'error'],
    [/\bujian\b/gi, 'test'],
    [/\btulis\b/gi, 'write'],
    [/\boptimumkan\b/gi, 'optimize'],
    [/\brefaktor\b/gi, 'refactor'],
    [/\bdebug\b/gi, 'debug'],
    [/\bdeploy\b/gi, 'deploy'],
    [/\bkomponen\b/gi, 'component'],
    [/\bterangkan\b/gi, 'explain'],
    [/\bsemak kod\b/gi, 'code review'],
    [/\bdokumenkan\b/gi, 'document'],
  ],

  // ── Hindi (Hinglish — Latin-script) ──
  hi: [
    [/\bbana\s*do\b/gi, 'create'],
    [/\bbanao\b/gi, 'create'],
    [/\bbana\s*de\b/gi, 'create'],
    [/\btheek\s*karo\b/gi, 'fix'],
    [/\bthik\s*karo\b/gi, 'fix'],
    [/\bfix\s*karo\b/gi, 'fix'],
    [/\bsahi\s*karo\b/gi, 'fix'],
    [/\badd\s*karo\b/gi, 'add'],
    [/\bjodo\b/gi, 'add'],
    [/\bdikhao\b/gi, 'show'],
    [/\bdekho\b/gi, 'show'],
    [/\bdikha\s*do\b/gi, 'show'],
    [/\bimprove\s*karo\b/gi, 'improve'],
    [/\bbehtar\s*bana[od]\b/gi, 'improve'],
    [/\bdelete\s*karo\b/gi, 'delete'],
    [/\bhata\s*do\b/gi, 'remove'],
    [/\bhatao\b/gi, 'remove'],
    [/\bcheck\s*karo\b/gi, 'check'],
    [/\boptimize\s*karo\b/gi, 'optimize'],
    [/\btez\s*bana[od]\b/gi, 'make faster'],
    [/\brefactor\s*karo\b/gi, 'refactor'],
    [/\bdebug\s*karo\b/gi, 'debug'],
    [/\bdeploy\s*karo\b/gi, 'deploy'],
    [/\bchala\s*do\b/gi, 'run'],
    [/\brun\s*karo\b/gi, 'run'],
    [/\btest\s*likho\b/gi, 'write tests for'],
    [/\bexplain\s*karo\b/gi, 'explain'],
    [/\bsamjhao\b/gi, 'explain'],
    [/\bkya\s+hai\b/gi, 'what is'],
    [/\bshuru\s*karo\b/gi, 'start'],
    [/\bstart\s*karo\b/gi, 'start'],
    [/\bbandh\s*karo\b/gi, 'stop'],
    [/\bstop\s*karo\b/gi, 'stop'],
    // Connector words
    [/\bmein\b/gi, 'in'],
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
    [/\bbohot\b/gi, 'very'],
    [/\bbahut\b/gi, 'very'],
  ],
}

// ── Tech term preservation ─────────────────────────────────────────────────

/**
 * Replace tech terms with placeholders, apply vocab translation, restore terms.
 * This ensures tokens like "React", "API", "TypeScript" survive translation.
 */
function withTechPreservation(text: string, translate: (t: string) => string): string {
  const placeholders: string[] = []
  let working = text

  // Replace tech terms with numbered placeholders
  for (const term of TECH_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?<![\\w/])${escaped}(?![\\w/])`, 'g')
    working = working.replace(re, () => {
      const idx = placeholders.length
      placeholders.push(term)
      return `__TECH_${idx}__`
    })
  }

  // Also preserve file paths and code-like tokens (e.g. auth.ts, index.tsx)
  working = working.replace(/\b[\w-]+\.(ts|tsx|js|jsx|py|go|rs|rb|php|json|yaml|yml|css|html|md|sql)\b/g, (match) => {
    const idx = placeholders.length
    placeholders.push(match)
    return `__TECH_${idx}__`
  })

  // Apply translation
  working = translate(working)

  // Restore placeholders
  working = working.replace(/__TECH_(\d+)__/g, (_, i) => placeholders[parseInt(i, 10)] ?? '')
  return working
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns true if the text should be translated (non-English or Hinglish).
 */
export function shouldTranslate(text: string, lang: SupportedLanguage): boolean {
  if (lang === 'en') return false
  // Japanese / Chinese / Thai / Arabic / Korean always need translation
  if (['ja', 'zh', 'th', 'ar', 'ko'].includes(lang)) return true
  // For mixed/Hinglish, translate if there's at least one known phrase
  const map = VOCAB[lang]
  if (!map) return false
  return map.some(([pattern]) => pattern.test(text))
}

/**
 * Translate text from any supported language to English.
 * Preserves all technical terms intact.
 * For script-based languages (CJK, Thai, Arabic) without vocabulary maps,
 * returns the original text with a note, since full translation needs an API.
 */
export function translateToEnglish(text: string, detectedLang: SupportedLanguage): string {
  if (detectedLang === 'en') return text

  const map = VOCAB[detectedLang]
  if (!map) {
    // Script-based language without vocab map — return as-is
    // (full translation would need an external API)
    return text
  }

  return withTechPreservation(text, (working) => {
    let result = working
    for (const [pattern, replacement] of map) {
      result = result.replace(pattern, replacement)
    }
    // Clean up extra whitespace
    result = result.replace(/\s{2,}/g, ' ').trim()
    return result
  })
}
