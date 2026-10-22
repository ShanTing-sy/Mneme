import { reactive } from 'vue';

export type TabKey = 'memory' | 'bonds' | 'items' | 'timeline';

export const panelState = reactive({
  visible: false,
  activeTab: 'memory' as TabKey,
  showHelp: false,
  showSettings: false,
  missing: 0,
  raw: 0,
  initRunning: false,
  initError: '',
  lastSealed: 0,
});

export function togglePanel(value?: boolean): void {
  panelState.visible = value ?? !panelState.visible;
  if (panelState.visible) {
    panelState.missing = 0;
    panelState.showHelp = false;
    panelState.showSettings = false;
  }
}
