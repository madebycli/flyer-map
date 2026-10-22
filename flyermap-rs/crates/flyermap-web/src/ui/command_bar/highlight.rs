//! Cutting a result's title along the stretches the search says it matched, so the card can set them in bold. Pure. Ranges are byte ranges of the title on
//! character boundaries (what `flyermap-search` hands out); a range that is not (or lies past the end) is left out instead of breaking the text.

/// A piece of a title: its text and whether it is a hit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Piece {
    pub text: String,
    pub hit: bool,
}

/// Cut `title` into alternating plain and hit pieces along `marks` (sorted, not overlapping).
pub fn pieces(title: &str, marks: &[(usize, usize)]) -> Vec<Piece> {
    let mut out = Vec::new();
    let mut at = 0;
    let mut push = |from: usize, to: usize, hit: bool| {
        if let Some(text) = title.get(from..to).filter(|t| !t.is_empty()) {
            out.push(Piece { text: text.to_string(), hit });
        }
    };
    for &(s, e) in marks {
        if s < at || e > title.len() || !title.is_char_boundary(s) || !title.is_char_boundary(e) {
            continue;
        }
        push(at, s, false);
        push(s, e, true);
        at = e;
    }
    push(at, title.len(), false);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(text: &str, hit: bool) -> Piece {
        Piece { text: text.into(), hit }
    }

    #[test]
    fn a_title_is_cut_into_plain_and_hit_pieces() {
        assert_eq!(pieces("Nordstadt", &[(0, 4)]), [p("Nord", true), p("stadt", false)]);
        assert_eq!(pieces("Hauptstraße 12", &[(0, 5), (13, 15)]), [p("Haupt", true), p("straße ", false), p("12", true)]);
        assert_eq!(pieces("ab", &[]), [p("ab", false)]);
        assert!(pieces("", &[]).is_empty());
    }

    #[test]
    fn a_range_that_does_not_fit_is_left_out() {
        assert_eq!(pieces("ab", &[(1, 9)]), [p("ab", false)], "past the end");
        assert_eq!(pieces("Straße", &[(4, 5)]), [p("Straße", false)], "inside the two bytes of ß");
        assert_eq!(pieces("abc", &[(2, 3), (0, 1)]), [p("ab", false), p("c", true)], "out of order: the first counts, the later one is dropped");
    }

    #[test]
    fn the_pieces_always_make_the_whole_title() {
        let title = "Müllerweg 3";
        let joined: String = pieces(title, &[(0, 7), (9, 10)]).iter().map(|p| p.text.as_str()).collect();
        assert_eq!(joined, title);
    }
}
