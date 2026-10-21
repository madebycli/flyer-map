use std::collections::VecDeque;

/// A buffer that keeps the newest `capacity` items. Old ones fall off the front; nothing grows without bound.
#[derive(Clone, Debug)]
pub struct Ring<T> {
    items: VecDeque<T>,
    capacity: usize,
    dropped: u64,
}

impl<T> Ring<T> {
    pub fn new(capacity: usize) -> Ring<T> {
        Ring { items: VecDeque::with_capacity(capacity.min(1024)), capacity: capacity.max(1), dropped: 0 }
    }
    pub fn push(&mut self, item: T) {
        if self.items.len() == self.capacity {
            self.items.pop_front();
            self.dropped += 1;
        }
        self.items.push_back(item);
    }
    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.items.iter()
    }
    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
    /// How many items fell off the front so far: a report says "and N older ones".
    pub fn dropped(&self) -> u64 {
        self.dropped
    }
    pub fn clear(&mut self) {
        self.items.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_newest_and_counts_what_fell_off() {
        let mut r = Ring::new(3);
        for n in 1..=5 {
            r.push(n);
        }
        assert_eq!(r.iter().copied().collect::<Vec<_>>(), [3, 4, 5]);
        assert_eq!(r.dropped(), 2);
    }
}
