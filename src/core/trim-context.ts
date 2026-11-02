import { stripDelta } from './strip.ts';

export interface ChatMessageLike {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface TrimResult {
  messages: ChatMessageLike[];
  removed: number;
}

/**
 * 只压缩原始对话：保留所有 system 消息（含记忆账本），
 * 非 system 消息只保留最近 keepTurns 轮 user 及其之后的回复。
 * keepTurns = 0 时只保留最后一条 user 及其之后。
 */
export function trimChatMessages(
  messages: ChatMessageLike[],
  keepTurns: number,
): TrimResult {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, removed: 0 };
  }

  const turns = Math.max(0, Math.round(Number(keepTurns) || 0));
  const nonSystem = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message?.role !== 'system');

  if (nonSystem.length === 0) {
    return { messages, removed: 0 };
  }

  const userIndices = nonSystem
    .filter(({ message }) => message?.role === 'user')
    .map(({ index }) => index);

  let startIndex: number;
  if (userIndices.length > 0) {
    const keep = Math.max(1, turns);
    const target = Math.max(0, userIndices.length - keep);
    startIndex = userIndices[target];
  } else {
    const keep = Math.max(1, turns * 2);
    const target = Math.max(0, nonSystem.length - keep);
    startIndex = nonSystem[target]?.index ?? 0;
  }

  const kept = messages.filter(
    (message, index) => message?.role === 'system' || index >= startIndex,
  );

  return { messages: kept, removed: messages.length - kept.length };
}

/**
 * 只从「发给模型的提示词」里剔除 MNEME 块，不改聊天记录。
 * 聊天里保留原始正文与记忆块，模型永远看不到它。
 */
export function stripPromptDeltas(data: any): number {
  if (!data || !Array.isArray(data.prompt)) return 0;

  let changed = 0;
  // 不原地改 message 对象：万一酒馆复用了聊天消息的引用，
  // 原地改 content 会连带改写聊天记录。这里只在变化时新建对象。
  data.prompt = data.prompt.map((message: any) => {
    if (!message) return message;
    // 记忆块只会出现在 AI 回复里；用户消息即使引用了类似文本也不动
    if (message.role !== 'assistant') return message;
    const content = message.content;

    if (typeof content === 'string') {
      const stripped = stripDelta(content);
      if (stripped.removed) {
        changed += 1;
        return { ...message, content: stripped.text };
      }
      return message;
    }

    if (Array.isArray(content)) {
      let touched = false;
      const next = content.map((part: any) => {
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          const stripped = stripDelta(part.text);
          if (stripped.removed) {
            touched = true;
            return { ...part, text: stripped.text };
          }
        }
        return part;
      });
      if (touched) {
        changed += 1;
        return { ...message, content: next };
      }
      return message;
    }

    if (content && typeof content === 'object' && typeof (content as any).text === 'string') {
      const stripped = stripDelta((content as any).text);
      if (stripped.removed) {
        changed += 1;
        return { ...message, content: { ...(content as any), text: stripped.text } };
      }
    }
    return message;
  });
  return changed;
}

/**
 * 只压缩发给模型的原始对话，不删除聊天记录。
 * keepTurns = 0 时只保留最后一条 user 及其之后的回复。
 */
export function trimGenerateData(data: any, keepTurns: number): number {
  if (!data || !Array.isArray(data.prompt)) return 0;

  const result = trimChatMessages(data.prompt, keepTurns);
  if (result.removed > 0) data.prompt = result.messages;
  return result.removed;
}
