export interface DebugUiState {
  debugOpen: boolean;
  showTowerTooltips: boolean;
  showEnemyTooltips: boolean;
  showMissionHud: boolean;
  showWavePreview: boolean;
  showSkillHud: boolean;
  showOverlayRegenNumbers: boolean;
  showOverlayCaptureRings: boolean;
  showOverlayClusterHighlight: boolean;
  showHitboxes: boolean;
  showGridLines: boolean;
}

type DebugUiListener = (state: DebugUiState) => void;

class DebugUiStore {
  private state: DebugUiState;
  private readonly listeners: Set<DebugUiListener>;

  constructor(initialState: DebugUiState) {
    this.state = { ...initialState };
    this.listeners = new Set<DebugUiListener>();
  }

  getState(): DebugUiState {
    return this.state;
  }

  subscribe(listener: DebugUiListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setState(partial: Partial<DebugUiState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };
    this.emit();
  }

  toggleDebugOpen(): void {
    this.setState({ debugOpen: !this.state.debugOpen });
  }

  toggle<K extends keyof DebugUiState>(key: K): void {
    this.setState({
      [key]: !this.state[key],
    } as Pick<DebugUiState, K>);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const debugUiStore = new DebugUiStore({
  debugOpen: false,
  showTowerTooltips: true,
  showEnemyTooltips: true,
  showMissionHud: true,
  showWavePreview: true,
  showSkillHud: true,
  showOverlayRegenNumbers: true,
  showOverlayCaptureRings: true,
  showOverlayClusterHighlight: true,
  showHitboxes: false,
  showGridLines: true,
});
