// 側欄與頁內分頁列(PageTabs)之間唯一的溝通管道(入口方案 B,2026-09-15 定案):
// 值＝側欄「目前正在列出子頁」的那個工作群組的 to(例如 '/submittals'),沒有就是 null。
// PageTabs 拿到的值等於自己所屬群組時就不渲染——同一組子頁不在側欄與內容區各畫一次
// (D-015「內容區不重複子頁導覽」);側欄收合成 icon rail、平板、手機抽屜、或使用者
// 手動收合群組時值為 null,分頁列照常出現,子頁入口永遠不消失。
// 預設 null:不在 WebLayout 底下渲染(單元測試、列印頁)時 PageTabs 行為與從前相同。
import { createContext } from 'react'

export const SidebarNavContext = createContext(null)
