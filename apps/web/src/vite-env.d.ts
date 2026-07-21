/// <reference types="vite/client" />

/**
 * Typed client-side Vite env vars. Only `VITE_`-prefixed values are exposed to
 * the browser bundle. Keep this in sync with `.env.example`.
 */
interface ImportMetaEnv {
  /** AWS region the client reads directly (see `.env.example`). */
  readonly VITE_AWS_REGION?: string;
  /**
   * MapLibre style descriptor for the base map (CRIS-13). When unset the map
   * falls back to a free public demo style; the deployed Amazon Location style
   * URL is injected here with no code change (TODO CRIS-24). See `mapStyle.ts`.
   */
  readonly VITE_MAP_STYLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
