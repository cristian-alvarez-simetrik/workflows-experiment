import {
  convertToModelMessages,
  isStepCount,
  streamText,
  toUIMessageStream,
  type ChatTransport,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { WorkflowTools } from "./tools";

export interface ChatTransportOptions {
  getApiKey: () => Promise<string | null>;
  getModel: () => string;
  tools: WorkflowTools;
}

/**
 * Chat transport that talks to the OpenAI API straight from the browser —
 * there is no server. The API key and model are read lazily on every send so
 * settings changes apply without re-creating the transport. Tool calls
 * execute in-page against the live canvas.
 */
export function createChatTransport(
  opts: ChatTransportOptions
): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      const apiKey = await opts.getApiKey();
      if (!apiKey) {
        throw new Error(
          "No OpenAI API key configured — add one in the chat settings."
        );
      }
      const openai = createOpenAI({ apiKey });
      // ToolSet cast: TS rejects the precisely-typed tool map on the loose
      // Tool<unknown, unknown> index signature (needsApproval contravariance).
      const tools = opts.tools as unknown as ToolSet;
      const result = streamText({
        model: openai(opts.getModel()),
        system: SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages, { tools }),
        tools,
        stopWhen: isStepCount(20),
        abortSignal,
      });
      return toUIMessageStream({
        stream: result.stream,
        tools,
        onError: (error) =>
          error instanceof Error ? error.message : String(error),
      }) as ReadableStream<UIMessageChunk>;
    },

    async reconnectToStream() {
      return null; // nothing server-side to resume
    },
  };
}
