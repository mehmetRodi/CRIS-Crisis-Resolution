/**
 * Ambient fallback declaration for the generated `amplify_outputs.json`
 * (imported from `apps/web`, where the shared backend definition lives).
 *
 * The file is produced by `npx ampx sandbox` / the pipeline build and is
 * git-ignored, so it does not exist on a fresh CI checkout. When present,
 * TypeScript resolves the real JSON and ignores this; when absent, this
 * declaration keeps `tsc` green. Same pattern as the web app (ADR-0012).
 */
declare module '*amplify_outputs.json' {
  const outputs: Record<string, unknown>;
  export default outputs;
}
