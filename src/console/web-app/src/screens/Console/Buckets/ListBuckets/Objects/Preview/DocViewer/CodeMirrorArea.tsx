// ViewIO: ô soạn thảo CodeMirror 6 (tô màu cú pháp, đánh số dòng, undo/redo, tìm/thay thế Ctrl+F / Ctrl+H, thụt dòng bằng Tab).
// Màu lấy từ các biến CSS của viewer (--dv-*, --hl-*) nên tự khớp mọi theme và chế độ sáng/tối.

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
  foldGutter,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
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

// Màu cú pháp theo biến CSS của viewer: đổi theme/chế độ tối là đổi theo, không phụ thuộc bảng màu cố định của CodeMirror
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--hl-keyword)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.inserted], color: "var(--hl-string)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.literal], color: "var(--hl-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: "var(--hl-title)", fontWeight: "bold" },
  { tag: [t.function(t.variableName), t.className, t.typeName, t.definition(t.variableName), t.labelName, t.tagName], color: "var(--hl-title)" },
  { tag: [t.propertyName, t.attributeName, t.attributeValue, t.namespace], color: "var(--hl-attr)" },
  { tag: [t.link, t.url], color: "var(--dv-accent)", textDecoration: "underline" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, color: "var(--hl-string)" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--hl-comment)" },
  { tag: t.invalid, color: "var(--hl-keyword)" },
]);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    color: "var(--dv-text)",
    backgroundColor: "var(--dv-code-bg)",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--dv-accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--dv-accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--dv-accent) 35%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--dv-panel)",
    color: "var(--dv-muted)",
    borderRight: "1px solid var(--dv-border)",
  },
  ".cm-activeLine": { backgroundColor: "var(--dv-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--dv-hover)", color: "var(--dv-text)" },
  ".cm-selectionMatch": { backgroundColor: "var(--dv-mark)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--dv-mark)", outline: "1px solid var(--dv-accent)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--dv-hover)", color: "var(--dv-muted)", border: "none" },
  // ô tìm/thay thế (Ctrl+F)
  ".cm-panels": { backgroundColor: "var(--dv-panel)", color: "var(--dv-text)", borderColor: "var(--dv-border)" },
  ".cm-panels input, .cm-panels button": {
    backgroundColor: "var(--dv-code-bg)",
    color: "var(--dv-text)",
    border: "1px solid var(--dv-border)",
    borderRadius: "4px",
  },
  ".cm-searchMatch": { backgroundColor: "var(--dv-mark)", outline: "1px solid var(--dv-mark-active)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--dv-mark-active)" },
  ".cm-tooltip": { backgroundColor: "var(--dv-panel)", color: "var(--dv-text)", border: "1px solid var(--dv-border)" },
});

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
        syntaxHighlighting(highlight),
        theme,
        wrapComp.current.of(wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            onChangeRef.current(u.state.doc.toString());
          }
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
