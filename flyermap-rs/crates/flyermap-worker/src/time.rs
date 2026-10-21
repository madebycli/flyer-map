//! The clock as the database stores it: ISO 8601 in UTC with milliseconds, like JavaScript's `toISOString()`.

/// `1_800_000_000_000` → `"2027-01-15T08:00:00.000Z"`.
pub fn iso(ms: u64) -> String {
    let secs = ms / 1000;
    let (days, rest) = (secs / 86_400, secs % 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rest / 3600, rest % 3600 / 60, rest % 60, ms % 1000)
}

/// `Date.parse` for the shapes our clients send: `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM[:SS[.fff]]` with `Z`, `±HH:MM` or nothing (the Worker's clock is UTC).
pub fn parse_iso_ms(text: &str) -> Option<i64> {
    let t = text.trim();
    let num = |s: &str| -> Option<i64> { (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())).then(|| s.parse().ok()).flatten() };
    let (date, rest) = t.split_at_checked(10)?;
    let mut d = date.split('-');
    let (y, m, day) = (num(d.next()?)?, num(d.next()?)?, num(d.next()?)?);
    if d.next().is_some() || date.as_bytes()[4] != b'-' || !(1..=12).contains(&m) || !(1..=31).contains(&day) {
        return None;
    }
    let (mut secs, mut offset_min) = (0i64, 0i64);
    let mut ms = 0i64;
    if let Some(time) = rest.strip_prefix('T') {
        let (clock, zone) = match time.find(['Z', '+', '-']) {
            Some(i) => time.split_at(i),
            None => (time, ""),
        };
        let mut parts = clock.split(':');
        let h = num(parts.next()?)?;
        let mi = num(parts.next()?)?;
        let (s, frac) = match parts.next() {
            Some(sec) => match sec.split_once('.') {
                Some((s, f)) => (num(s)?, f),
                None => (num(sec)?, ""),
            },
            None => (0, ""),
        };
        if parts.next().is_some() || h > 24 || mi > 59 || s > 59 {
            return None;
        }
        if !frac.is_empty() {
            let digits: String = frac.chars().take(3).collect();
            ms = num(&digits)? * 10i64.pow(3 - digits.len() as u32);
        }
        secs = h * 3600 + mi * 60 + s;
        match zone {
            "" | "Z" => {}
            z => {
                let sign = if z.starts_with('-') { -1 } else { 1 };
                let (oh, om) = z[1..].split_once(':')?;
                offset_min = sign * (num(oh)? * 60 + num(om)?);
            }
        }
    } else if !rest.is_empty() {
        return None;
    }
    let days = days_from_civil(y, m as u32, day as u32);
    Some((days * 86_400 + secs - offset_min * 60) * 1000 + ms)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (i64::from(m) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_javascript() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_800_000_000_000), "2027-01-15T08:00:00.000Z");
        assert_eq!(iso(951_782_400_123), "2000-02-29T00:00:00.123Z");
        assert_eq!(parse_iso_ms("2027-01-15T08:00:00.000Z"), Some(1_800_000_000_000));
        assert_eq!(parse_iso_ms("2027-01-15"), Some(1_799_971_200_000));
        assert_eq!(parse_iso_ms("2027-01-15T09:00+01:00"), Some(1_800_000_000_000));
        assert_eq!(parse_iso_ms("15.01.2027"), None);
    }
}
