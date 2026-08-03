import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { isStaticToolUIPart, type UIMessage } from "ai";
import {
  ExternalLink,
  KeyRound,
  Loader2,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentApiRef } from "@/lib/ai/agent-api";
import { createWorkflowTools } from "@/lib/ai/tools";
import { createChatTransport } from "@/lib/ai/transport";
import {
  AI_MODELS,
  forgetApiKey,
  getStoredModel,
  loadApiKey,
  saveApiKey,
  setStoredModel,
} from "@/lib/api-key-store";
import {
  clearChatMessages,
  loadChatMessages,
  saveChatMessages,
} from "@/lib/chat-store";

const WIDTH_KEY = "workflow-studio:chat-width";
const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 400;

function clampWidth(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), window.innerWidth * 0.5);
}

interface ChatPanelProps {
  workflowId: string;
  agentApiRef: AgentApiRef;
  onClose: () => void;
}

export default function ChatPanel({
  workflowId,
  agentApiRef,
  onClose,
}: ChatPanelProps) {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH
      ? clampWidth(stored)
      : DEFAULT_WIDTH;
  });

  // undefined = still checking, false = no key stored, true = ready
  const [hasKey, setHasKey] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    void loadApiKey().then((key) => setHasKey(key != null));
  }, []);

  const [initialMessages, setInitialMessages] = useState<
    UIMessage[] | undefined
  >(undefined);
  useEffect(() => {
    let cancelled = false;
    loadChatMessages(workflowId)
      .then((msgs) => {
        if (!cancelled) setInitialMessages(msgs);
      })
      .catch(() => {
        if (!cancelled) setInitialMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    let startWidth = 0;
    setWidth((w) => {
      startWidth = w;
      return w;
    });
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: PointerEvent) => {
      const next = clampWidth(startWidth + (startX - ev.clientX));
      setWidth(next);
      localStorage.setItem(WIDTH_KEY, String(next));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const loading = hasKey === undefined || initialMessages === undefined;

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-l bg-card"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-primary/40 active:bg-primary/60"
      />
      {loading ? (
        <>
          <PanelHeader onClose={onClose} />
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </>
      ) : hasKey ? (
        <ChatBody
          key={workflowId}
          workflowId={workflowId}
          agentApiRef={agentApiRef}
          initialMessages={initialMessages}
          onClose={onClose}
          onKeyForgotten={() => setHasKey(false)}
        />
      ) : (
        <>
          <PanelHeader onClose={onClose} />
          <KeyGate onSaved={() => setHasKey(true)} />
        </>
      )}
    </aside>
  );
}

function PanelHeader({
  onClose,
  children,
}: {
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex items-center gap-1.5 border-b px-3 py-2">
      <Sparkles className="h-4 w-4 shrink-0 text-violet-400" />
      <span className="text-sm font-semibold">Assistant</span>
      <div className="ml-auto flex items-center gap-1">{children}</div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground"
        onClick={onClose}
        title="Close"
      >
        <X className="h-4 w-4" />
      </Button>
    </header>
  );
}

function KeyGate({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const key = value.trim();
    if (!key) return;
    setSaving(true);
    try {
      await saveApiKey(key);
      onSaved();
    } catch (err) {
      toast.error("Could not save the API key", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full border bg-muted/40 p-3">
        <KeyRound className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Connect OpenAI</h3>
        <p className="text-xs text-muted-foreground">
          Paste an API key to enable the assistant. The key is encrypted at
          rest in this browser and is only ever sent to api.openai.com.
        </p>
      </div>
      <form
        className="flex w-full max-w-xs flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          placeholder="sk-..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" disabled={saving || !value.trim()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save key
        </Button>
      </form>
      <a
        href="https://platform.openai.com/api-keys"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Create a key on platform.openai.com
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function ChatBody({
  workflowId,
  agentApiRef,
  initialMessages,
  onClose,
  onKeyForgotten,
}: {
  workflowId: string;
  agentApiRef: AgentApiRef;
  initialMessages: UIMessage[];
  onClose: () => void;
  onKeyForgotten: () => void;
}) {
  const [model, setModel] = useState(getStoredModel);
  const modelRef = useRef(model);
  modelRef.current = model;

  const tools = useMemo(() => createWorkflowTools(agentApiRef), [agentApiRef]);
  const transport = useMemo(
    () =>
      createChatTransport({
        getApiKey: loadApiKey,
        getModel: () => modelRef.current,
        tools,
      }),
    [tools]
  );

  const { messages, sendMessage, status, stop, setMessages, error } = useChat({
    id: `wf-${workflowId}`,
    transport,
    messages: initialMessages,
    onFinish: ({ messages: finished }) => {
      void saveChatMessages(workflowId, finished);
    },
  });

  // Persist best-effort when a stream errors out so the exchange isn't lost.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(() => {
    if (error) void saveChatMessages(workflowId, messagesRef.current);
  }, [error, workflowId]);

  const changeModel = (value: string) => {
    setModel(value);
    setStoredModel(value);
  };

  const clearChat = async () => {
    await clearChatMessages(workflowId);
    setMessages([]);
  };

  const forgetKey = async () => {
    await forgetApiKey();
    onKeyForgotten();
  };

  return (
    <>
      <PanelHeader onClose={onClose}>
        <Select value={model} onValueChange={changeModel}>
          <SelectTrigger size="sm" className="h-7 w-fit gap-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SettingsPopover onForgetKey={forgetKey} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              title="Clear chat"
              disabled={messages.length === 0}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear this chat?</AlertDialogTitle>
              <AlertDialogDescription>
                The conversation for this workflow will be removed from the
                local database. The workflow itself is not touched.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void clearChat()}>
                Clear
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PanelHeader>

      <Conversation>
        <ConversationContent className="gap-4">
          {messages.length === 0 && (
            <ConversationEmptyState
              icon={<Sparkles className="h-6 w-6" />}
              title="Workflow assistant"
              description="Ask me to build, edit, connect or run the nodes in this workflow."
            />
          )}
          {messages.map((message) => (
            <Message from={message.role} key={message.id}>
              <MessageContent>
                {message.parts.map((part, i) => {
                  if (part.type === "text") {
                    return message.role === "assistant" ? (
                      <MessageResponse key={i}>{part.text}</MessageResponse>
                    ) : (
                      <span key={i} className="whitespace-pre-wrap">
                        {part.text}
                      </span>
                    );
                  }
                  if (isStaticToolUIPart(part)) {
                    return (
                      <Tool key={i}>
                        <ToolHeader type={part.type} state={part.state} />
                        <ToolContent>
                          <ToolInput input={part.input} />
                          <ToolOutput
                            output={part.output}
                            errorText={part.errorText}
                          />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error && (
        <p className="border-t px-3 py-2 text-xs text-destructive">
          {error.message}
        </p>
      )}

      <div className="border-t p-3">
        <PromptInput
          onSubmit={({ text }) => {
            const trimmed = text?.trim();
            if (!trimmed) return;
            void sendMessage({ text: trimmed });
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder="Ask the assistant…" />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputSubmit
              className="ml-auto"
              status={status}
              onStop={stop}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}

function SettingsPopover({ onForgetKey }: { onForgetKey: () => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);

  const replaceKey = async () => {
    const key = value.trim();
    if (!key) return;
    try {
      await saveApiKey(key);
      setValue("");
      setOpen(false);
      toast.success("API key updated");
    } catch (err) {
      toast.error("Could not save the API key", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          title="Settings"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <div>
          <p className="text-xs font-medium">OpenAI API key</p>
          <p className="text-xs text-muted-foreground">
            Stored encrypted in this browser; sent only to api.openai.com.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void replaceKey();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            placeholder="Replace key (sk-...)"
            className="h-8 text-xs"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={!value.trim()}
          >
            Save
          </Button>
        </form>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-destructive hover:text-destructive"
          onClick={() => void onForgetKey()}
        >
          Forget key
        </Button>
      </PopoverContent>
    </Popover>
  );
}
