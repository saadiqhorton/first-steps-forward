import type { BrowserAnnotationDraft } from "./browserPreviewContext";

export function formatAnnotationFeedback(draft: BrowserAnnotationDraft, comment: string): string {
  const details = draft.elements
    .map(
      (element) =>
        `\n\nSelected element: ${element.selector ?? element.tagName}${element.componentName ? `\nComponent: ${element.componentName}` : ""}${element.source ? `\nSource: ${element.source.fileName}:${element.source.lineNumber ?? "?"}:${element.source.columnNumber ?? "?"}` : ""}${element.stack?.length ? `\nComponent stack: ${element.stack.map((frame) => `${frame.functionName ?? "?"} (${frame.fileName ?? "?"}:${frame.lineNumber ?? "?"}:${frame.columnNumber ?? "?"})`).join(" → ")}` : ""}\nHTML: ${element.htmlPreview}\nComputed styles: ${element.styles}\nBounds: ${JSON.stringify(element.rect)}`,
    )
    .join("");
  const styles = draft.styleChanges
    .map(
      (change) =>
        `\n${change.selector}: ${change.property} from ${change.previousValue} to ${change.value}`,
    )
    .join("");
  return `${comment}\n\n${draft.targets}${details}${styles ? `\n\nRequested style changes:${styles}` : ""}`.trim();
}
