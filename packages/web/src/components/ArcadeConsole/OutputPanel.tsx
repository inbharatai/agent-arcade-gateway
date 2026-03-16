'use client'

import { useState } from 'react'

interface OutputPanelProps {
  lastResponse: string
  isVisible: boolean
  onClose: () => void
}

type Tab = 'code' | 'diff' | 'files'

function extractCodeBlocks(text: string): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = []
  const regex = /```(\w*)\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match[2].trim()) blocks.push({ lang: match[1] || 'text', code: match[2] })
  }
  return blocks
}

function extractFiles(text: string): string[] {
  const paths = new Set<string>()
  const patterns = [
    /(?:file:|path:|in\s+|create\s+|edit\s+|update\s+)([./\w-]+\.[a-zA-Z]{2,5})/gi,
    /`([./\w-]+\.[a-zA-Z]{2,5})`/g,
  ]
  for (const pattern of patterns) {
    let m
    while ((m = pattern.exec(text)) !== null) {
      if (m[1] && !m[1].startsWith('http')) paths.add(m[1])
    }
  }
  return Array.from(paths)
}

export function OutputPanel({ lastResponse, isVisible, onClose }: OutputPanelProps) {
  const [tab, setTab] = useState<Tab>('code')
  const [selectedBlock, setSelectedBlock] = useState(0)

  if (!isVisible || !lastResponse) return null

  const codeBlocks = extractCodeBlocks(lastResponse)
  const files = extractFiles(lastResponse)
  const selectedCode = codeBlocks[selectedBlock]

  const copyCode = (code: string) => navigator.clipboard.writeText(code)
  const downloadCode = (code: string, lang: string) => {
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `code.${lang || 'txt'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const TABS: Tab[] = ['code', 'files']

  return (
    <div className="shrink-0 border-t border-white/10 bg-black/20" style={{ maxHeight: '40%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="flex items-center border-b border-white/10 px-3 py-1 shrink-0">
        <div className="flex gap-1 flex-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors capitalize ${tab === t ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}
            >
              {t === 'code' ? `Code (${codeBlocks.length})` : t === 'files' ? `Files (${files.length})` : t}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="text-white/30 hover:text-white/70 text-xs px-2 transition-colors">✕</button>
      </div>

      <div className="overflow-y-auto flex-1">
        {tab === 'code' && (
          <div>
            {codeBlocks.length === 0 ? (
              <div className="p-4 text-xs text-white/30 text-center">No code blocks in last response</div>
            ) : (
              <div>
                {codeBlocks.length > 1 && (
                  <div className="flex gap-1 p-2 flex-wrap">
                    {codeBlocks.map((b, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedBlock(i)}
                        className={`px-2 py-0.5 rounded text-xs ${selectedBlock === i ? 'bg-blue-500/30 text-blue-300' : 'bg-white/5 text-white/50 hover:bg-white/10'}`}
                      >
                        {b.lang || 'code'} #{i + 1}
                      </button>
                    ))}
                  </div>
                )}
                {selectedCode && (
                  <div>
                    <div className="flex items-center justify-between px-3 py-1 bg-white/5 text-xs">
                      <span className="text-white/50 font-mono">{selectedCode.lang}</span>
                      <div className="flex gap-2">
                        <button onClick={() => copyCode(selectedCode.code)} className="text-white/50 hover:text-white transition-colors">📋 Copy</button>
                        <button onClick={() => downloadCode(selectedCode.code, selectedCode.lang)} className="text-white/50 hover:text-white transition-colors">⬇ Download</button>
                      </div>
                    </div>
                    <pre className="p-3 text-xs font-mono text-green-300 overflow-x-auto leading-relaxed bg-black/20">
                      <code>{selectedCode.code}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'files' && (
          <div className="p-3">
            {files.length === 0 ? (
              <div className="text-xs text-white/30 text-center py-4">No file paths detected in last response</div>
            ) : (
              <div className="space-y-1">
                {files.map(f => (
                  <div key={f} className="flex items-center gap-2 px-3 py-2 rounded bg-white/5 text-xs font-mono text-white/70 hover:bg-white/8 cursor-default">
                    <span>📄</span>
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
