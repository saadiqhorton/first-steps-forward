import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  LanguageDescription,
  syntaxHighlighting,
  HighlightStyle,
  defaultHighlightStyle,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState, Compartment } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

type Props = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
};

const workbenchHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "#898477", fontStyle: "italic" },
  {
    tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword],
    color: "#aa5818",
    fontWeight: "600",
  },
  { tag: [tags.string, tags.special(tags.string)], color: "#21786a" },
  { tag: [tags.number, tags.bool, tags.null], color: "#8158a0" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#2e638f" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#855326" },
  { tag: [tags.propertyName, tags.attributeName], color: "#5c6225" },
  { tag: [tags.heading, tags.heading1, tags.heading2], color: "#955014", fontWeight: "700" },
  { tag: tags.link, color: "#2e638f", textDecoration: "underline" },
  { tag: [tags.invalid, tags.deleted], color: "#a23c31" },
]);

const workbenchTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#fffdf8",
    color: "#34342e",
    fontSize: "11px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: '"IBM Plex Mono", monospace',
    lineHeight: "1.65",
  },
  ".cm-content": { padding: "10px 0", caretColor: "#c47b1b" },
  ".cm-line": { padding: "0 10px" },
  ".cm-gutters": {
    backgroundColor: "#f8f2e7",
    color: "#aca18d",
    borderRight: "1px solid #e8dfd0",
  },
  ".cm-gutterElement": { padding: "0 7px 0 5px" },
  ".cm-activeLine": { backgroundColor: "#f7eedf" },
  ".cm-activeLineGutter": { backgroundColor: "#f0e4d0", color: "#756a58" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "#e7c995 !important",
  },
  ".cm-cursor": { borderLeftColor: "#bd741a" },
  "&.cm-focused": { outline: "none" },
});

export function HighlightedCodeEditor({ path, value, onChange, onSave }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const language = new Compartment();
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({ "aria-label": `Edit ${path}` }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          workbenchTheme,
          syntaxHighlighting(workbenchHighlight),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          language.of([]),
        ],
      }),
    });
    viewRef.current = view;
    const description = LanguageDescription.matchFilename(languages, path);
    if (description) {
      void description
        .load()
        .then((support) => {
          if (!cancelled) view.dispatch({ effects: language.reconfigure(support) });
        })
        .catch(() => {
          // Unknown or unavailable language parsers leave the file editable as plain text.
        });
    }
    return () => {
      cancelled = true;
      viewRef.current = null;
      view.destroy();
    };
    // The parent keys this component by path. Draft updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div className="host-code-editor" ref={containerRef} />;
}
