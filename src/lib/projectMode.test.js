import { describe, expect, it } from 'vitest'
import { deriveContractControls, deriveProjectModes, projectDeleteErrorMessage } from './projectMode.js'

const realUser = { real: true }
const project = { project_id: 'project-a' }

describe('project modes', () => {
  it('treats a persisted project without BOQ as a real project', () => {
    expect(deriveProjectModes({
      isSupabaseConfigured: true, currentUser: realUser, currentProject: project,
      workItemsSource: 'sample',
    })).toEqual({ isPersistedProject: true, hasDbBoq: false })
  })

  it('keeps demo and persisted modes separate', () => {
    expect(deriveProjectModes({
      isSupabaseConfigured: false, currentUser: { real: false }, currentProject: null,
      workItemsSource: 'sample',
    })).toEqual({ isPersistedProject: false, hasDbBoq: false })
  })

  it('only reports DB BOQ when the real project has database work items', () => {
    expect(deriveProjectModes({
      isSupabaseConfigured: true, currentUser: realUser, currentProject: project,
      workItemsSource: 'db',
    })).toEqual({ isPersistedProject: true, hasDbBoq: true })
  })
})

describe('project deletion errors', () => {
  it('presents the safe database message and has a neutral fallback', () => {
    expect(projectDeleteErrorMessage({ message: '只有專案技術管理者可以刪除專案' }))
      .toBe('只有專案技術管理者可以刪除專案')
    expect(projectDeleteErrorMessage(null)).toBe('專案刪除失敗，請稍後再試。')
  })
})

describe('contract controls', () => {
  it('enables both contract-first paths without requiring BOQ', () => {
    expect(deriveContractControls({
      isPersistedProject: true,
      can: { manageDocuments: true, manageObligations: true },
    })).toEqual({ legacyParserEnabled: true, requirementIngestionEnabled: true })
  })

  it('disables demo ingestion and preserves separate permissions', () => {
    expect(deriveContractControls({
      isPersistedProject: false,
      can: { manageDocuments: true, manageObligations: true },
    })).toEqual({ legacyParserEnabled: false, requirementIngestionEnabled: false })
    expect(deriveContractControls({
      isPersistedProject: true,
      can: { manageDocuments: false, manageObligations: true },
    })).toEqual({ legacyParserEnabled: true, requirementIngestionEnabled: false })
  })
})
