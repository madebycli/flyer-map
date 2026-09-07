export type RemoteReadState = "loading" | "error" | "empty" | "data";

export function resolveRemoteReadState(input: {
  loading: boolean;
  error: string | null;
  itemCount: number;
}): RemoteReadState {
  if (input.itemCount > 0) return "data";
  if (input.loading) return "loading";
  if (input.error) return "error";
  return "empty";
}
