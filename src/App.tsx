import { useEffect, useState } from "react";
import { HomePage } from "@/components/home";
import { WorkflowCanvas } from "@/components/workflow/canvas";

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

/** Hash routes: "#/" → home, "#/w/<id>" → workflow editor. */
export default function App() {
  const hash = useHashRoute();
  const match = hash.match(/^#\/w\/(.+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    // key remounts the canvas when navigating between workflows
    return <WorkflowCanvas key={id} workflowId={id} />;
  }
  return <HomePage />;
}
