# Diff tab + Activity logs design

**Date:** 2026-10-01

## Goal

Move “Files changed” out of the Activity right pane into a new top-level **Diff** tab. Leave Logs under Checks in Activity, and make Logs auto-follow new output.

## Decisions

- Tab order: `Activity · Diff · Preview · Terminal`
- Diff content is the existing Files changed / `DiffView` UI — no redesign
- Activity keeps Agent context → Checks → Logs (Files changed removed)
- Log auto-scroll: stick-to-bottom when near the bottom; pause when the user scrolls up (same idea as the chat transcript)

## Out of scope

- Redesigning DiffView or log formatting
- Changing Preview / Terminal behavior
