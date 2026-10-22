//! Typo tolerance: the words that start like the query, give or take a few edits.
//!
//! One walk over the sorted words. The distance table (query × word prefix) is kept per depth, and a word that shares its first `lcp`
//! letters with the one before reuses those rows, so the work is the number of distinct prefixes that stay within reach, not the number
//! of words. A prefix whose whole row is beyond the limit cannot lead back, so every word below it is skipped.
use super::Vocab;

/// Longest query that is matched with tolerance.
pub(crate) const MAX_QUERY: usize = 24;
const WIDTH: usize = MAX_QUERY + 1;
const DEPTH: usize = MAX_QUERY + 3;

impl Vocab {
    /// Calls `found(word, edits, length)` for every live ASCII word that has a prefix of `length` letters within `max` edits of `query`
    /// (edits: insert, delete, replace, swap two neighbours). `edits` is the smallest over all prefixes.
    pub fn each_near(&self, query: &[u8], max: u8, mut found: impl FnMut(u32, u8, usize)) {
        let n = query.len();
        if n == 0 || n > MAX_QUERY {
            return;
        }
        let cap = n + max as usize;
        let mut rows = [[0u8; WIDTH]; DEPTH];
        let mut mins = [0u8; DEPTH];
        // best[d] = (smallest edit count, depth where it was reached) over the prefixes of length 0..=d
        let mut best = [(u8::MAX, 0usize); DEPTH];
        for (i, cell) in rows[0].iter_mut().enumerate().take(n + 1) {
            *cell = i as u8;
        }
        best[0] = (n as u8, 0);
        let mut reached = 0usize;
        let mut dead = usize::MAX;
        for position in 0..self.sorted.len() {
            let shared = if position == 0 { 0 } else { self.lcp[position] as usize };
            if shared >= dead {
                continue;
            }
            dead = usize::MAX;
            let word = self.sorted[position];
            let text = self.text(word).as_bytes();
            let top = text.len().min(cap);
            let mut depth = shared.min(reached);
            while depth < top {
                depth += 1;
                let c = text[depth - 1];
                rows[depth][0] = depth as u8;
                let mut low = depth as u8;
                for i in 1..=n {
                    let cost = u8::from(query[i - 1] != c);
                    let mut cell = (rows[depth - 1][i - 1] + cost).min(rows[depth - 1][i] + 1).min(rows[depth][i - 1] + 1);
                    if depth > 1 && i > 1 && query[i - 1] == text[depth - 2] && query[i - 2] == c {
                        cell = cell.min(rows[depth - 2][i - 2] + 1);
                    }
                    rows[depth][i] = cell;
                    low = low.min(cell);
                }
                mins[depth] = low;
                best[depth] = if rows[depth][n] < best[depth - 1].0 { (rows[depth][n], depth) } else { best[depth - 1] };
                if best[depth].0 > max && low > max && mins[depth - 1] >= max {
                    dead = depth;
                    break;
                }
            }
            reached = depth;
            if dead == usize::MAX && best[reached].0 <= max && text.is_ascii() && !self.post[word as usize].is_empty() {
                found(word, best[reached].0, best[reached].1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near_with_length(words: &[&str], query: &str, max: u8) -> Vec<(String, u8, usize)> {
        let mut v = Vocab::new();
        for (i, w) in words.iter().enumerate() {
            let id = v.intern(w);
            v.attach(id, i as u32);
        }
        let mut out = Vec::new();
        v.each_near(query.as_bytes(), max, |w, d, len| out.push((v.text(w).to_string(), d, len)));
        out.sort();
        out
    }

    fn near(words: &[&str], query: &str, max: u8) -> Vec<(String, u8)> {
        near_with_length(words, query, max).into_iter().map(|(w, d, _)| (w, d)).collect()
    }

    fn pair(word: &str, edits: u8) -> (String, u8) {
        (word.to_string(), edits)
    }

    #[test]
    fn typos_in_the_middle_end_and_start_are_found() {
        let words = ["hauptstrasse", "markt", "marktplatz", "mühle", "linde"];
        assert_eq!(near(&words, "hauptstrase", 1), [pair("hauptstrasse", 1)]);
        assert_eq!(near(&words, "hauotstr", 1), [pair("hauptstrasse", 1)]);
        assert_eq!(near(&words, "uaupt", 1), [pair("hauptstrasse", 1)]);
        assert_eq!(near(&words, "mrakt", 1), [pair("markt", 1), pair("marktplatz", 1)]);
    }

    #[test]
    fn the_length_is_where_the_smallest_distance_was_first_reached() {
        assert_eq!(near_with_length(&["hauptstrasse"], "hauotstr", 1), [("hauptstrasse".to_string(), 1, 8)]);
        // "hauptstras" is one deletion away from the query: the match ends there, not at the end of the word
        assert_eq!(near_with_length(&["hauptstrasse"], "hauptstrase", 1), [("hauptstrasse".to_string(), 1, 10)]);
    }

    #[test]
    fn a_swap_costs_one_edit() {
        assert_eq!(near(&["markt"], "makrt", 1), [pair("markt", 1)]);
    }

    #[test]
    fn two_edits_need_the_limit() {
        let words = ["hauptstrasse"];
        assert!(near(&words, "hauotstrsse", 1).is_empty());
        assert_eq!(near(&words, "hauotstrsse", 2), [pair("hauptstrasse", 2)]);
    }

    #[test]
    fn unrelated_words_and_non_ascii_words_are_not_reported() {
        assert!(near(&["linde", "mühle"], "hauptstrasse", 2).is_empty());
        assert!(near(&["mühle"], "muhle", 1).is_empty());
    }

    #[test]
    fn many_words_with_a_shared_start_are_all_checked() {
        let words = ["kirch", "kirchberg", "kirchgasse", "kirchhof", "kirchweg", "kirsche"];
        let names: Vec<String> = near(&words, "kirchb", 1).into_iter().map(|(w, _)| w).collect();
        assert_eq!(names, ["kirch", "kirchberg", "kirchgasse", "kirchhof", "kirchweg"]);
    }
}
