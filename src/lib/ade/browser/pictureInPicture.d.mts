export declare function supportsBrowserPictureInPicture(): boolean;
export declare function closeBrowserPictureInPicture(): void;
/** Open a real OS picture-in-picture window from a user gesture, showing live preview frames. */
export declare function openBrowserPictureInPicture(
  source: HTMLCanvasElement,
  title?: string,
): Promise<void>;
