import type { DeltaSeal, MemoryEntry, MnemeState, Volume } from './types.ts';

export function mechanicalRecap(entries: MemoryEntry[]): string {
  return entries
    .map((entry) => `${entry.storyTime ? `[${entry.storyTime}] ` : ''}${entry.summary}`)
    .join('\n')
    .slice(0, 800);
}

export function deriveTimeRange(entries: MemoryEntry[]): string {
  const times = entries.map((entry) => entry.storyTime.trim()).filter(Boolean);
  if (times.length === 0) return '';
  const first = times[0];
  const last = times[times.length - 1];
  return first === last ? first : `${first} ～ ${last}`;
}

export function sealVolume(
  state: MnemeState,
  seal: DeltaSeal | undefined,
  _size: number,
): Volume {
  const index = state.stats.sealedVolumes + 1;
  const entries = state.entries.slice();
  const title = (seal?.title ?? '').trim() || `第 ${index} 卷`;
  const timeRange =
    (seal?.timeRange ?? seal?.time_range ?? seal?.time ?? '').trim() ||
    deriveTimeRange(entries);
  const provided = (seal?.recap ?? '').trim();
  const recap = provided || mechanicalRecap(entries);

  const volume: Volume = {
    index,
    title,
    timeRange,
    recap: recap.slice(0, 1200),
    entries,
    sealedAt: Date.now(),
    auto: !provided,
  };

  state.volumes.push(volume);
  state.stats.sealedVolumes = index;
  state.entries = [];
  return volume;
}
