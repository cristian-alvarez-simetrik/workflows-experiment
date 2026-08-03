
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { cn } from "@/lib/utils";

export type CodeLanguage = "sql" | "javascript" | "json" | "yaml" | "text";

const languageExtensions = {
  sql: () => sql(),
  javascript: () => javascript(),
  json: () => json(),
  yaml: () => yaml(),
  text: () => [],
};

interface CodeEditorProps {
  value: string;
  language: CodeLanguage;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: string;
  maxHeight?: string;
  showLineNumbers?: boolean;
  className?: string;
}

/** CodeMirror wrapper used for every code surface (SQL, scripts, JSON). */
export function CodeEditor({
  value,
  language,
  onChange,
  placeholder,
  readOnly = false,
  minHeight = "5rem",
  maxHeight = "10rem",
  showLineNumbers = false,
  className,
}: CodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[languageExtensions[language](), EditorView.lineWrapping]}
      theme="dark"
      readOnly={readOnly}
      editable={!readOnly}
      placeholder={placeholder}
      minHeight={minHeight}
      maxHeight={maxHeight}
      basicSetup={{
        lineNumbers: showLineNumbers,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: true,
      }}
      className={cn(
        "nodrag nowheel overflow-hidden rounded-md border text-xs",
        "[&_.cm-editor]:bg-muted/40 [&_.cm-gutters]:bg-transparent [&_.cm-editor.cm-focused]:outline-none",
        className
      )}
    />
  );
}
