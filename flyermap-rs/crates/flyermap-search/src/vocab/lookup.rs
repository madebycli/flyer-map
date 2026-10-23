//! Finding words: by prefix (a range of the sorted ids) and by containing text (one scan of the arena).
use super::Vocab;
use std::ops::Range;

impl Vocab {
    /// The positions in the sorted order of the words that start with `prefix` (the word itself included).
    pub fn prefix_range(&self, prefix: &str) -> Range<usize> {
        let from = self.sorted.partition_point(|&w| self.text(w) < prefix);
        let len = self.sorted[from..].partition_point(|&w| self.text(w).starts_with(prefix));
        from..from + len
    }

    pub fn sorted_word(&self, position: usize) -> u32 {
        self.sorted[position]
    }

    /// Calls `found(word, byte position)` for every live word that contains `needle`, once per occurrence. The arena holds the words one
    /// after the other, so one pass of the standard substring search covers the whole vocabulary.
    pub fn each_containing(&self, needle: &str, mut found: impl FnMut(u32, usize)) {
        if needle.is_empty() || needle.contains('\n') {
            return;
        }
        for (offset, _) in self.arena.match_indices(needle) {
            let word = self.starts.partition_point(|&s| s as usize <= offset) - 1;
            if self.post[word].is_empty() {
                continue;
            }
            found(word as u32, offset - self.starts[word] as usize);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vocab(words: &[&str]) -> Vocab {
        let mut v = Vocab::new();
        for (i, w) in words.iter().enumerate() {
            let id = v.intern(w);
            v.attach(id, i as u32);
        }
        v
    }

    #[test]
    fn prefix_range_holds_exactly_the_words_with_that_start() {
        let v = vocab(&["haupt", "hauptstrasse", "hausen", "am", "markt"]);
        let words: Vec<&str> = v.prefix_range("haup").map(|i| v.text(v.sorted_word(i))).collect();
        assert_eq!(words, ["haupt", "hauptstrasse"]);
        assert!(v.prefix_range("x").is_empty());
        assert_eq!(v.prefix_range("").len(), 5);
    }

    #[test]
    fn containing_finds_words_by_a_part_and_skips_dropped_ones() {
        let mut v = vocab(&["bahnhofstrasse", "hauptbahnhof", "markt"]);
        let mut found = Vec::new();
        v.each_containing("bahnhof", |w, at| found.push((v.text(w).to_string(), at)));
        assert_eq!(found, [("bahnhofstrasse".to_string(), 0), ("hauptbahnhof".to_string(), 5)]);
        let w = v.find("hauptbahnhof").unwrap();
        v.detach(w, 1);
        let mut count = 0;
        v.each_containing("bahnhof", |_, _| count += 1);
        assert_eq!(count, 1);
    }
}
