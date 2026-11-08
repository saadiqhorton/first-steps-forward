// ADE accepts images up to 10 MiB each and 20 MiB in one message.
export const CAPTURE_IMAGE_LIMIT = 10 * 1024 * 1024;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** Keep the original resolution and PNG where possible; compress only when necessary. */
export async function encodeCaptureImage(
  canvas: HTMLCanvasElement,
  limit: number,
  preferPng = true,
): Promise<Blob | null> {
  if (preferPng) {
    const png = await canvasBlob(canvas, "image/png");
    if (png?.type === "image/png" && png.size <= limit) return png;
  }
  let current = canvas;
  while (current.width && current.height) {
    for (const quality of [0.92, 0.85, 0.75, 0.65]) {
      const jpeg = await canvasBlob(current, "image/jpeg", quality);
      if (!jpeg || jpeg.type !== "image/jpeg") return null;
      if (jpeg.size <= limit) return jpeg;
    }
    if (current.width <= 320 || current.height <= 200) return null;
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.floor(current.width * 0.75));
    smaller.height = Math.max(1, Math.floor(current.height * 0.75));
    const context = smaller.getContext("2d");
    if (!context) return null;
    context.drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  return null;
}

export function captureImageFile(blob: Blob, name: string): File {
  const extension = blob.type === "image/png" ? "png" : "jpg";
  return new File([blob], `${name}.${extension}`, { type: blob.type });
}

/** Avoid re-encoding screenshots unless their original PNG exceeds the upload limit. */
export async function fitCaptureImage(blob: Blob, limit: number): Promise<Blob | null> {
  if ((blob.type === "image/png" || blob.type === "image/jpeg") && blob.size <= limit)
    return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return await encodeCaptureImage(canvas, limit, false);
  } finally {
    bitmap.close();
  }
}
