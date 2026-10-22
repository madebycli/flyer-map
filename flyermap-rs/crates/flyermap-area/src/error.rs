/// Why a drawing cannot become a Gebiet. The app turns each into a short German hint.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DrawError {
    /// Fewer than three distinct corners.
    TooFewPoints,
    /// The outline crosses itself.
    SelfCrossing,
    /// Smaller than [`crate::MIN_AREA_M2`].
    TooSmall,
    /// The stroke runs over or into the Gebiet with this index.
    OverlapsArea(usize),
    /// The stroke starts and ends on different Gebiete.
    DifferentAreas,
    /// The stroke runs on the wrong side (inside a Gebiet when connecting, outside the main area when splitting).
    WrongSide,
    /// Start and end are the same point and nothing was drawn in between.
    Empty,
    /// The index of a Gebiet does not exist.
    UnknownArea(usize),
}
