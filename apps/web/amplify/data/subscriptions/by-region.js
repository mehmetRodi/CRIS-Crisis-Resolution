import { extensions, util } from '@aws-appsync/utils';

// Subscription handlers with enhanced filters return a null request payload.
export function request() {
  return { payload: null };
}

/** @param {import('@aws-appsync/utils').Context<{ regionId: string }>} ctx */
export function response(ctx) {
  extensions.setSubscriptionFilter(
    util.transform.toSubscriptionFilter({ regionId: { eq: ctx.args.regionId } }),
  );
  return null;
}
