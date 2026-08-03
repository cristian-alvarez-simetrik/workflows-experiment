import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import { Toaster } from "@/components/ui/sonner";
import { WorkflowCanvas } from "@/components/workflow/canvas";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkflowCanvas />
    <Toaster position="bottom-right" />
  </StrictMode>
);
