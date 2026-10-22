//! House numbers as people write and type them: "12", "12a", "12 a", "12-14", "12a-c". A number is a range of (number, addition) pairs,
//! so "12" finds "12", "12a" and "12-14", and "13" finds "12-14".

/// A number and its addition letter (`a` = 1 … `z` = 26, 0 = none). Ordered like the street: 12 < 12a < 12b < 13.
pub(crate) type Part = (u32, u8);

/// What a house number says: from `lo` to `hi` (equal for a single number).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HouseNo {
    pub lo: Part,
    pub hi: Part,
}

/// A number that could not be read ("Hof 3", "12½"). Such a house keeps its text and is found by the street only.
pub(crate) const UNPARSED: HouseNo = HouseNo { lo: (u32::MAX, 0), hi: (u32::MAX, 0) };

const MAX_DIGITS: usize = 5;

fn digits(b: &[u8], i: &mut usize) -> Option<u32> {
    let start = *i;
    while *i < b.len() && b[*i].is_ascii_digit() {
        *i += 1;
    }
    if *i == start || *i - start > MAX_DIGITS {
        return None;
    }
    std::str::from_utf8(&b[start..*i]).ok()?.parse().ok()
}

/// An optional single addition letter, with white space before it; two letters in a row are no addition.
fn letter(b: &[u8], i: &mut usize) -> Option<u8> {
    let mut j = *i;
    while j < b.len() && b[j] == b' ' {
        j += 1;
    }
    if j < b.len() && b[j].is_ascii_alphabetic() {
        if j + 1 < b.len() && b[j + 1].is_ascii_alphabetic() {
            return None;
        }
        *i = j + 1;
        return Some(b[j].to_ascii_lowercase() - b'a' + 1);
    }
    Some(0)
}

fn skip_space(b: &[u8], i: &mut usize) {
    while *i < b.len() && b[*i] == b' ' {
        *i += 1;
    }
}

impl HouseNo {
    pub fn parse(text: &str) -> Option<HouseNo> {
        let text = text.trim().replace(['–', '—'], "-");
        let b = text.as_bytes();
        let mut i = 0;
        let lo = (digits(b, &mut i)?, letter(b, &mut i)?);
        skip_space(b, &mut i);
        if i == b.len() {
            return Some(HouseNo { lo, hi: lo });
        }
        if !matches!(b[i], b'-' | b'/') {
            return None;
        }
        i += 1;
        skip_space(b, &mut i);
        let number = digits(b, &mut i);
        let addition = letter(b, &mut i)?;
        skip_space(b, &mut i);
        if i != b.len() || (number.is_none() && addition == 0) {
            return None;
        }
        let hi = (number.unwrap_or(lo.0), addition);
        (hi >= lo).then_some(HouseNo { lo, hi })
    }

    pub fn is_unparsed(&self) -> bool {
        self.lo.0 == u32::MAX
    }

    /// The canonical spelling: "12", "12a", "12a-c", "12-14".
    pub fn format(&self) -> String {
        let one = |(n, a): Part| if a == 0 { n.to_string() } else { format!("{n}{}", (b'a' + a - 1) as char) };
        if self.lo == self.hi {
            one(self.lo)
        } else if self.hi.0 == self.lo.0 {
            format!("{}-{}", one(self.lo), (b'a' + self.hi.1 - 1) as char)
        } else {
            format!("{}-{}", one(self.lo), one(self.hi))
        }
    }
}

/// A number the person typed: one number, or a range ("12-14").
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NumberQuery {
    pub lo: Part,
    pub hi: Part,
    pub range: bool,
    /// How many digits were typed: "1" finds 1, 10 to 19, 100 …
    typed: u32,
}

fn power10(n: u32) -> u32 {
    10u32.saturating_pow(n)
}

fn digit_count(mut n: u32) -> u32 {
    let mut count = 1;
    while n >= 10 {
        n /= 10;
        count += 1;
    }
    count
}

impl NumberQuery {
    /// "12" or "12a" (already folded).
    pub fn from_token(token: &str) -> Option<NumberQuery> {
        let b = token.as_bytes();
        let mut i = 0;
        let number = digits(b, &mut i)?;
        let addition = match &b[i..] {
            [] => 0,
            [c] if c.is_ascii_lowercase() => c - b'a' + 1,
            _ => return None,
        };
        let typed = token.bytes().take_while(u8::is_ascii_digit).count() as u32;
        Some(NumberQuery { lo: (number, addition), hi: (number, addition), range: false, typed })
    }

    pub fn range_of(lo: &NumberQuery, hi: &NumberQuery) -> Option<NumberQuery> {
        (hi.lo >= lo.lo).then_some(NumberQuery { lo: lo.lo, hi: hi.lo, range: true, typed: lo.typed })
    }

    /// With the addition letter taken from the next word ("12 a").
    pub fn with_addition(&self, letter: u8) -> NumberQuery {
        NumberQuery { lo: (self.lo.0, letter), hi: (self.lo.0, letter), ..self.clone() }
    }

    pub fn has_addition(&self) -> bool {
        self.lo.1 != 0
    }

    /// How many digits were typed.
    pub fn typed_digits(&self) -> u8 {
        self.typed.min(250) as u8
    }

    /// How well a house number answers this one, 0 = not at all: exact first, then the same number with an addition, then ranges that
    /// contain it, then numbers that merely start with the typed digits.
    pub fn score(&self, h: &HouseNo) -> u16 {
        if h.is_unparsed() {
            return 0;
        }
        if self.lo == h.lo && self.hi == h.hi {
            return 1000;
        }
        if self.range {
            let overlaps = h.lo <= self.hi && h.hi >= self.lo;
            return match (overlaps, h.lo >= self.lo && h.hi <= self.hi) {
                (true, true) => 640,
                (true, false) => 600,
                _ => 0,
            };
        }
        let q = self.lo;
        if self.has_addition() {
            return match (h.lo == q, h.lo.0 == h.hi.0 && h.lo <= q && q <= h.hi) {
                (true, _) => 850,
                (_, true) => 760,
                _ => 0,
            };
        }
        if h.lo.0 == q.0 {
            return if h.lo == h.hi { 820 } else { 800 };
        }
        if h.lo.0 < q.0 && q.0 <= h.hi.0 {
            return 700;
        }
        // "1" while typing "12": the house number starts with the typed digits (leading zeros typed are not a number)
        let have = digit_count(h.lo.0);
        if self.typed == digit_count(q.0) && have > self.typed && h.lo.0 / power10(have - self.typed) == q.0 {
            return 450;
        }
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no(text: &str) -> HouseNo {
        HouseNo::parse(text).unwrap()
    }
    fn q(text: &str) -> NumberQuery {
        NumberQuery::from_token(text).unwrap()
    }

    #[test]
    fn numbers_are_read_and_written_the_same_way() {
        for text in ["12", "12a", "12a-c", "12-14", "7b-9"] {
            assert_eq!(no(text).format(), text);
        }
        assert_eq!(no("12 A").format(), "12a");
        assert_eq!(no("12 – 14").format(), "12-14");
        assert_eq!(no("12/14").format(), "12-14");
        assert_eq!(HouseNo::parse("Hof 3"), None);
        assert_eq!(HouseNo::parse("14-12"), None);
        assert_eq!(HouseNo::parse("12ab"), None);
    }

    #[test]
    fn exact_beats_addition_beats_range_beats_digit_prefix() {
        let scores: Vec<u16> = ["12", "12a", "10-14", "123"].iter().map(|h| q("12").score(&no(h))).collect();
        assert_eq!(scores, [1000, 820, 700, 450]);
        assert_eq!(q("12a").score(&no("12a")), 1000);
        assert_eq!(q("12a").score(&no("12")), 0);
        assert_eq!(q("12a").score(&no("12a-c")), 850);
        assert_eq!(q("12b").score(&no("12a-c")), 760);
        assert_eq!(q("1").score(&no("12")), 450);
        assert_eq!(q("1").score(&no("2")), 0);
        assert_eq!(q("13").score(&no("12-14")), 700);
    }

    #[test]
    fn ranges_ask_for_the_houses_between() {
        let r = NumberQuery::range_of(&q("12"), &q("14")).unwrap();
        assert_eq!(r.score(&no("12-14")), 1000);
        assert_eq!(r.score(&no("13")), 640);
        assert_eq!(r.score(&no("11-12")), 600);
        assert_eq!(r.score(&no("15")), 0);
    }
}
