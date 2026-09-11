import { describe, expect, it } from 'vitest'
import { MANUAL_BLANK, manualRequirementTiming } from './manualRequirement.js'

describe('人工補登時點轉為履約欄位', () => {
  const timing = (fields) => manualRequirementTiming({ ...MANUAL_BLANK, ...fields })
  it.each([
    [{ offset_days: '10', offset_dir: 'before' }, { trigger_type: 'commencement', trigger_config: { offset_days: 10, offset_dir: 'before' }, frequency_type: null, frequency_config: {} }],
    [{ dueMode: 'fixed', fixed_date: '2026-12-31' }, { trigger_type: 'fixed', trigger_config: { fixed_date: '2026-12-31' }, frequency_type: null, frequency_config: {} }],
    [{ dueMode: 'monthly', monthly_day: '31' }, { trigger_type: 'monthly', trigger_config: {}, frequency_type: 'monthly', frequency_config: { day: 31 } }],
    [{ dueMode: 'daily' }, { trigger_type: null, trigger_config: {}, frequency_type: 'daily', frequency_config: {} }],
    [{ dueMode: 'weekly', weekly_weekday: '7' }, { trigger_type: null, trigger_config: {}, frequency_type: 'weekly', frequency_config: { weekday: 7 } }],
    [{ dueMode: 'quarterly', freq_month: '3', freq_day: '1' }, { trigger_type: null, trigger_config: {}, frequency_type: 'quarterly', frequency_config: { month: 3, day: 1 } }],
    [{ dueMode: 'yearly', freq_month: '12', freq_day: '31' }, { trigger_type: null, trigger_config: {}, frequency_type: 'yearly', frequency_config: { month: 12, day: 31 } }],
    [{ dueMode: 'none', requirement_type: 'evidence' }, { trigger_type: null, trigger_config: {}, frequency_type: null, frequency_config: {} }],
  ])('保留基準日與頻率的不同意義 %j', (input, expected) => {
    expect(timing(input)).toEqual(expected)
  })

  it.each([
    { offset_days: '' }, { offset_days: '0' }, { offset_days: '-1' }, { offset_days: '1.5' },
    { dueMode: 'fixed', fixed_date: '' }, { dueMode: 'fixed', fixed_date: '2026/12/31' },
    { dueMode: 'monthly', monthly_day: '32' }, { dueMode: 'monthly', monthly_day: '0' },
    { dueMode: 'weekly', weekly_weekday: '8' }, { dueMode: 'weekly', weekly_weekday: '0' },
    { dueMode: 'quarterly', freq_month: '4', freq_day: '1' },
    { dueMode: 'yearly', freq_month: '13', freq_day: '1' },
    { dueMode: 'yearly', freq_month: '12', freq_day: '0' },
    { dueMode: 'quarterly', freq_month: '1', freq_day: '32' },
    { dueMode: 'none', requirement_type: 'deadline' },
  ])('無效時點阻止送出 %j', (input) => {
    expect(timing(input)).toEqual({ error: expect.any(String) })
  })
})
