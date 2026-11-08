// This worker intentionally exposes no messaging interface to web pages. ADE talks to it
// through its private Playwright connection, using Chromium's tab APIs in worker.evaluate.
chrome.tabs.onUpdated.addListener(() => {});
