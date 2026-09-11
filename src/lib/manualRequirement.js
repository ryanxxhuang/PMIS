// 手動補登的初值與期限欄位轉換；人工確認仍走 review_requirement RPC。
export const MANUAL_BLANK = {
  title: '', description: '', requirement_type: 'deadline',
  responsible_party_type: '', lifecycle_phase: '施工中',
  dueMode: 'relative', trigger_event: 'commencement', offset_days: '', offset_dir: 'after',
  fixed_date: '', monthly_day: '',
  // 循環時點(頻率值域對齊 requirementExtraction.ts 的 FREQUENCY_TYPES)
  weekly_weekday: '1', freq_month: '', freq_day: '',
  acceptance_criteria: '', source_clause: '', source_page: '',
  contract_package_id: '',
}

export function manualRequirementTiming(d) {
  let trigger_type = null
  let trigger_config = {}
  let frequency_type = null
  let frequency_config = {}
  if (d.dueMode === 'relative') {
    trigger_type = d.trigger_event
    const days = Number(d.offset_days)
    if (!(Number.isInteger(days) && days > 0)) { return { error: '期限天數需為正整數' } }
    trigger_config = { offset_days: days, offset_dir: d.offset_dir }
  } else if (d.dueMode === 'fixed') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fixed_date)) { return { error: '請選擇指定日期' } }
    trigger_type = 'fixed'
    trigger_config = { fixed_date: d.fixed_date }
  } else if (d.dueMode === 'monthly') {
    const day = Number(d.monthly_day)
    if (!(Number.isInteger(day) && day >= 1 && day <= 31)) { return { error: '每月幾號需為 1~31' } }
    trigger_type = 'monthly'
    frequency_type = 'monthly'
    frequency_config = { day }
  } else if (d.dueMode === 'daily') {
    frequency_type = 'daily'
  } else if (d.dueMode === 'weekly') {
    const weekday = Number(d.weekly_weekday)
    if (!(Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)) { return { error: '請選擇每週星期幾' } }
    frequency_type = 'weekly'
    frequency_config = { weekday }
  } else if (d.dueMode === 'quarterly' || d.dueMode === 'yearly') {
    // 頻率 config 值域對齊抽取引擎:quarterly 的 month=季內第幾個月(1~3)、
    // yearly 的 month=幾月(1~12);day 都是幾日(1~31)
    const month = Number(d.freq_month)
    const day = Number(d.freq_day)
    const monthMax = d.dueMode === 'quarterly' ? 3 : 12
    if (!(Number.isInteger(month) && month >= 1 && month <= monthMax)) {
      return { error: d.dueMode === 'quarterly' ? '每季第幾個月需為 1~3' : '每年幾月需為 1~12' }
    }
    if (!(Number.isInteger(day) && day >= 1 && day <= 31)) { return { error: '幾日需為 1~31' } }
    frequency_type = d.dueMode
    frequency_config = { month, day }
  } else if (d.requirement_type === 'deadline') {
    // 期限型沒有時點就物化不出到期日,擋在前端(伺服器不會擋,但那是一筆廢資料)
    return { error: '期限型契約重點需要一個時點(相對基準日/指定日期/循環)' }
  }
  return { trigger_type, trigger_config, frequency_type, frequency_config }
}
