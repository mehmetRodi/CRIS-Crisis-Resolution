/** Unfiltered redacted report-update stream (CRIS-28, ADR-0046). */
export function request() {
  return {};
}

/** @param {import('@aws-appsync/utils').Context} ctx */
export function response(ctx) {
  return ctx.result;
}
