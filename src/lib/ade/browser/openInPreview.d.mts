export declare const BROWSER_OPEN_EVENT: "ade:browser-open";
/** Zoom changes announce themselves so the page can show the new level briefly. */
export declare const BROWSER_ZOOM_EVENT: "ade:browser-zoom";
export declare function isPreviewableUrl(url: string | null | undefined): url is string;
/** Ask ADE to show `url` in the browser tab. False for a URL the preview cannot load. */
export declare function requestPreviewOpen(url: string): boolean;
/** Links T3 shows inside the preview: local HTML pages and PDFs. */
export declare function isPreviewableFile(path: string): boolean;
/** A workspace file path from a link, or null when the link is a web address, anchor or mail. */
export declare function workspaceFileFromLink(href: string): string | null;
export declare function previewFileUrl(projectId: string, filePath: string): string;
export declare function requestPreviewFileOpen(projectId: string, filePath: string): boolean;
