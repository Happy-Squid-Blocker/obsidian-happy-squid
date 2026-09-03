/**
 * The hosted project's connection values, mirroring src/real/backend-config.ts
 * in the extension. All three are public by design and ship in every store
 * bundle there, so repeating them in a plugin bundle gives nothing away.
 *
 * They are duplicated rather than imported because this plugin builds on its
 * own, outside the extension's vite config, and a build-time import across that
 * boundary would drag `import.meta.env` in with it.
 */
export const SUPABASE_URL = "https://dtptcpfaeqstzzdumfeb.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Y5IcTkTqpNR_-zL_A9nXag_9IqfWME7";

/** Every Edge Function is a sibling under the same base. */
export function functionUrl(name: string): string {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}
