// 圖面/照片標註（Procore Drawings markup 的精簡版）:
// 上傳圖面(圖片或 PDF 第一頁)→ 畫框/箭頭/文字(安全橘)→ 輸出合成 JPEG dataURL。
// 座標一律存原圖像素座標(依顯示縮放換算),合成時不失真。
import { useState, useRef, useEffect, useCallback } from 'react'
import { Square, MoveUpRight, Type, Undo2, X } from 'lucide-react'
import { Button } from './ui.jsx'

const STROKE = '#e8630c' // 安全橘:警示=品牌語意

async function fileToImageDataUrl(file) {
  if (file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const page = await pdf.getPage(1)
    const vp = page.getViewport({ scale: 2 })
    const c = document.createElement('canvas')
    c.width = vp.width; c.height = vp.height
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
    return c.toDataURL('image/jpeg', 0.9)
  }
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

export default function MarkupEditor({ title = '圖面標註', initialImage = null, onSave, onClose }) {
  const [img, setImg] = useState(initialImage) // dataURL
  const [dims, setDims] = useState(null)       // 原圖 {w,h}
  const [shapes, setShapes] = useState([])     // {type:'rect'|'arrow'|'text', x1,y1,x2,y2,text}(原圖座標)
  const [tool, setTool] = useState('rect')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const svgRef = useRef(null)

  useEffect(() => {
    if (!img) { setDims(null); return }
    const i = new Image()
    i.onload = () => setDims({ w: i.naturalWidth, h: i.naturalHeight })
    i.src = img
  }, [img])

  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setBusy(true)
    try { setImg(await fileToImageDataUrl(f)); setShapes([]) } catch { alert('讀取檔案失敗（支援圖片與 PDF）') }
    setBusy(false)
  }

  // 顯示座標 → 原圖座標
  const toNatural = useCallback((e) => {
    const r = svgRef.current.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * dims.w,
      y: ((e.clientY - r.top) / r.height) * dims.h,
    }
  }, [dims])

  const down = (e) => {
    if (!dims) return
    const p = toNatural(e)
    if (tool === 'text') {
      const t = window.prompt('標註文字：')
      if (t?.trim()) setShapes((ss) => [...ss, { type: 'text', x1: p.x, y1: p.y, text: t.trim() }])
      return
    }
    setDraft({ type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y })
  }
  const move = (e) => { if (draft) { const p = toNatural(e); setDraft((d) => ({ ...d, x2: p.x, y2: p.y })) } }
  const up = () => {
    if (draft && (Math.abs(draft.x2 - draft.x1) > 4 || Math.abs(draft.y2 - draft.y1) > 4)) setShapes((ss) => [...ss, draft])
    setDraft(null)
  }

  // 線寬/字級跟原圖尺寸走,合成後粗細合理
  const sw = dims ? Math.max(3, dims.w / 300) : 3
  const fs = dims ? Math.max(16, dims.w / 40) : 16

  const renderShape = (s, i) => {
    if (s.type === 'rect') {
      return <rect key={i} x={Math.min(s.x1, s.x2)} y={Math.min(s.y1, s.y2)} width={Math.abs(s.x2 - s.x1)} height={Math.abs(s.y2 - s.y1)}
        fill="none" stroke={STROKE} strokeWidth={sw} />
    }
    if (s.type === 'arrow') {
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), L = sw * 4
      return <g key={i} stroke={STROKE} strokeWidth={sw} fill="none">
        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        <line x1={s.x2} y1={s.y2} x2={s.x2 - L * Math.cos(ang - 0.45)} y2={s.y2 - L * Math.sin(ang - 0.45)} />
        <line x1={s.x2} y1={s.y2} x2={s.x2 - L * Math.cos(ang + 0.45)} y2={s.y2 - L * Math.sin(ang + 0.45)} />
      </g>
    }
    return <text key={i} x={s.x1} y={s.y1} fill={STROKE} fontSize={fs} fontWeight="700"
      style={{ paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: fs / 8 }}>{s.text}</text>
  }

  // 合成:原圖 + 標註 → JPEG dataURL
  const save = async () => {
    setBusy(true)
    const base = new Image()
    await new Promise((res) => { base.onload = res; base.src = img })
    const c = document.createElement('canvas')
    c.width = dims.w; c.height = dims.h
    const g = c.getContext('2d')
    g.drawImage(base, 0, 0)
    g.strokeStyle = STROKE; g.fillStyle = STROKE; g.lineWidth = sw; g.lineCap = 'round'
    for (const s of shapes) {
      if (s.type === 'rect') g.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))
      else if (s.type === 'arrow') {
        const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), L = sw * 4
        g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2)
        g.moveTo(s.x2, s.y2); g.lineTo(s.x2 - L * Math.cos(ang - 0.45), s.y2 - L * Math.sin(ang - 0.45))
        g.moveTo(s.x2, s.y2); g.lineTo(s.x2 - L * Math.cos(ang + 0.45), s.y2 - L * Math.sin(ang + 0.45))
        g.stroke()
      } else {
        g.font = `700 ${fs}px "Noto Sans TC", sans-serif`
        g.strokeStyle = '#ffffff'; g.lineWidth = fs / 8; g.strokeText(s.text, s.x1, s.y1)
        g.fillText(s.text, s.x1, s.y1); g.strokeStyle = STROKE; g.lineWidth = sw
      }
    }
    setBusy(false)
    onSave(c.toDataURL('image/jpeg', 0.85))
  }

  const toolBtn = (t, Icon, label) => (
    <button onClick={() => setTool(t)} title={label}
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition ${
        tool === t ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
      <Icon size={14} aria-hidden />{label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4 print:hidden" onClick={onClose}>
      <div className="bg-[var(--surface)] rounded-lg g-elevation-2 w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-2)]">
          <h3 className="font-semibold text-[13px] tracking-wide text-[var(--text)]">{title}</h3>
          <button onClick={onClose} aria-label="關閉" className="text-[var(--text-3)] hover:text-[var(--text)]"><X size={17} aria-hidden /></button>
        </div>
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-[var(--border-2)]">
          <label className="inline-flex items-center text-xs font-medium rounded-md px-2.5 py-1.5 border border-[var(--border)] cursor-pointer hover:bg-[var(--surface-2)] text-[var(--blue)]">
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={onFile} />
            {img ? '換一張圖' : '選擇圖面 / 照片（含 PDF）'}
          </label>
          {img && <>
            {toolBtn('rect', Square, '方框')}
            {toolBtn('arrow', MoveUpRight, '箭頭')}
            {toolBtn('text', Type, '文字')}
            <button onClick={() => setShapes((ss) => ss.slice(0, -1))} disabled={!shapes.length} title="復原"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] disabled:opacity-40"><Undo2 size={14} aria-hidden />復原</button>
            <span className="text-[11px] text-[var(--text-3)] ml-auto">在圖上拖曳畫{tool === 'rect' ? '框' : tool === 'arrow' ? '箭頭' : '（點一下輸入文字）'}</span>
          </>}
        </div>
        <div className="flex-1 overflow-auto p-4 bg-[var(--surface-2)]">
          {!img ? (
            <div className="text-center text-sm text-[var(--text-3)] py-16">選擇一張圖面截圖、現場照片或 PDF（取第 1 頁），把有問題的位置匡起來。</div>
          ) : dims && (
            <div className="relative mx-auto" style={{ maxWidth: '100%', width: 'fit-content' }}>
              <img src={img} alt="待標註圖面" className="max-w-full h-auto block select-none" draggable={false} />
              <svg ref={svgRef} viewBox={`0 0 ${dims.w} ${dims.h}`}
                className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
                {shapes.map(renderShape)}
                {draft && renderShape(draft, 'draft')}
              </svg>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-[var(--border-2)]">
          <button onClick={onClose} className="text-sm text-[var(--text-3)] hover:underline">取消</button>
          <Button onClick={save} disabled={!img || busy}>{busy ? '處理中…' : `儲存標註（${shapes.length} 個記號）`}</Button>
        </div>
      </div>
    </div>
  )
}

// 標註縮圖:demo 存 dataURL 直接顯示;真專案存 storage path → 簽名 URL
export function MarkupThumb({ src, resolve, className = '' }) {
  const [url, setUrl] = useState(src?.startsWith('data:') ? src : null)
  useEffect(() => {
    let on = true
    if (src && !src.startsWith('data:') && resolve) resolve(src).then((u) => { if (on) setUrl(u) })
    return () => { on = false }
  }, [src, resolve])
  const [open, setOpen] = useState(false)
  if (!src) return null
  return (
    <>
      <button onClick={() => setOpen(true)} title="檢視圖面標註" className={`block border border-[var(--border)] rounded overflow-hidden hover:opacity-80 ${className}`}>
        {url ? <img src={url} alt="圖面標註" className="h-14 w-20 object-cover" /> : <span className="h-14 w-20 flex items-center justify-center text-[10px] text-[var(--text-3)]">載入中</span>}
      </button>
      {open && url && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6 print:hidden" onClick={() => setOpen(false)}>
          <img src={url} alt="圖面標註" className="max-w-full max-h-full rounded shadow-2xl" />
        </div>
      )}
    </>
  )
}
