import type { FieldNetwork as Network, FieldSegment as Segment } from './types.ts';

export type RouteResult =
  | { state: 'selected'; segmentIds: string[]; length: number; ambiguous: boolean }
  | { state: 'disconnected' };

type Graph = { byId: Map<string, Segment>; at: Map<string, string[]> };

export function buildGraph(network: Network): Graph {
  const byId = new Map<string, Segment>();
  const at = new Map<string, string[]>();
  for (const segment of network.segments) {
    byId.set(segment.id, segment);
    for (const key of [segment.from, segment.to]) {
      const list = at.get(key);
      if (list) list.push(segment.id); else at.set(key, [segment.id]);
    }
  }
  return { byId, at };
}

/** Binary min-heap keyed by cost. */
class Heap {
  private items: { cost: number; id: string }[] = [];
  get size() { return this.items.length; }
  push(cost: number, id: string) {
    const items = this.items; items.push({ cost, id });
    for (let i = items.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= items[i].cost) break;
      [items[parent], items[i]] = [items[i], items[parent]]; i = parent;
    }
  }
  pop() {
    const items = this.items, top = items[0], last = items.pop()!;
    if (items.length) {
      items[0] = last;
      for (let i = 0; ;) {
        let m = i; const l = 2 * i + 1, r = l + 1;
        if (l < items.length && items[l].cost < items[m].cost) m = l;
        if (r < items.length && items[r].cost < items[m].cost) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]]; i = m;
      }
    }
    return top;
  }
}

function shortest(graph: Graph, from: string, to: string, banned: ReadonlySet<string>): { ids: string[]; length: number } | null {
  if (from === to) return { ids: [from], length: graph.byId.get(from)!.length };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const heap = new Heap();
  heap.push(0, from);
  while (heap.size) {
    const { cost, id } = heap.pop();
    if (cost > (dist.get(id) ?? Infinity)) continue;
    if (id === to) break;
    const segment = graph.byId.get(id)!;
    for (const node of [segment.from, segment.to]) {
      for (const next of graph.at.get(node) ?? []) {
        if (next === id || banned.has(next)) continue;
        const target = graph.byId.get(next)!;
        // Entering a hidden connector costs extra so routes follow real streets when possible.
        const next_cost = cost + target.length * (target.visible ? 1 : 1.6);
        if (next_cost < (dist.get(next) ?? Infinity)) { dist.set(next, next_cost); prev.set(next, id); heap.push(next_cost, next); }
      }
    }
  }
  if (!dist.has(to)) return null;
  const ids = [to];
  while (ids[0] !== from) ids.unshift(prev.get(ids[0])!);
  return { ids, length: ids.reduce((sum, id) => sum + graph.byId.get(id)!.length, 0) };
}

/**
 * Shortest route between two clicked segments through optional waypoints. `ambiguous`
 * is set when a clearly different alternative of similar length exists, so the UI can
 * ask for a waypoint instead of silently guessing.
 */
export function routeSegments(network: Network | Graph, anchors: string[], graphCache?: Graph): RouteResult {
  const graph = graphCache ?? ('byId' in network ? network : buildGraph(network));
  if (anchors.length < 1 || anchors.some((id) => !graph.byId.has(id))) return { state: 'disconnected' };
  const merged: string[] = [];
  let ambiguous = false;
  for (let i = 0; i < anchors.length - 1; i++) {
    const leg = shortest(graph, anchors[i], anchors[i + 1], new Set());
    if (!leg) return { state: 'disconnected' };
    for (const id of leg.ids) if (merged[merged.length - 1] !== id) merged.push(id);
    // Probe: ban each interior segment in turn; a different route within 12% means ambiguity.
    const interior = leg.ids.slice(1, -1);
    const step = Math.max(1, Math.ceil(interior.length / 12)); // at most ~12 probes, spread along the route
    for (let k = 0; k < interior.length; k += step) {
      const banned = interior[k];
      const alt = shortest(graph, anchors[i], anchors[i + 1], new Set([banned]));
      if (alt && alt.length <= leg.length * 1.12) { ambiguous = true; break; }
    }
  }
  if (anchors.length === 1) merged.push(anchors[0]);
  return { state: 'selected', segmentIds: merged, length: merged.reduce((s, id) => s + graph.byId.get(id)!.length, 0), ambiguous };
}
