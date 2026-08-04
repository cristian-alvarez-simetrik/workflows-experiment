// Tiny bridge between the canvas ("Add to chat" on a node) and the chat
// panel's input. References pushed while the chat input isn't mounted yet
// (panel closed, key gate, lazy chunk loading) are buffered and flushed as
// soon as it subscribes.

type Listener = (ref: string) => void;

let listener: Listener | null = null;
let pending: string[] = [];
let openChat: (() => void) | null = null;

/** Formats the mention appended to the chat input for a node. */
export function formatNodeRef(label: string, id: string): string {
  return `@[${label}](node:${id})`;
}

export function pushChatRef(ref: string): void {
  if (listener) {
    listener(ref);
  } else {
    pending.push(ref);
    openChat?.();
  }
}

/** The chat input subscribes here; buffered references flush immediately. */
export function subscribeChatRefs(fn: Listener): () => void {
  listener = fn;
  const buffered = pending;
  pending = [];
  for (const ref of buffered) fn(ref);
  return () => {
    if (listener === fn) listener = null;
  };
}

/** The canvas registers how to open the chat panel when a ref arrives closed. */
export function registerChatOpener(fn: () => void): () => void {
  openChat = fn;
  return () => {
    if (openChat === fn) openChat = null;
  };
}
