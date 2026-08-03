import type { UIMessage } from "ai";
import { getDb } from "./db";

const DDL = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  workflow_id text NOT NULL,
  seq integer NOT NULL,
  role text NOT NULL,
  parts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_wf ON chat_messages (workflow_id, seq);
`;

// The DDL runs on every call: a user's SQL node can DROP the table at any
// time, so a memoized one-shot ensure() would leave the store broken.
async function ensureSchema() {
  const db = await getDb();
  await db.exec(DDL);
  return db;
}

export async function loadChatMessages(
  workflowId: string
): Promise<UIMessage[]> {
  const db = await ensureSchema();
  const res = await db.query<{ id: string; role: string; parts: unknown }>(
    `SELECT id, role, parts FROM chat_messages WHERE workflow_id = $1 ORDER BY seq`,
    [workflowId]
  );
  return res.rows.map(
    (r) =>
      ({
        id: r.id,
        role: r.role,
        parts: r.parts,
      }) as UIMessage
  );
}

export async function saveChatMessages(
  workflowId: string,
  messages: UIMessage[]
): Promise<void> {
  const db = await ensureSchema();
  // Delete + reinsert keeps ordering trivially correct (regeneration can
  // rewrite earlier messages); transcripts are small so this stays cheap.
  await db.transaction(async (tx) => {
    await tx.query(`DELETE FROM chat_messages WHERE workflow_id = $1`, [
      workflowId,
    ]);
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      await tx.query(
        `INSERT INTO chat_messages (id, workflow_id, seq, role, parts)
         VALUES ($1, $2, $3, $4, $5)`,
        [m.id, workflowId, i, m.role, JSON.stringify(m.parts)]
      );
    }
  });
}

export async function clearChatMessages(workflowId: string): Promise<void> {
  const db = await ensureSchema();
  await db.query(`DELETE FROM chat_messages WHERE workflow_id = $1`, [
    workflowId,
  ]);
}
