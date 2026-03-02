import type { TowerDictionary, TowerDictionaryValidationIssue } from "../types/towerDictionary";

export interface TowerDictionaryEditorState {
  loaded: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  searchText: string;
  selectedTowerId: string | null;
  loadedDictionary: TowerDictionary | null;
  appliedDictionary: TowerDictionary | null;
  draftDictionary: TowerDictionary | null;
  validationErrors: TowerDictionaryValidationIssue[];
  message: string;
}

export function createInitialTowerDictionaryEditorState(): TowerDictionaryEditorState {
  return {
    loaded: false,
    loading: false,
    busy: false,
    error: null,
    searchText: "",
    selectedTowerId: null,
    loadedDictionary: null,
    appliedDictionary: null,
    draftDictionary: null,
    validationErrors: [],
    message: "",
  };
}
