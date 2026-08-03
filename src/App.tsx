import { HashRouter, Route, Routes, useParams } from "react-router";
import { DslPlaygroundPage } from "@/components/dsl/playground";
import { HomePage } from "@/components/home";
import { WorkflowCanvas } from "@/components/workflow/canvas";

function WorkflowRoute() {
  const { id } = useParams<{ id: string }>();
  // key remounts the canvas when navigating between workflows
  return <WorkflowCanvas key={id} workflowId={id!} />;
}

/** Hash routes: "#/" → home, "#/w/<id>" → workflow editor, "#/dsl" → DSL playground. */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/w/:id" element={<WorkflowRoute />} />
        <Route path="/dsl" element={<DslPlaygroundPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </HashRouter>
  );
}
