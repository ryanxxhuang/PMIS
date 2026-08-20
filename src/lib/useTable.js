// 表格排序/分頁的極簡 hooks(README「表格:排序、篩選、分頁」)。
// 只適用「資料已整批在記憶體」的 client-side 表(Admin 彙總、契約文件清單);
// 伺服器分頁的表(如 Activity 的 range 查詢)只共用 TablePager 皮,不走這裡。
// BOQ/Valuation 的樹狀工項表刻意不套:排序與分頁都會拆散工項父子階層,
// 那兩張表的正確性建立在「整樹依 PCCES 順序渲染」上。
import { useEffect, useMemo, useState } from 'react'

// 排序比較:數字欄先轉數值(Postgres bigint/numeric 經 supabase-js 常是字串,
// 字串比較會把 "9" 排在 "100" 後面);其餘走 localeCompare('zh-Hant'),
// 中文欄位才依語系規則排,不是 Unicode 碼位序。
function compare(a, b, { field, dir, numeric }) {
  const va = a?.[field]
  const vb = b?.[field]
  const d = numeric
    ? (Number(va) || 0) - (Number(vb) || 0)
    : String(va ?? '').localeCompare(String(vb ?? ''), 'zh-Hant')
  return dir === 'desc' ? -d : d
}

// sort = { field, dir: 'asc'|'desc', numeric } | null(null=維持原始順序)。
// toggleSort 給 SortableTh 當 onSort:換欄=asc 起排,同欄=asc/desc 循環。
export function useTableSort(rows, initial = null) {
  const [sort, setSort] = useState(initial)
  const toggleSort = (field, numeric = false) => setSort((s) => ({
    field, numeric, dir: s?.field === field && s.dir === 'asc' ? 'desc' : 'asc',
  }))
  const sorted = useMemo(
    () => (sort ? [...rows].sort((a, b) => compare(a, b, sort)) : rows),
    [rows, sort],
  )
  return { sort, toggleSort, sorted }
}

// pageRows=當頁列;pager 直接展開給 <TablePager {...pager} />。
// rows 一律吃 useMemo 過的陣列:排序/篩選/重載都會換新陣列 identity,
// 靠這個 effect 把頁碼歸回第 1 頁(規格要求),不必每個呼叫端自己重設。
export function usePagination(rows, initialSize = 25) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(initialSize)
  useEffect(() => { setPage(0) }, [rows])
  const total = rows.length
  // effect 歸零前的當幀防呆:資料變少時不渲染一個超出範圍的空頁
  const safePage = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1))
  const pageRows = useMemo(
    () => rows.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [rows, safePage, pageSize],
  )
  const pager = {
    page: safePage,
    pageSize,
    total,
    onPage: setPage,
    onPageSize: (s) => { setPageSize(s); setPage(0) },
  }
  return { pageRows, pager }
}
