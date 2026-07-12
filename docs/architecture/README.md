# 架構文件(P0 恢復後)

這些文件自 `codex/pre-p0-rollback-backup-20260711`(ba8a5ec)取回,對應 2026-07-12
已恢復並部署的章節。閱讀時注意兩點與原文的差異:

1. **批 3(P0-03/04 contractual authority cutover)已由使用者決策永久取消**
   (契約禁止兼職 → 同一人跨案不同角色不存在),全域 `org_type` 模型定案。
   原文提到 party-based 權限(`has_project_authority`、`can.manage*` 前端 API)之處,
   實際實作對應為:`my_org_type()`/`is_project_admin()` + 前端 `can.edit` 等。
   零星前移的物件(is_active、can_manage_documents、last-admin guard、
   citation-freeze guard、can_review_requirement)見各 migration 檔頭註解。
2. **單一真相來源=supabase/migrations/**(schema.sql 已凍結為歷史參考);
   事故雙根因(自我引用 select policy × INSERT RETURNING、bucket 未建立)的修復
   記錄在 `20260712000800_p0_07_5_contract_packages.sql` 檔頭。
   `contractual-authority-model.md` 未取回(屬已取消的批 3,見備份分支)。
