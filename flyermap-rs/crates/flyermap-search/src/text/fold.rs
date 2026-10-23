//! Folding: what the search compares is not what is written. Lower case, accents off, "ß" as "ss", "ae/oe/ue" as "a/o/u" (so "Müller",
//! "Mueller" and "Muller" are one word), and everything that is no letter or digit becomes one separator. Each folded character
//! remembers the bytes of the original it came from, so a match can be shown on the text as it was written.
use unicode_normalization::char::{decompose_canonical, is_combining_mark};

/// What stands for any run of punctuation and white space.
pub(crate) const SEP: char = ' ';

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Folded {
    pub ch: char,
    /// Byte range of the original text this character stands for (an "ä" or an "ae" is one folded "a").
    pub start: u32,
    pub end: u32,
}

/// Fold `text` into `out` (which is cleared first).
pub(crate) fn fold_into(text: &str, out: &mut Vec<Folded>) {
    out.clear();
    for (i, c) in text.char_indices() {
        let (start, end) = (i as u32, (i + c.len_utf8()) as u32);
        if c.is_ascii() {
            push(out, c.to_ascii_lowercase(), start, end);
            continue;
        }
        for lower in c.to_lowercase() {
            decompose_canonical(lower, |d| {
                if !is_combining_mark(d) {
                    letter(out, d, start, end);
                }
            });
        }
    }
}

/// The letters that do not decompose into a base letter and a mark.
fn letter(out: &mut Vec<Folded>, c: char, start: u32, end: u32) {
    match c {
        'ß' => {
            push(out, 's', start, end);
            push(out, 's', start, end);
        }
        'æ' => push(out, 'a', start, end),
        'œ' | 'ø' => push(out, 'o', start, end),
        'đ' | 'ð' => push(out, 'd', start, end),
        'ł' => push(out, 'l', start, end),
        'ħ' => push(out, 'h', start, end),
        'ı' => push(out, 'i', start, end),
        'þ' => {
            push(out, 't', start, end);
            push(out, 'h', start, end);
        }
        _ => push(out, c, start, end),
    }
}

fn push(out: &mut Vec<Folded>, c: char, start: u32, end: u32) {
    if !c.is_alphanumeric() {
        out.push(Folded { ch: SEP, start, end });
        return;
    }
    // "ae", "oe", "ue" written out are the umlaut: they fold into the vowel before them
    if c == 'e' {
        if let Some(last) = out.last_mut() {
            if matches!(last.ch, 'a' | 'o' | 'u') && last.end == start {
                last.end = end;
                return;
            }
        }
    }
    out.push(Folded { ch: c, start, end });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fold(text: &str) -> String {
        let mut out = Vec::new();
        fold_into(text, &mut out);
        out.iter().map(|f| f.ch).collect()
    }

    #[test]
    fn spellings_of_one_word_fold_alike() {
        assert_eq!(fold("Straße"), "strasse");
        assert_eq!(fold("STRASSE"), "strasse");
        assert_eq!(fold("Müller"), fold("Mueller"));
        assert_eq!(fold("Müller"), fold("muller"));
        assert_eq!(fold("Café Zoë"), "cafe zo");
        assert_eq!(fold("u\u{308}"), "u");
    }

    #[test]
    fn punctuation_is_a_separator() {
        assert_eq!(fold("Dr.-Eschenbach-Str."), "dr  eschenbach str ");
    }

    #[test]
    fn origins_cover_the_original_bytes() {
        let mut out = Vec::new();
        fold_into("Mueller", &mut out);
        assert_eq!((out[1].start, out[1].end), (1, 3));
        fold_into("Straße", &mut out);
        assert_eq!((out[4].start, out[4].end), (4, 6));
        assert_eq!((out[5].start, out[5].end), (4, 6));
    }
}
