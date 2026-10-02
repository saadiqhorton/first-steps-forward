import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { LanguageDescription, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
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
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  {
    tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword],
    color: "var(--syntax-keyword)",
    fontWeight: "500",
  },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-number)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-type)" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--syntax-function)",
  },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syntax-property)" },
  {
    tag: [tags.heading, tags.heading1, tags.heading2],
    color: "var(--syntax-heading)",
    fontWeight: "500",
  },
  { tag: tags.link, color: "var(--syntax-type)", textDecoration: "underline" },
  { tag: [tags.invalid, tags.deleted], color: "var(--syntax-invalid)" },
  { tag: tags.inserted, color: "var(--syntax-string)" },
  { tag: [tags.atom, tags.labelName], color: "var(--syntax-number)" },
  { tag: [tags.regexp, tags.escape], color: "var(--syntax-string)" },
  {
    tag: [tags.meta, tags.processingInstruction, tags.documentMeta],
    color: "var(--syntax-comment)",
  },
  { tag: tags.definition(tags.variableName), color: "var(--syntax-type)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "500" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);

const workbenchTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--code-background)",
    color: "var(--code-foreground)",
    fontSize: "13px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: '"IBM Plex Mono", monospace',
    lineHeight: "1.65",
  },
  ".cm-content": { padding: "10px 0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 10px" },
  ".cm-gutters": {
    backgroundColor: "var(--code-gutter)",
    color: "var(--code-gutter-foreground)",
    borderRight: "1px solid var(--border-subtle)",
  },
  ".cm-gutterElement": { padding: "0 7px 0 5px" },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--amber) 8%, var(--code-background))",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklab, var(--amber) 14%, var(--code-gutter))",
    color: "var(--text-secondary)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--amber) 38%, var(--code-background)) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
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
