import type { DeltaSeal, MemoryEntry, MnemeState, Volume } from './types.ts';

export function mechanicalRecap(entries: MemoryEntry[]): string {
  return entries
    .map((entry) => `${entry.storyTime ? `[${entry.storyTime}] ` : ''}${entry.summary}`)
    .join('\n')
    .slice(0, 800);
}

export function sealVolume(
  state: MnemeState,
  seal: DeltaSeal | undefined,
  _size: number,
): Volume {
  const index = state.stats.sealedVolumes + 1;
  const entries = state.entries.slice();
  const title = (seal?.title ?? '').trim() || `第 ${index} 卷`;
  const provided = (seal?.recap ?? '').trim();
  const recap = provided || mechanicalRecap(entries);

  const volume: Volume = {
    index,
    title,
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
