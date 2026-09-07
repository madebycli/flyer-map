export type LiveGroupCreationDefaults = {
  discoverable: true;
  state: "active";
};

/**
 * Product defaults only. No credential, room code, QR token or authority is
 * created here; those remain server-side security concerns under ADR-0014.
 */
export function liveGroupCreationDefaults(): LiveGroupCreationDefaults {
  return {
    discoverable: true,
    state: "active",
  };
}
