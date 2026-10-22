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

export function trimGenerateData(data: any, keepTurns: number): number {
  if (!data || !Array.isArray(data.prompt)) return 0;

  const hasMemoryBlock = data.prompt.some((message: any) => {
    const content =
      typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '');
    return content.includes('Mneme·记录要求');
  });
  if (!hasMemoryBlock) return 0;

  const result = trimChatMessages(data.prompt, keepTurns);
  if (result.removed > 0) data.prompt = result.messages;
  return result.removed;
}
