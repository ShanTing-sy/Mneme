import type { Delta, Importance } from './types.ts';

const BLOCK_RE = /<!--\s*MNEME([\s\S]*?)MNEME\s*-->/i;
const FENCE_RE = /```(?:mneme|json)\s*([\s\S]*?)```/i;

export interface ParseResult {
  ok: boolean;
  delta?: Delta;
  block?: string;
  inner?: string;
  reason?: string;
}

export function parseDelta(text: string): ParseResult {
  if (!text || typeof text !== 'string') {
    return { ok: false, reason: 'empty' };
  }

  let inner: string | undefined;
  let block: string | undefined;

  const blockMatch = text.match(BLOCK_RE);
  if (blockMatch) {
    block = blockMatch[0];
    inner = blockMatch[1];
  } else {
    const fenceMatch = text.match(FENCE_RE);
    if (fenceMatch && /"summary"\s*:/.test(fenceMatch[1])) {
      block = fenceMatch[0];
      inner = fenceMatch[1];
    }
  }

  if (!inner) {
    return { ok: false, reason: 'no-block' };
  }

  const jsonText = extractObject(cleanJson(inner));
  if (!jsonText) {
    return { ok: false, reason: 'no-json', block, inner };
  }

  try {
    const raw = JSON.parse(jsonText);
    const delta = normalizeDelta(raw);
    return delta
      ? { ok: true, delta, block, inner }
      : { ok: false, reason: 'invalid', block, inner };
  } catch {
    return { ok: false, reason: 'bad-json', block, inner };
  }
}

function extractObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

function cleanJson(text: string): string {
  let out = text.replace(/^﻿/, '').trim();
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  out = out.replace(/,\s*([}\]])/g, '$1');
  return out;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDelta(raw: unknown): Delta | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;

  const summary = asString(obj.summary);
  if (!summary) return null;

  const importance: Importance = ['normal', 'major', 'permanent'].includes(obj.importance)
    ? obj.importance
    : 'normal';

  return {
    summary,
    storyTime: asString(obj.storyTime),
    location: asString(obj.location),
    characters: Array.isArray(obj.characters)
      ? obj.characters.filter((x: unknown) => typeof x === 'string').slice(0, 12)
      : [],
    result: asString(obj.result),
    importance,
    anchor: asString(obj.anchor) || undefined,
    bonds: Array.isArray(obj.bonds)
      ? obj.bonds.filter((b: any) => b && typeof b.name === 'string')
      : [],
    items: Array.isArray(obj.items)
      ? obj.items.filter((i: any) => i && typeof i.name === 'string')
      : [],
    plot: obj.plot && typeof obj.plot === 'object' ? obj.plot : undefined,
    seal: obj.seal && typeof obj.seal === 'object' ? obj.seal : undefined,
  };
}
