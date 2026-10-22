//! The vocabulary: every distinct word of every title once, in one text arena, sorted, with the labels that contain it.
//!
//! - `arena`: all words one after the other, each followed by `\n`; a word id is the order of first sight and never changes.
//! - `sorted` + `lcp`: the ids in alphabetical order and the common prefix length of neighbours, for prefix ranges and for the fuzzy walk.
//! - `post`: per word the labels (title texts) that contain it.
//!
//! Words are added and dropped one by one (a note is saved, a Gebiet renamed) without a rebuild. A bulk load defers the sorting.
mod fuzzy;
mod lookup;

use rustc_hash::FxHashMap;

pub(crate) struct Vocab {
    arena: String,
    /// `starts[w]` is where word `w` begins in the arena; one more entry at the end marks the end of the last word.
    starts: Vec<u32>,
    /// Length of each word in characters.
    chars: Vec<u16>,
    post: Vec<Vec<u32>>,
    ids: FxHashMap<Box<str>, u32>,
    sorted: Vec<u32>,
    lcp: Vec<u16>,
    bulk: bool,
}

impl Vocab {
    pub fn new() -> Vocab {
        Vocab {
            arena: String::new(),
            starts: vec![0],
            chars: Vec::new(),
            post: Vec::new(),
            ids: FxHashMap::default(),
            sorted: Vec::new(),
            lcp: Vec::new(),
            bulk: false,
        }
    }

    /// Number of word ids ever handed out (dropped words keep their id, with no labels).
    pub fn len(&self) -> usize {
        self.post.len()
    }

    pub fn text(&self, word: u32) -> &str {
        let (a, b) = (self.starts[word as usize] as usize, self.starts[word as usize + 1] as usize);
        &self.arena[a..b - 1]
    }

    pub fn chars(&self, word: u32) -> usize {
        self.chars[word as usize] as usize
    }

    pub fn labels(&self, word: u32) -> &[u32] {
        &self.post[word as usize]
    }

    /// A word that some label still contains.
    #[cfg(test)]
    pub fn is_live(&self, word: u32) -> bool {
        !self.post[word as usize].is_empty()
    }

    #[cfg(test)]
    pub fn find(&self, text: &str) -> Option<u32> {
        self.ids.get(text).copied()
    }

    /// The id of the word, new if it was not known.
    pub fn intern(&mut self, text: &str) -> u32 {
        if let Some(&word) = self.ids.get(text) {
            return word;
        }
        let word = self.post.len() as u32;
        self.arena.push_str(text);
        self.arena.push('\n');
        self.starts.push(self.arena.len() as u32);
        self.chars.push(text.chars().count().min(u16::MAX as usize) as u16);
        self.post.push(Vec::new());
        self.ids.insert(text.into(), word);
        if !self.bulk {
            self.insert_sorted(word);
        }
        word
    }

    /// `label` contains `word`. Called once per label and word occurrence; repeats in a row are ignored.
    pub fn attach(&mut self, word: u32, label: u32) {
        let post = &mut self.post[word as usize];
        if post.last() != Some(&label) {
            post.push(label);
        }
    }

    /// `label` no longer contains `word`; a word without labels is dropped from the lookups.
    pub fn detach(&mut self, word: u32, label: u32) {
        let post = &mut self.post[word as usize];
        post.retain(|&l| l != label);
        if post.is_empty() {
            self.post[word as usize] = Vec::new();
            self.drop_word(word);
        }
    }

    pub fn begin_bulk(&mut self) {
        self.bulk = true;
    }

    /// Sort everything added since `begin_bulk`.
    pub fn end_bulk(&mut self) {
        self.bulk = false;
        let mut live: Vec<u32> = (0..self.post.len() as u32).filter(|&w| self.ids.get(self.text(w)) == Some(&w)).collect();
        live.sort_unstable_by(|&a, &b| self.text(a).cmp(self.text(b)));
        self.lcp = (0..live.len()).map(|i| if i == 0 { 0 } else { common(self.text(live[i - 1]), self.text(live[i])) }).collect();
        self.sorted = live;
    }

    fn position(&self, text: &str) -> usize {
        self.sorted.partition_point(|&w| self.text(w) < text)
    }

    fn insert_sorted(&mut self, word: u32) {
        let at = self.position(self.text(word));
        let before = if at == 0 { 0 } else { common(self.text(self.sorted[at - 1]), self.text(word)) };
        self.sorted.insert(at, word);
        self.lcp.insert(at, before);
        if at + 1 < self.sorted.len() {
            self.lcp[at + 1] = common(self.text(word), self.text(self.sorted[at + 1]));
        }
    }

    fn drop_word(&mut self, word: u32) {
        let text: Box<str> = self.text(word).into();
        self.ids.remove(&text);
        if self.bulk {
            return;
        }
        let at = self.position(&text);
        debug_assert_eq!(self.sorted.get(at), Some(&word));
        self.sorted.remove(at);
        self.lcp.remove(at);
        if at < self.sorted.len() {
            self.lcp[at] = if at == 0 { 0 } else { common(self.text(self.sorted[at - 1]), self.text(self.sorted[at])) };
        }
    }

    /// Bytes held (capacities, without allocator overhead).
    pub fn bytes(&self) -> usize {
        let post: usize = self.post.iter().map(|p| std::mem::size_of::<Vec<u32>>() + p.capacity() * 4).sum();
        let ids = self.ids.capacity() * (std::mem::size_of::<(Box<str>, u32)>() + 1) + self.ids.keys().map(|k| k.len()).sum::<usize>();
        self.arena.capacity() + self.starts.capacity() * 4 + self.chars.capacity() * 2 + self.sorted.capacity() * 4 + self.lcp.capacity() * 2 + post + ids
    }
}

/// Length in bytes of the common prefix.
fn common(a: &str, b: &str) -> u16 {
    a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count().min(u16::MAX as usize) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vocab(words: &[&str]) -> Vocab {
        let mut v = Vocab::new();
        v.begin_bulk();
        for (i, w) in words.iter().enumerate() {
            let id = v.intern(w);
            v.attach(id, i as u32);
        }
        v.end_bulk();
        v
    }

    fn sorted_texts(v: &Vocab) -> Vec<&str> {
        v.sorted.iter().map(|&w| v.text(w)).collect()
    }

    #[test]
    fn bulk_and_one_by_one_give_the_same_order() {
        let words = ["markt", "haupt", "hauptstrasse", "am", "linde", "lindenweg", "haupt"];
        let bulk = vocab(&words);
        let mut one = Vocab::new();
        for (i, w) in words.iter().enumerate() {
            let id = one.intern(w);
            one.attach(id, i as u32);
        }
        assert_eq!(sorted_texts(&bulk), sorted_texts(&one));
        assert_eq!(bulk.lcp, one.lcp);
        assert_eq!(sorted_texts(&one), ["am", "haupt", "hauptstrasse", "linde", "lindenweg", "markt"]);
        assert_eq!(one.lcp, [0, 0, 5, 0, 5, 0]);
    }

    #[test]
    fn a_word_without_labels_is_dropped() {
        let mut v = vocab(&["haupt", "hauptstrasse", "markt"]);
        let w = v.find("hauptstrasse").unwrap();
        v.detach(w, 1);
        assert_eq!(sorted_texts(&v), ["haupt", "markt"]);
        assert_eq!(v.lcp, [0, 0]);
        assert_eq!(v.find("hauptstrasse"), None);
        assert!(!v.is_live(w));
    }
}
