// 把表格資料匯出成 CSV 下載。加 UTF-8 BOM 讓 Excel 正確顯示中文。
// rows = 物件陣列;columns = [{ key, label }]。未給 columns 則用第一筆的 keys。

function cell(v) {
  if (v == null) return ''
  let s = String(v)
  // Formula injection 防護(B-14):自由文字若以 = + - @ 開頭,Excel 會當公式執行。
  // 純數字(含負數/小數)不受影響;其餘加 ' 前綴中和(Excel 顯示原文)。
  if (typeof v !== 'number' && /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCsv(filename, rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : [])
  const head = cols.map((c) => cell(c.label)).join(',')
  const body = rows.map((r) => cols.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(',')).join('\n')
  const csv = '﻿' + head + '\n' + body
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// 檔名加日期戳
export const stamp = () => {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
