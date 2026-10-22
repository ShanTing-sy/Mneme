import type { DeltaPlot, DirectorView, Timeline, TimelineNode } from './types.ts';

export function applyPlot(timeline: Timeline, plot: DeltaPlot): void {
  for (const id of plot.advance ?? []) {
    const node = timeline.nodes.find((item) => item.id === id);
    if (node) node.status = '已发生';
  }
  if (plot.current) {
    const node = timeline.nodes.find((item) => item.id === plot.current);
    if (node) {
      node.status = node.status === '已发生' ? '已发生' : '进行中';
      timeline.currentId = node.id;
    }
  }
}

export function currentNode(timeline: Timeline): TimelineNode | null {
  if (timeline.nodes.length === 0) return null;
  if (timeline.currentId) {
    return timeline.nodes.find((node) => node.id === timeline.currentId) ?? null;
  }
  return (
    timeline.nodes.find((node) => node.status === '进行中') ??
    timeline.nodes.find((node) => node.status === '未发生') ??
    timeline.nodes[0]
  );
}

export function visibleNodes(timeline: Timeline, view: DirectorView): TimelineNode[] {
  const current = currentNode(timeline);
  if (!current) return [];
  if (view === 'full') return timeline.nodes;

  const index = timeline.nodes.findIndex((node) => node.id === current.id);
  if (index < 0) return [current];

  if (view === 'current') return [current];
  if (view === 'current-next') return timeline.nodes.slice(index, index + 2);
  return timeline.nodes.slice(index, index + 3);
}

export function buildDirectorText(timeline: Timeline | null, view: DirectorView): string {
  if (!timeline) return '';
  const current = currentNode(timeline);
  if (!current) return '';

  const lines = visibleNodes(timeline, view).map((node, index) => {
    const tag = index === 0 ? '当前节点' : node.status === '已发生' ? '已发生' : '后续节点';
    return `${tag} ${node.id}·${node.title}：${node.summary}`;
  });

  return [
    '<Mneme·导演>',
    '【导演视角：角色本人并不知道这些信息，不得以角色口吻说出未来】',
    ...lines,
    '规则：',
    '- 只允许通过细节、氛围、暗示为后续节点铺垫，禁止直接揭示未发生的事件。',
    '- 不得替 user 做决定，不得为推进剧情而跳过过程。',
    '- 当前节点未完成时，保持当下节奏，允许日常与停滞。',
    '</Mneme·导演>',
  ].join('\n');
}
