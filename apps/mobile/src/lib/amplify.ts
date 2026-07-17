// Polyfills first, before any Amplify import: URL/base64/crypto shims plus
// crypto.getRandomValues that Amplify's credential/uuid machinery needs.
import '@aws-amplify/react-native';
import 'react-native-get-random-values';

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';

import type { Schema } from '../../../web/amplify/data/resource';
import outputs from '../../../web/amplify_outputs.json';

/**
 * Amplify runtime wiring for the mobile app.
 *
 * Both clients share ONE backend (ADR-0020): the definition and its generated
 * `amplify_outputs.json` live under `apps/web/amplify*`, so the mobile app
 * imports them across the workspace instead of duplicating them. The outputs
 * file is produced by `npx ampx sandbox` / the pipeline and is git-ignored; the
 * ambient wildcard declaration in `src/types/amplify-outputs.d.ts` keeps the
 * typecheck green when it is absent (same pattern as the web app, ADR-0012).
 *
 * Configuration is a module side effect so it runs once at import time —
 * `index.ts` imports this module before the app registers.
 */
Amplify.configure(outputs);

/**
 * The single typed GraphQL client for the app. `identityPool` auth is the
 * default for every call (CRIS-7, ADR-0022) — guests AND signed-in citizens
 * submit the same way; `submitReport` allows both `allow.guest()` and
 * `allow.authenticated('identityPool')`. Sign-in (`AuthContext`,
 * `screens/auth/*`) is a separate, optional identity layer on top.
 */
export const client = generateClient<Schema>({ authMode: 'identityPool' });
