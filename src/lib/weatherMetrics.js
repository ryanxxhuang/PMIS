// 報表共用天氣指標(QA 報告 P1-7:施工月報與監造報表對同一筆日誌的雨天認定
// 不一致——月報只看全日欄位,監造報表看上午/下午,上午晴下午陣雨就分家)。
// 定義:雨天=當日任一時段(全日/上午/下午)天氣含「雨」。
// 施工月報、監造報表、AI 助理必須從這裡取數,不得各自實作。
export const isRainyLog = (l) => /雨/.test(`${l?.weather || ''}${l?.weather_am || ''}${l?.weather_pm || ''}`)

export const rainDayCount = (logs = []) => logs.filter(isRainyLog).length
