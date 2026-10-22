const BLOCK_RE = /<!--\s*MNEME[\s\S]*?MNEME\s*-->/i;
const FENCE_RE = /```(?:mneme|json)\s*[\s\S]*?"summary"\s*:[\s\S]*?```/i;

export function stripDelta(text: string): { text: string; removed: boolean } {
  let output = text;
  let removed = false;

  if (BLOCK_RE.test(output)) {
    output = output.replace(BLOCK_RE, '');
    removed = true;
  } else if (FENCE_RE.test(output)) {
    output = output.replace(FENCE_RE, '');
    removed = true;
  }

  if (!removed) {
    return { text, removed: false };
  }

  output = output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: output, removed: true };
}
