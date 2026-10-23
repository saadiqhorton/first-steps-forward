# Third-party notices

## T3 Code

ADE includes code adapted from T3 Code (https://github.com/pingdotgg/t3code), copyright (c) 2026 T3 Tools Inc., released under the MIT License. The adapted files start with a header naming the T3 source path. The agent browser ports T3's server-streamed browser, its session control, the mini player layout and the agent cursor logic, and also T3's pinned headless-shell installer, its browser contexts and launch flags, its host launch diagnostics and its `browser setup` command.

Files containing adapted code (each file's header names the T3 source path it was taken from):

- `scripts/browser-setup.mjs`
- `src/components/ade/browser/AgentCursor.tsx`
- `src/components/ade/browser/BrowserChromeRow.tsx`
- `src/components/ade/browser/BrowserMiniPlayer.tsx`
- `src/components/ade/browser/BrowserSurface.tsx`
- `src/lib/ade/browser/agentCursorLogic.d.mts`
- `src/lib/ade/browser/agentCursorLogic.mjs`
- `src/lib/ade/browser/agentCursorLogic.test.mjs`
- `src/lib/ade/browser/browserStream.ts`
- `src/lib/ade/browser/miniPlayerLayout.d.mts`
- `src/lib/ade/browser/miniPlayerLayout.mjs`
- `src/lib/ade/browser/miniPlayerLayout.test.mjs`
- `src/lib/ade/browser/pictureInPicture.ts`
- `src/lib/ade/browser/streamInput.d.mts`
- `src/lib/ade/browser/streamInput.mjs`
- `src/lib/ade/browser/streamInput.test.mjs`
- `src/local/browser-contexts.mjs`
- `src/local/browser-control.mjs`
- `src/local/browser-control.test.mjs`
- `src/local/browser-host.mjs`
- `src/local/browser-install.mjs`
- `src/local/browser-page.mjs`
- `src/local/browser-stream-server.mjs`
- `src/local/browser-stream-server.test.mjs`

The full license text, copied from the T3 Code repository:

```text
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
