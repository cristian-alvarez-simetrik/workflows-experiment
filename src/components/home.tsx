import { useState } from "react";
import {
  ArrowRight,
  FlaskConical,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { simpleConciliationMeta } from "@/lib/examples/simple-conciliation";
import {
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
  saveWorkflow,
  type StoredWorkflow,
} from "@/lib/workflow-store";

const EXAMPLES = [simpleConciliationMeta];

function openWorkflow(id: string) {
  window.location.hash = `#/w/${id}`;
}

function formatUpdatedAt(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HomePage() {
  const [workflows, setWorkflows] = useState<StoredWorkflow[]>(() =>
    [...listWorkflows()].sort((a, b) => b.updatedAt - a.updatedAt)
  );

  const startEmpty = () => {
    const wf = createWorkflow("Untitled workflow");
    saveWorkflow(wf);
    openWorkflow(wf.id);
  };

  const startExample = (build: () => StoredWorkflow) => {
    const wf = build();
    saveWorkflow(wf);
    openWorkflow(wf.id);
  };

  const remove = (id: string) => {
    deleteWorkflow(id);
    setWorkflows(
      [...listWorkflows()].sort((a, b) => b.updatedAt - a.updatedAt)
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="mb-10 flex items-center gap-3">
        <Workflow className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Workflow Studio</h1>
          <p className="text-sm text-muted-foreground">
            Node-based data workflows running on PGlite, entirely in your
            browser.
          </p>
        </div>
      </header>

      <section className="mb-10">
        <Button size="lg" onClick={startEmpty}>
          <Plus className="h-4 w-4" />
          Start a new workflow
        </Button>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Examples
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {EXAMPLES.map((example) => (
            <Card
              key={example.title}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => startExample(example.build)}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FlaskConical className="h-4 w-4 text-violet-400" />
                  {example.title}
                  <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
                </CardTitle>
                <CardDescription>{example.description}</CardDescription>
                <Badge variant="secondary" className="mt-2 w-fit text-[10px]">
                  {example.nodeCount} nodes
                </Badge>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Your workflows
        </h2>
        {workflows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing here yet — start a new workflow or open an example.
          </p>
        ) : (
          <ul className="space-y-2">
            {workflows.map((wf) => (
              <li
                key={wf.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/50"
              >
                <button
                  onClick={() => openWorkflow(wf.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Workflow className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {wf.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {wf.nodes.length} node{wf.nodes.length === 1 ? "" : "s"} ·
                      updated {formatUpdatedAt(wf.updatedAt)}
                    </span>
                  </span>
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete “{wf.name}”?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The workflow and its node graph will be removed from
                        local storage. Tables already loaded into PGlite are
                        kept.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(wf.id)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
