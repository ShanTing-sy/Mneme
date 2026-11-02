import { reactive } from 'vue';

export type TabKey = 'memory' | 'bonds' | 'prompt' | 'items' | 'timeline';

export const panelState = reactive({
  visible: false,
  activeTab: 'memory' as TabKey,
  showHelp: false,
  showSettings: false,
  showApis: false,
  missing: 0,
  raw: 0,
  initRunning: false,
  initProgress: 0,
  initStage: '',
  initError: '',
  lastSealed: 0,
  overviewOpen: false,
  ballDot: false,
  trimmedLast: 0,
  trimmedAt: 0,
  summaryRunning: false,
  summaryStage: '',
  summaryError: '',
  summaryQueue: 0,
  apiTestStatus: '',
  worldbookReady: false,
  worldbookActive: false,
  worldbookBook: '',
  worldbookBound: false,
  worldbookConflict: '',
  worldbookError: '',
});

export function togglePanel(value?: boolean): void {
  panelState.visible = value ?? !panelState.visible;
  if (panelState.visible) {
    panelState.missing = 0;
    panelState.showHelp = false;
    panelState.showSettings = false;
    panelState.showApis = false;
  }
}
