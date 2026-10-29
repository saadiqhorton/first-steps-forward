// The provider's own wording is treated as untrusted input: we only look for
// known failure phrasing to give the user a more accurate recovery path.
// Anything else stays a generic process failure — never reported as success.
// The strings below mix observed provider wording (including OpenCode's own
// error names, verified against its source) with common CLI phrasings.

const QUOTA =
  /\b(?:usage limit|rate limit|quota(?: exceeded)?|insufficient (?:credits|funds)|out of (?:credits|usage)|billing(?: error)?)\b|insufficient_quota|\b(?:FreeUsageLimitError|GoUsageLimitError)\b/i;

// The CLI rejected the selected model id itself.
const MODEL_NOT_FOUND =
  /Model not found:|"name"\s*:\s*"ModelNotFoundError"|\b(?:Provider)?ModelNotFoundError\b|\b(?:unknown|invalid|unsupported|not found|unavailable|does not exist)\s+model\b|\bmodel\b[^\n]{0,60}\b(?:not found|not available|unavailable|unsupported|invalid|unknown|does not exist|is not available)\b|no models matching|\bmodel\b[^\n]{0,60}\b(?:not authorized|no access|not on your (?:plan|tier)|plan (?:does not|doesn't) include|requires (?:a |an )?(?:higher|different) (?:plan|tier))\b|model_availability/i;

// The provider behind the agent could not be used at all (nothing to do with
// the chosen model id).
const PROVIDER_UNAVAILABLE =
  /No providers are available|No models are available for provider:|Failed to initialize provider/i;

// The agent's sign-in/credentials were refused; recovery is the CLI's own
// re-auth flow, not a different model. "Authentication required" is how
// ADE's ACP client words the protocol's -32000 error.
const AUTH_EXPIRED =
  /\bProviderAuthError\b|Unauthorized: request was blocked|authentication (?:has )?expired|\b401\b[^\n]{0,60}unauthoriz|unauthoriz[^\n]{0,60}\b401\b|invalid (?:api )?key|^Authentication required: /im;

const CONTEXT_OVERFLOW = /context_length_exceeded|Input exceeds context window/i;

/**
 * Classify a failed agent turn into a distinct, recoverable state. Order
 * matters: quota is checked first so mixed wording still routes to the
 * billing recovery path before model- or provider-specific patterns.
 */
export function classifyFailure(texts) {
  const joined = (texts ?? []).join("\n");
  if (QUOTA.test(joined)) return "provider_quota";
  if (MODEL_NOT_FOUND.test(joined)) return "model_not_found";
  if (PROVIDER_UNAVAILABLE.test(joined)) return "provider_unavailable";
  if (AUTH_EXPIRED.test(joined)) return "auth_expired";
  if (CONTEXT_OVERFLOW.test(joined)) return "context_overflow";
  return "process";
}

/** Extract the provider's own retry wording, if any (e.g. "try again at ..."). */
export function retryHint(texts) {
  const match = (texts ?? []).join("\n").match(/try again[^.\n]*/i);
  return match ? match[0].trim() : undefined;
}

/**
 * Extract a provider's own "Did you mean ..." suggestion verbatim (opencode
 * prints candidates when a model id is unknown). Bounded and single-line so
 * untrusted CLI output cannot balloon the message.
 */
export function modelSuggestion(texts) {
  const match = (texts ?? []).join("\n").match(/did you mean[^\n]{0,240}/i);
  return match
    ? `${match[0].trim().replace(/\s+$/, "")}${/[?.!]$/.test(match[0]) ? "" : "."}`
    : undefined;
}
