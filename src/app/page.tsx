"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// PGlite + React Flow are browser-only; skip SSR entirely.
const WorkflowCanvas = dynamic(
  () => import("@/components/workflow/canvas").then((m) => m.WorkflowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading workflow studio…</span>
      </div>
    ),
  }
);

export default function Home() {
  return <WorkflowCanvas />;
}
