/**
 * Ambient fallback declaration for the generated `amplify_outputs.json`.
 *
 * That file is produced by `npx ampx sandbox` / the pipeline build and is
 * git-ignored (it carries environment-specific Cognito / AppSync / S3 ids).
 * It therefore does NOT exist on a fresh CI checkout, which would otherwise
 * break `tsc` with TS2307 on `import outputs from '../../amplify_outputs.json'`.
 *
 * When the real file is present (local dev, deployed builds) TypeScript resolves
 * it directly and this wildcard declaration is ignored. When it is absent (CI
 * typecheck of the scaffold) this declaration supplies the type so the import
 * resolves. The value is typed loosely because its shape is owned by Amplify's
 * codegen, not by us; `Amplify.configure` accepts it at runtime.
 */
declare module '*amplify_outputs.json' {
  const outputs: Record<string, unknown>;
  export default outputs;
}
