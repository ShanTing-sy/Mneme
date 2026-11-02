const BLOCK_RE = /<!--\s*MNEME[\s\S]*?MNEME\s*-->/i;
// 每个匹配都必须是单个代码块，不能跨块：旧正则会把第一个 json 块到后面
// 某个含 "summary": 的块之间的正文一起吃掉。
const FENCE_RE = /```(?:mneme|json)\s*([\s\S]*?)```/gi;

function findSummaryFence(text: string): RegExpMatchArray | undefined {
  return [...text.matchAll(FENCE_RE)].find((match) => /"summary"\s*:/.test(match[1] ?? ''));
}

export function stripDelta(text: string): { text: string; removed: boolean } {
  let output = text;
  let removed = false;

  const blockMatch = output.match(BLOCK_RE);
  if (blockMatch) {
    output = output.replace(blockMatch[0], '');
    removed = true;
  } else {
    const fenceMatch = findSummaryFence(output);
    if (fenceMatch && fenceMatch.index !== undefined) {
      output = output.slice(0, fenceMatch.index) + output.slice(fenceMatch.index + fenceMatch[0].length);
      removed = true;
    }
  }

  if (!removed) {
    return { text, removed: false };
  }

  output = output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: output, removed: true };
}

/**
 * 带护栏的剥离：如果原文有内容、剥离后却为空，除非原文本来就只是一个
 * Mneme 块，否则保留原文。宁可让 JSON 块留在正文里，也不整条吞掉。
 */
export function stripDeltaSafely(
  text: string,
  block: string | undefined,
  ok: boolean,
): { text: string; removed: boolean } {
  const original = String(text ?? '');
  if (!original.trim()) return { text: '', removed: false };

  const stripped = stripDelta(original);
  if (stripped.text.trim()) return stripped;

  const onlyBlock = !!block && original.trim() === block.trim();
  const isHtmlBlock = !!block && block.trim().startsWith('<!--');
  if (onlyBlock && (ok || isHtmlBlock)) {
    return { text: '', removed: true };
  }

  return { text: original, removed: false };
}
