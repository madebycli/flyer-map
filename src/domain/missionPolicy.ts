/**
 * The 2026-09-02 release branch deliberately uses manually created Streets.
 *
 * Keep the server preparation implementation intact for a later, separately
 * verified rollout. This single policy is shared by the browser and Worker so
 * the product cannot accidentally show a path that the Worker still runs.
 */
export const AUTO_AREA_PREPARATION_ENABLED = false;
