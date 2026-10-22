//! Which letters of a result's label the typed words hit, so the bar can set them in bold. Pure. Matching folds like the search itself
//! ("strasse" hits "Straße", "muller" hits "Müller"), but the ranges are in the *original* label, counted in characters.
use crate::ui::fold::fold;

/// Character ranges `(start, end)` (end exclusive) of `label` that some word of `query` hits, sorted and without overlaps.
pub fn marks(label: &str, query: &str) -> Vec<(usize, usize)> {
    let words: Vec<String> = fold(query).split_whitespace().map(str::to_string).collect();
    if words.is_empty() {
        return Vec::new();
    }
    // the folded label, and for every byte of it the character of the original it came from
    let mut folded = String::new();
    let mut origin: Vec<usize> = Vec::new();
    for (i, c) in label.chars().enumerate() {
        let piece = fold(&c.to_string());
        origin.extend(std::iter::repeat_n(i, piece.len()));
        folded.push_str(&piece);
    }
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for word in &words {
        let mut from = 0;
        while let Some(at) = folded[from..].find(word.as_str()) {
            let (start, end) = (from + at, from + at + word.len());
            ranges.push((origin[start], origin[end - 1] + 1));
            from = end;
        }
    }
    ranges.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (s, e) in ranges {
        match merged.last_mut() {
            Some(last) if s <= last.1 => last.1 = last.1.max(e),
            _ => merged.push((s, e)),
        }
    }
    merged
}

/// A piece of a label: its text and whether it is a hit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Piece {
    pub text: String,
    pub hit: bool,
}

/// Cut `label` along `marks` (as `marks()` gives them) into alternating plain and hit pieces. Ranges past the end are cut off.
pub fn pieces(label: &str, marks: &[(usize, usize)]) -> Vec<Piece> {
    let chars: Vec<char> = label.chars().collect();
    let mut out = Vec::new();
    let mut at = 0;
    let mut push = |from: usize, to: usize, hit: bool| {
        if to > from {
            out.push(Piece { text: chars[from..to].iter().collect(), hit });
        }
    };
    for &(s, e) in marks {
        let (s, e) = (s.min(chars.len()), e.min(chars.len()));
        if s < at {
            continue;
        }
        push(at, s, false);
        push(s, e, true);
        at = e;
    }
    push(at, chars.len(), false);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit_text(label: &str, query: &str) -> Vec<String> {
        pieces(label, &marks(label, query)).into_iter().filter(|p| p.hit).map(|p| p.text).collect()
    }

    #[test]
    fn a_word_is_marked_where_it_occurs_with_accents_folded() {
        assert_eq!(marks("Hauptstraße 12", "haupt"), [(0, 5)]);
        assert_eq!(hit_text("Hauptstraße 12", "strasse"), ["straße"]);
        assert_eq!(hit_text("Müllerweg", "muller"), ["Müller"]);
    }

    #[test]
    fn every_word_is_marked_and_touching_hits_are_joined() {
        assert_eq!(hit_text("Hauptstraße 12", "12 haupt"), ["Haupt", "12"]);
        assert_eq!(marks("abc", "ab bc"), [(0, 3)], "overlapping hits become one");
        assert_eq!(marks("Nordstadt Nord", "nord"), [(0, 4), (10, 14)], "every occurrence");
    }

    #[test]
    fn nothing_typed_or_nothing_found_marks_nothing() {
        assert!(marks("Hauptstraße", "").is_empty());
        assert!(marks("Hauptstraße", "   ").is_empty());
        assert!(marks("Hauptstraße", "xyz").is_empty());
    }

    #[test]
    fn pieces_cover_the_whole_label_in_order() {
        let p = pieces("Nordstadt", &[(0, 4)]);
        assert_eq!(p, [Piece { text: "Nord".into(), hit: true }, Piece { text: "stadt".into(), hit: false }]);
        assert_eq!(pieces("ab", &[(1, 9)]).iter().map(|p| p.text.as_str()).collect::<String>(), "ab", "a range past the end is cut");
        assert_eq!(pieces("ab", &[]), [Piece { text: "ab".into(), hit: false }]);
        assert!(pieces("", &[]).is_empty());
    }
}
