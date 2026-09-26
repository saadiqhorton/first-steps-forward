const QUOTA =
  /\b(?:usage limit|rate limit|quota(?: exceeded)?|insufficient (?:credits|funds)|out of (?:credits|usage)|billing(?: error)?)\b/i;

/**
 * Classify a failed agent turn. The provider's own wording is treated as
 * untrusted input: we only look for known quota/limit phrasing to give the
 * user a more accurate recovery path. Everything else stays a generic
 * process failure — never reported as success.
 */
export function classifyFailure(texts) {
  const joined = (texts ?? []).join("\n");
  if (QUOTA.test(joined)) return "provider_quota";
  return "process";
}

/** Extract the provider's own retry wording, if any (e.g. "try again at ..."). */
export function retryHint(texts) {
  const match = (texts ?? []).join("\n").match(/try again[^.\n]*/i);
  return match ? match[0].trim() : undefined;
}
