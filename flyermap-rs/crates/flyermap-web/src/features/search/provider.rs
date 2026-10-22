//! What the bar asks of a search: the typed text in, hits out, possibly later. The bar and the host know nothing else about where hits come from, so the
//! search library (`flyermap-search`) plugs in as one more provider without touching a screen; until then the places that know something answer
//! (the names of the world, the engine for streets and addresses, the commands).
use crate::{backend::Fut, ui::Hit};

pub trait SearchProvider {
    /// The hits for `text` (trimmed, not empty), best first, at most `limit`. Hits come without `marks`: the host marks them for the text that is current
    /// when they are shown.
    fn search(&self, text: &str, limit: usize) -> Fut<Vec<Hit>>;

    /// What this provider offers while nothing is typed (the commands do; the others have nothing to say before a word).
    fn suggest(&self) -> Vec<Hit> {
        Vec::new()
    }
}

type SearchFn = Box<dyn Fn(&str, usize) -> Fut<Vec<Hit>>>;
type SuggestFn = Box<dyn Fn() -> Vec<Hit>>;

/// A provider made of closures, for the places that answer from what they hold (the world's names) and for adapters of other libraries.
pub struct FnProvider {
    search: SearchFn,
    suggest: Option<SuggestFn>,
}

impl FnProvider {
    pub fn new(search: impl Fn(&str, usize) -> Fut<Vec<Hit>> + 'static) -> FnProvider {
        FnProvider { search: Box::new(search), suggest: None }
    }

    pub fn offering(mut self, suggest: impl Fn() -> Vec<Hit> + 'static) -> FnProvider {
        self.suggest = Some(Box::new(suggest));
        self
    }
}

impl SearchProvider for FnProvider {
    fn search(&self, text: &str, limit: usize) -> Fut<Vec<Hit>> {
        (self.search)(text, limit)
    }

    fn suggest(&self) -> Vec<Hit> {
        self.suggest.as_ref().map(|f| f()).unwrap_or_default()
    }
}
