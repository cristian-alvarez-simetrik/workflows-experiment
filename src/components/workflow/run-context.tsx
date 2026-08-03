"use client";

import { createContext, useContext } from "react";

export interface WorkflowRunner {
  /** Run a single node and everything downstream of it. */
  runNode: (id: string) => void;
  isRunning: boolean;
}

export const RunContext = createContext<WorkflowRunner>({
  runNode: () => {},
  isRunning: false,
});

export function useWorkflowRunner(): WorkflowRunner {
  return useContext(RunContext);
}
