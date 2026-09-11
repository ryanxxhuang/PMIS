// UUID 格式驗證。B1 重構前 aiGate / agentTools / agent-run / classify-document /
// extract-requirements 各抄一份同樣的 regex(五份),改一處其他四處不會跟著改;
// 收斂到這裡。純函式、無 runtime 依賴,vitest 可直接測。
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
