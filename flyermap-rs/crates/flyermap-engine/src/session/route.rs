//! Routing between street pieces on a graph of every segment (hidden connectors included).
use super::*;
use std::cmp::Ordering;
use std::collections::BinaryHeap;

/// Street graph for routing: every segment (hidden connectors included), nodes interned, first Area wins.
#[derive(Default)]
pub(super) struct RouteGraph {
    pub(super) ids: Vec<String>,
    pub(super) index: FxHashMap<String, u32>,
    pub(super) from: Vec<u32>,
    pub(super) to: Vec<u32>,
    pub(super) length: Vec<f64>,
    pub(super) visible: Vec<bool>,
    pub(super) name: Vec<Option<String>>,
    pub(super) group: Vec<u32>,
    pub(super) house_count: Vec<u32>,
    /// houses along each junction-to-junction street (sum over its pieces), by group index
    pub(super) group_houses: Vec<u32>,
    pub(super) groups: FxHashMap<String, u32>,
    /// segment indices touching each node, in insertion order (the same order the TypeScript reference iterates)
    pub(super) at: Vec<Vec<u32>>,
    pub(super) nodes: FxHashMap<String, u32>,
}

impl RouteGraph {
    fn node(&mut self, key: &str) -> u32 {
        if let Some(&n) = self.nodes.get(key) {
            return n;
        }
        let n = self.at.len() as u32;
        self.nodes.insert(key.to_string(), n);
        self.at.push(Vec::new());
        n
    }
    pub(super) fn add(&mut self, s: &Segment) {
        if self.index.contains_key(&s.id) {
            return;
        }
        let i = self.ids.len() as u32;
        let (from, to) = (self.node(&s.from), self.node(&s.to));
        self.index.insert(s.id.clone(), i);
        self.ids.push(s.id.clone());
        self.from.push(from);
        self.to.push(to);
        self.length.push(s.length);
        self.visible.push(s.visible);
        let group = match self.groups.get(&s.group) {
            Some(&g) => g,
            None => {
                let g = self.group_houses.len() as u32;
                self.groups.insert(s.group.clone(), g);
                self.group_houses.push(0);
                g
            }
        };
        self.group_houses[group as usize] += s.house_count;
        self.name.push(s.name.clone());
        self.group.push(group);
        self.house_count.push(s.house_count);
        self.at[from as usize].push(i);
        self.at[to as usize].push(i);
    }
}

/// Min-heap entry ordered by (cost, segment order), like the reference implementation.
struct Item {
    cost: f64,
    order: u32,
}
impl PartialEq for Item {
    fn eq(&self, o: &Self) -> bool {
        self.cost == o.cost && self.order == o.order
    }
}
impl Eq for Item {}
impl PartialOrd for Item {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Item {
    fn cmp(&self, o: &Self) -> Ordering {
        // BinaryHeap is a max-heap: reverse so the smallest (cost, order) pops first
        o.cost
            .partial_cmp(&self.cost)
            .unwrap_or(Ordering::Equal)
            .then(o.order.cmp(&self.order))
    }
}

pub enum RouteOut {
    Selected {
        ids: Vec<String>,
        length: f64,
        ambiguous: bool,
    },
    Disconnected,
}

impl RouteGraph {
    fn shortest(&self, from: u32, to: u32, banned: Option<u32>) -> Option<(Vec<u32>, f64)> {
        if from == to {
            return Some((vec![from], self.length[from as usize]));
        }
        let n = self.ids.len();
        let mut dist = vec![f64::INFINITY; n];
        let mut prev = vec![u32::MAX; n];
        let mut heap = BinaryHeap::new();
        dist[from as usize] = 0.0;
        heap.push(Item {
            cost: 0.0,
            order: from,
        });
        while let Some(Item { cost, order: id }) = heap.pop() {
            if cost > dist[id as usize] {
                continue;
            }
            if id == to {
                break;
            }
            for node in [self.from[id as usize], self.to[id as usize]] {
                for &next in &self.at[node as usize] {
                    if next == id || Some(next) == banned {
                        continue;
                    }
                    let step = self.length[next as usize]
                        * if self.visible[next as usize] {
                            1.0
                        } else {
                            1.6
                        };
                    let cost_next = cost + step;
                    if cost_next < dist[next as usize] {
                        dist[next as usize] = cost_next;
                        prev[next as usize] = id;
                        heap.push(Item {
                            cost: cost_next,
                            order: next,
                        });
                    }
                }
            }
        }
        if dist[to as usize] == f64::INFINITY {
            return None;
        }
        let mut ids = vec![to];
        while *ids.last().unwrap() != from {
            ids.push(prev[*ids.last().unwrap() as usize]);
        }
        ids.reverse();
        let length = ids
            .iter()
            .fold(0.0, |sum, &i| sum + self.length[i as usize]);
        Some((ids, length))
    }

    /// Shortest route through the anchors in order; `ambiguous` when banning any (sampled) interior piece still leaves a route within 12 %.
    pub(super) fn route(&self, anchors: &[String]) -> RouteOut {
        let mut idx = Vec::with_capacity(anchors.len());
        for a in anchors {
            match self.index.get(a) {
                Some(&i) => idx.push(i),
                None => return RouteOut::Disconnected,
            }
        }
        if idx.is_empty() {
            return RouteOut::Disconnected;
        }
        let mut merged: Vec<u32> = Vec::new();
        let mut ambiguous = false;
        for w in idx.windows(2) {
            let Some((ids, length)) = self.shortest(w[0], w[1], None) else {
                return RouteOut::Disconnected;
            };
            for &id in &ids {
                if merged.last() != Some(&id) {
                    merged.push(id);
                }
            }
            let interior = if ids.len() > 2 {
                &ids[1..ids.len() - 1]
            } else {
                &ids[0..0]
            };
            let step = ((interior.len() as f64 / 12.0).ceil() as usize).max(1);
            let mut k = 0;
            while k < interior.len() {
                if let Some((_, alt)) = self.shortest(w[0], w[1], Some(interior[k])) {
                    if alt <= length * 1.12 {
                        ambiguous = true;
                        break;
                    }
                }
                k += step;
            }
        }
        if idx.len() == 1 {
            merged.push(idx[0]);
        }
        let length = merged
            .iter()
            .fold(0.0, |sum, &i| sum + self.length[i as usize]);
        RouteOut::Selected {
            ids: merged
                .iter()
                .map(|&i| self.ids[i as usize].clone())
                .collect(),
            length,
            ambiguous,
        }
    }
}

impl Session {
    /// Route between street pieces (ids), through every anchor in order.
    pub fn route(&self, anchors: &[String]) -> RouteOut {
        self.graph.route(anchors)
    }
}
