//! What can be found: seven kinds of entry. The host builds them from the engine (streets, houses) and from its own store (the rest).
use crate::id::{Id, Point};

/// The kind of an entry. The order is the fallback order of groups when two groups are equally good.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum Kind {
    Command,
    Street,
    House,
    Area,
    Group,
    Person,
    Note,
}

impl Kind {
    pub const ALL: [Kind; 7] = [Kind::Command, Kind::Street, Kind::House, Kind::Area, Kind::Group, Kind::Person, Kind::Note];

    fn bit(self) -> u8 {
        1 << (self as u8)
    }
}

/// A set of kinds: which ones a person may see or a screen asks for.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct KindSet(u8);

impl KindSet {
    pub const ALL: KindSet = KindSet(0x7f);
    pub const NONE: KindSet = KindSet(0);

    pub fn of(kinds: &[Kind]) -> KindSet {
        KindSet(kinds.iter().fold(0, |bits, k| bits | k.bit()))
    }
    pub fn contains(self, kind: Kind) -> bool {
        self.0 & kind.bit() != 0
    }
    pub fn with(self, kind: Kind) -> KindSet {
        KindSet(self.0 | kind.bit())
    }
    pub fn without(self, kind: Kind) -> KindSet {
        KindSet(self.0 & !kind.bit())
    }
}

impl Default for KindSet {
    fn default() -> KindSet {
        KindSet::ALL
    }
}

/// The two worlds of a Gebiet (Plan 057): handing out flyers or collecting them.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Art {
    Austeilen,
    Abholen,
}

/// A street by name. `pieces` are the ids of its junction-to-junction pieces (what the map focuses on), `center` its middle.
#[derive(Clone, PartialEq, Debug)]
pub struct Street {
    pub id: Id,
    pub name: String,
    pub pieces: Vec<Id>,
    pub center: Point,
    /// The Gebiet it lies in (an `Area` id), for "in the current Gebiet".
    pub area: Option<Id>,
}

/// A house: the street's name as written at the house, the number with its addition ("12a", "12-14"), and where it is.
#[derive(Clone, PartialEq, Debug)]
pub struct House {
    pub id: Id,
    pub street: String,
    pub number: String,
    pub position: Point,
    pub area: Option<Id>,
}

#[derive(Clone, PartialEq, Debug)]
pub struct Area {
    pub id: Id,
    pub name: String,
    pub art: Art,
    pub center: Option<Point>,
}

#[derive(Clone, PartialEq, Debug)]
pub struct Group {
    pub id: Id,
    pub name: String,
}

#[derive(Clone, PartialEq, Debug)]
pub struct Person {
    pub id: Id,
    pub name: String,
}

/// A note. `key` is what it hangs on (the id of a house or street, if that is in the index its address is shown). Only the first 64 words
/// of the text are searched.
#[derive(Clone, PartialEq, Debug)]
pub struct Note {
    pub id: Id,
    pub text: String,
    pub key: String,
    pub position: Option<Point>,
    pub area: Option<Id>,
}

/// A command of the command bar. It is only found while `allowed` (the host updates the entry when rights change); `keywords` are
/// more words that find it ("neu", "anlegen"); `priority` orders the commands shown for an empty search (higher first).
#[derive(Clone, PartialEq, Debug)]
pub struct Command {
    pub id: Id,
    pub label: String,
    pub keywords: Vec<String>,
    pub allowed: bool,
    pub priority: u8,
}

#[derive(Clone, PartialEq, Debug)]
pub enum Entry {
    Street(Street),
    House(House),
    Area(Area),
    Group(Group),
    Person(Person),
    Note(Note),
    Command(Command),
}

impl Entry {
    pub fn id(&self) -> &Id {
        match self {
            Entry::Street(e) => &e.id,
            Entry::House(e) => &e.id,
            Entry::Area(e) => &e.id,
            Entry::Group(e) => &e.id,
            Entry::Person(e) => &e.id,
            Entry::Note(e) => &e.id,
            Entry::Command(e) => &e.id,
        }
    }

    pub fn kind(&self) -> Kind {
        match self {
            Entry::Street(_) => Kind::Street,
            Entry::House(_) => Kind::House,
            Entry::Area(_) => Kind::Area,
            Entry::Group(_) => Kind::Group,
            Entry::Person(_) => Kind::Person,
            Entry::Note(_) => Kind::Note,
            Entry::Command(_) => Kind::Command,
        }
    }

    /// The text shown as the title of a hit ("Hauptstraße 12a" for a house).
    pub fn title(&self) -> String {
        match self {
            Entry::Street(e) => e.name.clone(),
            Entry::House(e) => format!("{} {}", e.street, e.number),
            Entry::Area(e) => e.name.clone(),
            Entry::Group(e) => e.name.clone(),
            Entry::Person(e) => e.name.clone(),
            Entry::Note(e) => e.text.clone(),
            Entry::Command(e) => e.label.clone(),
        }
    }

    pub fn position(&self) -> Option<Point> {
        match self {
            Entry::Street(e) => Some(e.center),
            Entry::House(e) => Some(e.position),
            Entry::Area(e) => e.center,
            Entry::Note(e) => e.position,
            Entry::Group(_) | Entry::Person(_) | Entry::Command(_) => None,
        }
    }
}
