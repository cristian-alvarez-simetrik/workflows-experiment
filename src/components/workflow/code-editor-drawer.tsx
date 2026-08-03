
import { useCallback, useEffect, useState } from "react";
import { Info, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CodeEditor, type CodeLanguage } from "./code-editor";

/** ℹ icon that reveals the editor's help text in a hover card. */
function InfoHoverCard({ text }: { text: string }) {
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96">
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
          {text}
        </pre>
      </HoverCardContent>
    </HoverCard>
  );
}

const WIDTH_KEY = "workflow-studio:drawer-width";
const MIN_WIDTH = 400;

function clampWidth(width: number): number {
  return Math.min(Math.max(width, MIN_WIDTH), window.innerWidth * 0.95);
}

interface CodeEditorDrawerProps {
  title: string;
  description?: string;
  value: string;
  language: CodeLanguage;
  placeholder?: string;
  onSave: (value: string) => void;
}

/** Expanded CodeMirror editor for SQL / scripts, opened as a resizable side drawer. */
export function CodeEditorDrawer({
  title,
  description,
  value,
  language,
  placeholder,
  onSave,
}: CodeEditorDrawerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [width, setWidth] = useState(672);

  useEffect(() => {
    if (open) {
      setDraft(value);
      const stored = Number(window.localStorage.getItem(WIDTH_KEY));
      if (stored) setWidth(clampWidth(stored));
    }
  }, [open, value]);

  const startResize = useCallback((e: React.PointerEvent) => {
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
      window.localStorage.setItem(WIDTH_KEY, String(next));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  return (
    // modal={false}: no overlay/blur — the canvas stays visible and usable.
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6" title={title}>
          <Maximize2 className="h-3 w-3" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        style={{ width, maxWidth: "95vw" }}
        className="flex flex-col gap-3 border-l shadow-2xl sm:max-w-none"
        onInteractOutside={(e) => e.preventDefault()}
        // Don't auto-focus the first element (the ℹ button) — focusing a
        // HoverCard trigger would pop its card open on every drawer open.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* drag handle on the left edge */}
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResize}
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-primary/40 active:bg-primary/60"
        />
        <SheetHeader>
          <div className="flex items-center gap-1.5">
            <SheetTitle>{title}</SheetTitle>
            {description && <InfoHoverCard text={description} />}
          </div>
          <SheetDescription className="sr-only">{title}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4">
          <CodeEditor
            value={draft}
            language={language}
            onChange={setDraft}
            placeholder={placeholder}
            minHeight="100%"
            maxHeight="100%"
            showLineNumbers
            className="h-full text-sm [&_.cm-editor]:h-full"
          />
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft);
              setOpen(false);
            }}
          >
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
