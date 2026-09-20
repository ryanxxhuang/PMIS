// 下載檔名。檔名本身就是一次揭露:一份沒簽的草稿下載下來也必須看得出它沒簽,
// 不然檔案離開系統之後,收件的人分不出手上這份是不是正式文件。
// (紙面上的「草稿・未簽署」戳記由 DocumentPrintStamp 負責,這裡只是讓檔名同步說同一件事。)
export function fieldDocFileName({ label, date, versionNo = null, signed = false, note = '' }) {
  const parts = [label]
  if (date) parts.push(String(date))
  if (versionNo != null) parts.push(`v${versionNo}`)
  if (note) parts.push(note)
  else parts.push(signed ? '已簽署' : '草稿未簽署')
  return parts.filter(Boolean).join('_')
}
