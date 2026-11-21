# Third-party notices

## React Grab

`src/local/browser-react-grab.bundle.js` contains the `getElementContext` primitive from
React Grab 0.1.32 (https://github.com/aidenybai/react-grab), bundled with esbuild 0.28.2.
Copyright (c) 2025 Aiden Bai. MIT License:

```text
MIT License

Copyright (c) 2025 Aiden Bai

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

## T3 Code

ADE includes code adapted from T3 Code (https://github.com/pingdotgg/t3code), copyright (c) 2026 T3 Tools Inc., released under the MIT License. The adapted files start with a header naming the T3 source path. The agent browser ports T3's server-streamed browser, its session control, the mini player layout and the agent cursor logic, and also T3's pinned headless-shell installer, its browser contexts and launch flags, its host launch diagnostics and its `browser setup` command.

Files containing adapted code (each file's header names the T3 source path it was taken from):

- `scripts/browser-setup.mjs`
- `src/components/ade/browser/AgentCursor.tsx`
- `src/components/ade/browser/BrowserChromeRow.tsx`
- `src/components/ade/browser/BrowserFileNotShown.tsx`
- `src/components/ade/browser/BrowserMiniPlayer.tsx`
- `src/components/ade/browser/BrowserSurface.tsx`
- `src/components/ade/browser/BrowserUnreachable.tsx`
- `src/components/ade/browser/BrowserViewportHandles.tsx`
- `src/components/ade/browser/useBrowserShortcuts.ts`
- `src/components/ade/browser/useBrowserCapture.ts`
- `src/lib/ade/browser/agentCursorLogic.d.mts`
- `src/lib/ade/browser/agentCursorLogic.mjs`
- `src/lib/ade/browser/agentCursorLogic.test.mjs`
- `src/lib/ade/browser/browserStream.ts`
- `src/lib/ade/browser/miniPlayerLayout.d.mts`
- `src/lib/ade/browser/miniPlayerLayout.mjs`
- `src/lib/ade/browser/miniPlayerLayout.test.mjs`
- `src/lib/ade/browser/streamInput.d.mts`
- `src/lib/ade/browser/streamInput.mjs`
- `src/lib/ade/browser/streamInput.test.mjs`
- `src/local/browser-contexts.mjs`
- `src/local/browser-control.mjs`
- `src/local/browser-control.test.mjs`
- `src/local/browser-downloads.mjs`
- `src/local/browser-favicon.mjs`
- `src/local/browser-host.mjs`
- `src/local/browser-import-chromium.mjs`
- `src/local/browser-import-firefox.mjs`
- `src/local/browser-import-safari.mjs`
- `src/local/browser-install.mjs`
- `src/local/browser-inspection.mjs`
- `src/local/browser-secret-linux.py`
- `src/local/browser-local-servers.mjs`
- `src/local/browser-local-servers.test.mjs`
- `src/local/browser-page.mjs`
- `src/local/browser-profiles.mjs`
- `src/local/browser-recording-input.mjs`
- `src/local/browser-stream-server.mjs`
- `src/local/browser-stream-server.test.mjs`
- `src/shared/browser-address.mjs`

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

## beUI

ADE's Activity pane uses the Agent Activity component from beUI (https://beui.dev), copyright (c) 2026 Saurabh Chauhan, released under the MIT License. The files were copied as published, and each starts with a header naming the source. Where a file differs from the original, the change is marked `// ADE:`. The license text is also in `src/components/agents/BEUI-LICENSE`.

Files copied from beUI:

- `src/components/agents/agent-activity/activity-row.tsx`
- `src/components/agents/agent-activity/index.tsx`
- `src/components/agents/agent-activity/types.ts`
- `src/components/agents/agent-disclosure.tsx`
- `src/components/agents/loading-states/thinking-shimmer.tsx`
- `src/lib/ease.ts`

The full license text, copied from the beUI repository:

```text
MIT License

Copyright (c) 2026 Saurabh Chauhan

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

## Chromium DevTools

The developer tools frontend is distributed by the `@chrome-devtools/devtools-app` package. It includes Chromium DevTools, copyright 2014 The Chromium Authors:

```text
// Copyright 2014 The Chromium Authors
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google Inc. nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

```
