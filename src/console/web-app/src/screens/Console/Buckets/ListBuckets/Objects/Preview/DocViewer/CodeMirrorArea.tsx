// ViewIO: ô soạn thảo CodeMirror 6 (tô màu cú pháp, đánh số dòng, undo/redo, tìm/thay thế Ctrl+F / Ctrl+H, thụt dòng bằng Tab).

import React, { useEffect, useRef } from "react";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { css } from "@codemirror/lang-css";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { c, cpp, java, kotlin, csharp } from "@codemirror/legacy-modes/mode/clike";

const language = (ext: string): Extension => {
  switch (ext) {
    case "md":
    case "markdown":
      return markdown();
    case "js":
    case "jsx":
    case "mjs":
      return javascript({ jsx: true });
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
    case "jsonl":
      return json();
    case "html":
    case "htm":
    case "vue":
      return html();
    case "xml":
    case "drawio":
    case "dio":
    case "svg":
      return xml();
    case "css":
    case "scss":
      return css();
    case "py":
      return python();
    case "sql":
      return sql();
    case "yml":
    case "yaml":
      return yaml();
    case "sh":
    case "bash":
    case "zsh":
      return StreamLanguage.define(shell);
    case "go":
      return StreamLanguage.define(go);
    case "rs":
      return StreamLanguage.define(rust);
    case "toml":
      return StreamLanguage.define(toml);
    case "ini":
    case "conf":
    case "cfg":
    case "env":
    case "properties":
      return StreamLanguage.define(properties);
    case "dockerfile":
      return StreamLanguage.define(dockerFile);
    case "c":
    case "h":
      return StreamLanguage.define(c);
    case "cpp":
    case "hpp":
    case "cc":
      return StreamLanguage.define(cpp);
    case "java":
      return StreamLanguage.define(java);
    case "kt":
      return StreamLanguage.define(kotlin);
    case "cs":
      return StreamLanguage.define(csharp);
    default:
      return [];
  }
};

// nền tối hay sáng: đo độ sáng của màu nền thật của trang để chọn bảng màu cú pháp
const isDarkPage = () => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor);
  if (!m) {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  }
  return (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255 < 0.45;
};

interface IProps {
  value: string;
  fileName: string;
  wrap: boolean;
  onChange: (v: string) => void;
}

const CodeMirrorArea = ({ value, fileName, wrap, onChange }: IProps) => {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const wrapComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const lower = fileName.toLowerCase();
    const ext = lower === "dockerfile" ? "dockerfile" : lower.split(".").pop() || "";
    const dark = isDarkPage();
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        language(ext),
        dark ? oneDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        wrapComp.current.of(wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            onChangeRef.current(u.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px", ...(dark ? {} : { backgroundColor: "transparent" }) },
          ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.55" },
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // chỉ tạo một lần cho mỗi file; nội dung sau đó do CodeMirror giữ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  useEffect(() => {
    view.current?.dispatch({
      effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  return <div ref={host} className="dv-edit-cm" />;
};

export default CodeMirrorArea;
