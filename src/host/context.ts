export function getCtx(): any | null {
  const globalObject = globalThis as any;
  const st = globalObject.SillyTavern;
  if (!st || typeof st.getContext !== 'function') return null;
  try {
    return st.getContext();
  } catch {
    return null;
  }
}
