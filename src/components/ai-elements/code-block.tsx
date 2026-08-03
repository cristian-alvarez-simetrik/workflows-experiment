"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Slimmed-down replacement for the registry code-block: the original pulls
// the full shiki bundle (several MB) for syntax highlighting, but here it
// only ever renders small JSON payloads inside tool cards.

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
};

export const CodeBlock = ({
  code,
  language: _language,
  showLineNumbers: _showLineNumbers,
  className,
  children,
  ...props
}: CodeBlockProps) => (
  <div
    className={cn("group relative w-full overflow-hidden", className)}
    {...props}
  >
    {children}
    <pre className="max-h-64 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre">
      {code}
    </pre>
  </div>
);

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  code?: string;
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const CodeBlockCopyButton = ({
  code = "",
  onCopy,
  onError,
  timeout = 2000,
  className,
  ...props
}: CodeBlockCopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), timeout);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-7", className)}
      onClick={() => void copy()}
      {...props}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </Button>
  );
};
