/**
 * The way over to the Rust Worker (Plan 059, flyermap-rs): this Worker stays in front and hands the route groups named in `RUST_ROUTES` to the
 * Rust Worker behind the service binding `RUST_API`. Without the binding, or without the group in `RUST_ROUTES`, nothing changes.
 * If the call itself fails (the binding is broken, not an error answer), this Worker answers the request as before, so a bad Rust deployment
 * cannot take the app down.
 */
export type RustEnv = {
  RUST_API?: { fetch(request: Request): Promise<Response> };
  /** Comma separated groups, e.g. `v5`. */
  RUST_ROUTES?: string;
};

/** Route groups that can be handed over, by name. A group is listed here only once the Rust Worker answers all of it like this Worker. */
const GROUPS: Record<string, (pathname: string) => boolean> = {
  v5: (pathname) => pathname.startsWith('/api/v5/'),
};

export function rustGroups(value: string | undefined): string[] {
  return (value ?? '').split(',').map((g) => g.trim()).filter((g) => Object.hasOwn(GROUPS, g));
}

export function rustOwns(pathname: string, value: string | undefined): boolean {
  return rustGroups(value).some((g) => GROUPS[g](pathname));
}

/** The Rust Worker's answer, or `null` when this Worker answers itself. `onError` learns why a hand-over failed (no request data). */
export async function forwardToRust(request: Request, env: RustEnv, onError: (reason: string) => void = () => {}): Promise<Response | null> {
  if (!env.RUST_API || !rustOwns(new URL(request.url).pathname, env.RUST_ROUTES)) return null;
  try {
    return await env.RUST_API.fetch(request.clone());
  } catch (error) {
    onError(error instanceof Error ? error.name : 'unknown');
    return null;
  }
}
