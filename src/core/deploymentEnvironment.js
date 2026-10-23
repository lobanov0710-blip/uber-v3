// Staging is deliberately opt-in. Production and existing configurations
// keep their current notification behavior when APP_ENV is not set.
export function isStagingEnvironment(env) {
  return String(env?.APP_ENV ?? "")
    .trim()
    .toLowerCase() === "staging";
}
