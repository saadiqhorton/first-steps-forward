import test from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_OPEN_EVENT,
  isPreviewableFile,
  isPreviewableUrl,
  previewFileUrl,
  requestPreviewFileOpen,
  requestPreviewOpen,
  workspaceFileFromLink,
} from "./openInPreview.mjs";

test("only http and https addresses open in the preview browser", () => {
  assert.equal(isPreviewableUrl("http://localhost:5173/"), true);
  assert.equal(isPreviewableUrl("HTTPS://example.test/a"), true);
  assert.equal(isPreviewableUrl("file:///tmp/report.pdf"), false);
  assert.equal(isPreviewableUrl("mailto:dev@example.test"), false);
  assert.equal(isPreviewableUrl("javascript:alert(1)"), false);
  assert.equal(isPreviewableUrl(""), false);
  assert.equal(isPreviewableUrl(null), false);
});

test("chat file links are recognised only for local HTML pages and PDFs", () => {
  assert.equal(isPreviewableFile("docs/index.html"), true);
  assert.equal(isPreviewableFile("report.PDF?download=1"), true);
  assert.equal(isPreviewableFile("photo.png"), false);
  assert.equal(workspaceFileFromLink("docs/index.html"), "docs/index.html");
  assert.equal(workspaceFileFromLink("./site/page.htm#top"), "./site/page.htm");
  assert.equal(workspaceFileFromLink("docs/index.html?from=chat"), "docs/index.html");
  assert.equal(workspaceFileFromLink("/home/me/project/report.pdf"), "/home/me/project/report.pdf");
  assert.equal(
    workspaceFileFromLink("file:///home/me/project/index.html"),
    "/home/me/project/index.html",
  );
  assert.equal(workspaceFileFromLink("https://example.test/index.html"), null);
  assert.equal(workspaceFileFromLink("mailto:dev@example.test"), null);
  assert.equal(workspaceFileFromLink("#section"), null);
  assert.equal(workspaceFileFromLink("diagram.png"), null);
});

test("opening a link announces it once, and a file becomes an ADE asset URL", () => {
  const events = [];
  globalThis.window = {
    location: { origin: "http://127.0.0.1:3100" },
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    },
  };
  try {
    assert.equal(requestPreviewOpen("https://example.test/a"), true);
    assert.equal(requestPreviewOpen("mailto:dev@example.test"), false);
    assert.equal(requestPreviewFileOpen("project 1", "build/report.pdf"), true);
    assert.deepEqual(
      events.map((event) => [event.type, event.detail]),
      [
        [BROWSER_OPEN_EVENT, { url: "https://example.test/a" }],
        [
          BROWSER_OPEN_EVENT,
          {
            url: "http://127.0.0.1:3100/api/projects/project%201/browser/files/build/report.pdf",
          },
        ],
      ],
    );
    assert.equal(
      previewFileUrl("p", "a b.html"),
      "http://127.0.0.1:3100/api/projects/p/browser/files/a%20b.html",
    );
    assert.equal(
      previewFileUrl("p", "/home/me/site/index.html"),
      "http://127.0.0.1:3100/api/projects/p/browser/files/%2Fhome%2Fme%2Fsite%2Findex.html",
    );
  } finally {
    delete globalThis.window;
  }
});
