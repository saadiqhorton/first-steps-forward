// Profile defaults and limits follow T3 Code's packages/contracts/src/browserProfile.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import { browserScopeParts } from "./browser-scope.mjs";

export const DEFAULT_PROFILE_ID = "default";
export const INCOGNITO_PROFILE_ID = "incognito";
const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function browserProfiles(project) {
  const named = Array.isArray(project?.browserProfiles) ? project.browserProfiles : [];
  return [
    { id: DEFAULT_PROFILE_ID, name: "Default" },
    { id: INCOGNITO_PROFILE_ID, name: "Incognito" },
    ...named.filter(
      (profile) =>
        profile &&
        typeof profile.id === "string" &&
        PROFILE_ID.test(profile.id) &&
        typeof profile.name === "string" &&
        profile.name.trim().length > 0,
    ),
  ];
}

export function selectedBrowserProfile(state, project, scope) {
  const { sessionId } = browserScopeParts(scope);
  const session =
    sessionId &&
    state.sessions.find((item) => item.id === sessionId && item.projectId === project.id);
  const selected =
    (session && project.browserSessionProfiles?.[session.id]) ??
    session?.browserProfile ??
    project.browserProfile ??
    DEFAULT_PROFILE_ID;
  return browserProfiles(project).some((profile) => profile.id === selected)
    ? selected
    : DEFAULT_PROFILE_ID;
}

// Preserve the existing default profile directory and its logins.
export function browserProfileStorageKey(projectId, profileId) {
  return profileId === DEFAULT_PROFILE_ID
    ? projectId
    : `ade-profile:${JSON.stringify([projectId, profileId])}`;
}
