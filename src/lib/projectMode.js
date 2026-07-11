export function deriveProjectModes({ isSupabaseConfigured, currentUser, currentProject, workItemsSource }) {
  const isPersistedProject = !!(
    isSupabaseConfigured && currentUser?.real && currentProject?.project_id
  )
  return {
    isPersistedProject,
    hasDbBoq: isPersistedProject && workItemsSource === 'db',
  }
}

export function projectDeleteErrorMessage(error) {
  return error?.message?.trim() || '專案刪除失敗，請稍後再試。'
}

export function deriveContractControls({ isPersistedProject, can = {} }) {
  return {
    legacyParserEnabled: !!(isPersistedProject && can.manageObligations),
    requirementIngestionEnabled: !!(isPersistedProject && can.manageDocuments),
  }
}
