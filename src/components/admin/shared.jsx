import { Card, SkeletonList, THEAD_CLS } from '../ui.jsx'

export const CATEGORY_LABEL = {
  agent: 'Agent 對話', document: '讀文件', draft: '產草稿',
  vision: '看照片', integration: '外部介接', automation: '排程',
}
export const PLAN_LABEL = { trial: '試用', standard: '標準', pro: '專業' }
export const PLAN_COLOR = { trial: 'slate', standard: 'blue', pro: 'purple' }
export const fmtInt = (n) => (Number(n) || 0).toLocaleString('en-US')
export const fmtUsd = (n) => {
  const v = Number(n) || 0
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export const TH = `${THEAD_CLS} text-left py-2 px-3 whitespace-nowrap`
export const THR = `${THEAD_CLS} text-right py-2 px-3 whitespace-nowrap`
export const TD = 'py-2 px-3 text-body'
export const TDR = 'py-2 px-3 text-body text-right num whitespace-nowrap'
export const TR = 'border-b border-[var(--border-2)] last:border-0 hover:bg-[var(--surface-2)]'
export const LoadingCard = () => <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} /></Card>
