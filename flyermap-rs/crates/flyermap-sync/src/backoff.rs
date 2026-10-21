//! How long to wait after a failure: doubling, capped, so a dead network is asked rarely and a recovered one quickly.

/// After the n-th failure in a row (1-based): 1 s, 2 s, 4 s ... up to `cap_ms`.
pub fn delay_ms(base_ms: u64, failures: u32, cap_ms: u64) -> u64 {
    base_ms
        .saturating_mul(1u64.checked_shl(failures).unwrap_or(u64::MAX))
        .min(cap_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_and_is_capped() {
        assert_eq!(
            [1, 2, 3, 4, 5, 6, 7].map(|n| delay_ms(500, n, 30_000)),
            [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]
        );
        assert_eq!(delay_ms(500, 200, 30_000), 30_000);
        assert_eq!(delay_ms(1000, 3, 60_000), 8000);
    }
}
