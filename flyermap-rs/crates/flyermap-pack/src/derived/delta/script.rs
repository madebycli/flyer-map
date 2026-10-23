//! A list of things (segments, houses) as an edit script over the old list: runs copied from it, and new or changed things added. Things
//! are matched by their stable id; a thing counts as unchanged only when its bytes are, so the list built from the script is byte for byte
//! the new one, in the new one's order.
use super::super::error::DerivedError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Op<T> {
    /// `len` things of the old list from `start` on, unchanged.
    Copy { start: u32, len: u32 },
    /// Things that are new or changed.
    Add(Vec<T>),
}

/// The script that turns `old` into `new`. `id` is a thing's stable id; `same(j, i)` says whether old thing `j` and new thing `i` are
/// byte-identical.
pub fn script<T: Clone>(old: &[T], new: &[T], id: impl Fn(&T) -> &str, same: impl Fn(usize, usize) -> bool) -> Vec<Op<T>> {
    let mut at: HashMap<&str, usize> = HashMap::with_capacity(old.len());
    for (j, thing) in old.iter().enumerate() {
        // On a repeated id the first stays; the later ones are added whole, which is always right.
        at.entry(id(thing)).or_insert(j);
    }
    let mut ops: Vec<Op<T>> = Vec::new();
    for (i, thing) in new.iter().enumerate() {
        match at.get(id(thing)).copied().filter(|&j| same(j, i)) {
            Some(j) => match ops.last_mut() {
                Some(Op::Copy { start, len }) if *start as usize + *len as usize == j => *len += 1,
                _ => ops.push(Op::Copy { start: j as u32, len: 1 }),
            },
            None => match ops.last_mut() {
                Some(Op::Add(things)) => things.push(thing.clone()),
                _ => ops.push(Op::Add(vec![thing.clone()])),
            },
        }
    }
    ops
}

/// The list a script makes from `old`. `expected` is the length the delta's head promises; a script that runs past it, points outside `old`
/// or falls short is refused, so a damaged or hostile delta cannot grow memory without bound.
pub fn build<T: Clone>(old: &[T], ops: &[Op<T>], expected: usize) -> Result<Vec<T>, DerivedError> {
    let mut out: Vec<T> = Vec::with_capacity(expected.min(old.len().saturating_mul(2)).max(16));
    for op in ops {
        match op {
            Op::Copy { start, len } => {
                let (start, len) = (*start as usize, *len as usize);
                let end = start.checked_add(len).filter(|&end| end <= old.len()).ok_or(DerivedError::DeltaMismatch)?;
                if out.len().saturating_add(len) > expected {
                    return Err(DerivedError::DeltaMismatch);
                }
                out.extend_from_slice(&old[start..end]);
            }
            Op::Add(things) => {
                if out.len().saturating_add(things.len()) > expected {
                    return Err(DerivedError::DeltaMismatch);
                }
                out.extend(things.iter().cloned());
            }
        }
    }
    if out.len() != expected {
        return Err(DerivedError::DeltaMismatch);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(old: &[(&str, u8)], new: &[(&str, u8)]) -> Vec<Op<(String, u8)>> {
        let (o, n): (Vec<_>, Vec<_>) =
            (old.iter().map(|(k, v)| (k.to_string(), *v)).collect::<Vec<_>>(), new.iter().map(|(k, v)| (k.to_string(), *v)).collect::<Vec<_>>());
        let ops = script(&o, &n, |t| t.0.as_str(), |j, i| o[j] == n[i]);
        assert_eq!(build(&o, &ops, n.len()).unwrap(), n, "the script rebuilds the new list");
        ops
    }

    #[test]
    fn unchanged_runs_are_copied_and_the_rest_added() {
        let ops = run(&[("a", 1), ("b", 1), ("c", 1), ("d", 1)], &[("a", 1), ("b", 2), ("c", 1), ("d", 1), ("e", 1)]);
        assert_eq!(ops, vec![Op::Copy { start: 0, len: 1 }, Op::Add(vec![("b".into(), 2)]), Op::Copy { start: 2, len: 2 }, Op::Add(vec![("e".into(), 1)])]);
    }

    #[test]
    fn removals_moves_and_repeated_ids_still_rebuild_exactly() {
        run(&[("a", 1), ("b", 1), ("c", 1)], &[("c", 1), ("a", 1)]);
        run(&[("a", 1), ("a", 2), ("b", 1)], &[("b", 1), ("a", 2), ("a", 1)]);
        run(&[], &[("x", 1)]);
        run(&[("x", 1)], &[]);
    }

    #[test]
    fn a_script_that_does_not_fit_is_refused() {
        let old = vec![1u8, 2, 3];
        assert!(build(&old, &[Op::Copy { start: 2, len: 2 }], 2).is_err());
        assert!(build(&old, &[Op::Copy { start: 0, len: 3 }], 2).is_err());
        assert!(build(&old, &[Op::Copy { start: 0, len: 2 }], 3).is_err());
        assert!(build(&old, &[Op::Copy { start: u32::MAX, len: u32::MAX }], 3).is_err());
        assert!(build(&old, &[Op::Add(vec![9])], 1).is_ok());
    }
}
