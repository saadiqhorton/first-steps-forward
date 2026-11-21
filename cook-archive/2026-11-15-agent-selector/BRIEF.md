# Brief: ADE agent selector and updater

Target: Align the ADE project agent/model selector with the supplied enjoy.dev screens and make agent CLI update detection and in-app updates reliable. Stack: existing React, TypeScript and Node local service.
References: R01 Claude, R02 Codex, R03 OpenCode, supplied attachment screenshots; Use the screenshots for structure and behavior while retaining ADE’s existing design system and only capabilities ADE supports.
Bar (eyeballed similarity target, 0–100): layout and spacing 99.9; color 99.9; typography and components 99.9; detail density 99.9; interaction 99.9. Calibration: none yet.
Rules: Preserve existing ADE behavior and user changes. Do not invent unsupported agent capabilities, usage figures or presets. Retain accessible interaction and responsive behavior. Existing project styling and assets may be used.
Time: focused change, one-hour cap, confirmed by user. Started 2026-11-15 09:25 America/New_York. Usage limits: not provided. Hardware: local Chromium.
Deliverable: working ADE UI and local updater code, verified locally. Permissions: no push or publication requested; source and skill downloads allowed.
User's words: "our ade project model selector part needs to match up more properly with how enjoy.dev handles. also we need to ensure that the updater is properly detecting updates timely and we can seamlessly update in ade ui."
