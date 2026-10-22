//! The numbers that decide the order. Text quality comes first (points, 0 to about 1200); the situation of the person then scales it
//! up by at most about 40 %, so that a good match always beats a poor one that merely lies near, and context breaks ties between
//! matches of similar quality.
use crate::entry::Kind;

// How a typed token matches a word of a title (points).
pub(crate) const EXACT: u16 = 1000;
/// Another spelling of the same word (an abbreviation written out).
pub(crate) const ALIAS_PENALTY: u16 = 50;
/// The token is the start of the word: 700 plus up to 100 for the share of the word that was typed.
pub(crate) const PREFIX_BASE: u32 = 700;
pub(crate) const PREFIX_SPAN: u32 = 100;
/// The token ends a longer word ("strasse" in "hauptstrasse").
pub(crate) const SUFFIX: u16 = 520;
/// The token sits inside a longer word.
pub(crate) const INFIX: u16 = 480;
/// One or two typos: the whole word, or only its start.
pub(crate) const FUZZY_ONE: u16 = 440;
pub(crate) const FUZZY_TWO: u16 = 380;
pub(crate) const FUZZY_WHOLE: u16 = 30;
/// A keyword that is not part of the title (the kind, a command's keywords) counts four fifths.
pub(crate) const EXTRA_NUM: u16 = 4;
pub(crate) const EXTRA_DEN: u16 = 5;

// Label bonuses (points).
/// The title starts with what was typed.
pub(crate) const STARTS_WITH: u32 = 50;
/// Every title word is matched exactly: the whole title was typed.
pub(crate) const WHOLE_TITLE: u32 = 100;
/// The words were typed in the order of the title.
pub(crate) const IN_ORDER: u32 = 20;
/// Share of the title that was matched, times this.
pub(crate) const COVERAGE: u32 = 80;

/// A street found without the house number that was typed: still shown, below the houses.
pub(crate) const UNMATCHED_NUMBER: f32 = 0.8;

// Context: the most a recent entry, a near entry, an entry in the current Gebiet add to the factor.
pub(crate) const RECENT_MAX: f32 = 0.20;
pub(crate) const NEAR_MAX: f32 = 0.18;
/// Distance in metres at which nearness is worth half.
pub(crate) const NEAR_HALF: f32 = 600.0;
pub(crate) const AREA_BONUS: f32 = 0.06;
/// The street the person is on (last used, or nearest): a lone house number is read there.
pub(crate) const STREET_RECENT: [f32; 2] = [0.5, 0.3];
pub(crate) const STREET_NEAR: [f32; 2] = [0.3, 0.2];
pub(crate) const STREET_NEAR_REACH: f64 = 800.0;
/// How many recent entries count, and how fast their weight falls.
pub(crate) const RECENT_KEPT: usize = 64;
pub(crate) const RECENT_DECAY: f32 = 0.9;

/// What a kind is worth before the text is looked at: content that is seldom wanted first (free text of notes) counts less.
pub(crate) fn kind_weight(kind: Kind) -> f32 {
    match kind {
        Kind::Street | Kind::House => 1.0,
        Kind::Area | Kind::Command => 0.97,
        Kind::Group => 0.95,
        Kind::Person => 0.92,
        Kind::Note => 0.85,
    }
}

// The shape of the answer.
/// How many candidates are kept before the kinds are balanced.
pub(crate) const KEPT_PER_LIMIT: usize = 4;
pub(crate) const MAX_LIMIT: usize = 200;
/// No kind takes more than this share of the list while others have hits (a hundred houses must not push out the street and the commands).
pub(crate) const KIND_SHARE_NUM: usize = 2;
pub(crate) const KIND_SHARE_DEN: usize = 3;
pub(crate) const KIND_MIN_ROOM: usize = 4;
/// Commands shown for an empty search.
pub(crate) const EMPTY_COMMANDS: usize = 6;
