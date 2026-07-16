// 主題三態(U-07):light / dark / system。
// 之前只有亮暗二態,手動切過一次就永遠釘死;現在 system 模式跟隨作業系統,
// 且監聽系統偏好變化即時切換。localStorage 舊值('light'/'dark')原樣相容。
const KEY = 'pmis-theme'
export const THEME_MODES = ['light', 'dark', 'system']

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

export function getThemeMode() {
  try {
    const v = localStorage.getItem(KEY)
    return THEME_MODES.includes(v) ? v : 'system'
  } catch { return 'system' }
}

export function applyTheme(mode = getThemeMode()) {
  const dark = mode === 'dark' || (mode === 'system' && systemDark())
  document.documentElement.classList.toggle('dark', dark)
}

export function setThemeMode(mode) {
  try { localStorage.setItem(KEY, mode) } catch { /* noop */ }
  applyTheme(mode)
}

// system 模式下,OS 亮暗切換即時反映(main.jsx 掛一次)
export function watchSystemTheme() {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mq) return () => {}
  const onChange = () => { if (getThemeMode() === 'system') applyTheme('system') }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
