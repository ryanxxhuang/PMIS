import { expect, it } from 'vitest'
import { keepInWorkdir, staleThrowaways, tapResult, throwawayConfig, throwawayId } from './test-pgtap.js'

it('接受完整的 TAP 計畫,也接受 finish() 最後印出計畫', () => {
  expect(tapResult('1..2\nok 1 - 權限\nok 2 - 交易\n', 0).ok).toBe(true)
  expect(tapResult('ok 1 - 權限\n1..1\n', 0).ok).toBe(true)
})
it.each([
  ['', 0], ['1..0', 0], ['1..2\nok 1 - 半途 SQL 失敗', 3],
  ['1..2\nok 1 - 只跑一半', 0], ['1..1\nnot ok 1 - 不該放行', 0],
  ['ok 1 - 沒有計畫', 0], ['1..1\nok 1\nBail out! database broken', 0],
  ['1..1\nok 1\n1..1', 0], ['1..1\nok 1', null],
])('缺測、SQL 錯誤與測試失敗都讓檢查失敗 %j', (output, status) => {
  expect(tapResult(output, status).ok).toBe(false)
})

const toml = [
  '# 註解', 'project_id = "PMIS"', '', '[api]', 'port = 54321', '', '[db]', '# 本機 DB 埠',
  'port = 54322', 'shadow_port = 54320', 'major_version = 17', '', '[db.pooler]', 'port = 54329',
].join('\n')

it('一次性 config 只改 project_id 與 [db] port,其餘(api、shadow、pooler 埠與版本)原樣', () => {
  const out = throwawayConfig(toml, { projectId: 'PMIS_pgtap_42', dbPort: 61000 })
  expect(out).toContain('project_id = "PMIS_pgtap_42"')
  expect(out).toContain('[db]\n# 本機 DB 埠\nport = 61000\nshadow_port = 54320\nmajor_version = 17')
  expect(out).toContain('[api]\nport = 54321')
  expect(out).toContain('[db.pooler]\nport = 54329')
  expect(out).not.toContain('"PMIS"')
})
it('config 缺 project_id 或 [db] port 直接失敗,不默默起錯資料庫', () => {
  expect(() => throwawayConfig('[db]\nport = 1', { projectId: 'x', dbPort: 2 })).toThrow('project_id')
  expect(() => throwawayConfig('project_id = "PMIS"\n[db.pooler]\nport = 1', { projectId: 'x', dbPort: 2 })).toThrow('[db] port')
})

it('一次性 id 帶 pid;容器標籤與 volume 名稱(service 含底線)都認得;只有同專案、pid 已不存在的才算殘留', () => {
  expect(throwawayId('PMIS', 42)).toBe('PMIS_pgtap_42')
  const alive = (pid) => pid === 42
  expect(staleThrowaways(
    ['PMIS_pgtap_42', 'supabase_db_PMIS_pgtap_42', 'PMIS_pgtap_7', 'supabase_db_PMIS_pgtap_7',
      'supabase_edge_runtime_PMIS_pgtap_9', 'PMIS', 'supabase_db_PMIS', 'OTHER_pgtap_9', 'PMIS_pgtap_x', 'PMIS_pgtap_'],
    'PMIS', alive,
  )).toEqual(['PMIS_pgtap_7', 'PMIS_pgtap_9'])
  expect(staleThrowaways(['supabase_db_A.B_pgtap_1'], 'A.B', () => false)).toEqual(['A.B_pgtap_1'])
})

it('臨時工作目錄只帶 CLI 需要的檔案,不帶 functions／tests 與 CLI 自己的狀態', () => {
  expect(['', 'config.toml', 'migrations', 'migrations/1_a.sql', 'seed.sql', 'roles.sql'].every(keepInWorkdir)).toBe(true)
  expect(['functions', 'functions/x/index.ts', 'tests', 'tests/a.sql', '.temp', '.temp/project-ref', '.branches'].some(keepInWorkdir)).toBe(false)
})
