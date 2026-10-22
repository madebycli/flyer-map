//! What the outline of a Gebiet must satisfy, judged by `flyermap-area`: a valid shape, not over another Gebiet of its world, and for a sub-area
//! (Abholen) inside its main area and clear of its sisters. Only the neighbours whose bounding box meets the outline are loaded.
use crate::{
    fail::R,
    queries::areas,
    rights::Ctx,
    sql::Sql,
};
use flyermap_area::{check, within, DrawError};
use flyermap_protocol::{Art, Gebiet, GebietId, Reason, Ring, RingFault};

fn shape(error: DrawError) -> Reason {
    match error {
        DrawError::TooFewPoints => Reason::BadRing { fault: RingFault::TooFewPoints },
        DrawError::SelfCrossing => Reason::BadRing { fault: RingFault::SelfCrossing },
        DrawError::TooSmall => Reason::BadRing { fault: RingFault::TooSmall },
        // the other errors belong to drawing strokes; `check` does not make them
        _ => Reason::BadValue,
    }
}

/// `this` is the Gebiet being drawn or changed (it does not overlap itself); `parent` is the main area of a sub-area.
pub(crate) fn judge<S: Sql>(sql: &mut S, cx: &Ctx, ring: &Ring, art: Art, parent: Option<&Gebiet>, this: &GebietId) -> R<()> {
    check(ring, &[]).map_err(shape)?;
    if let Some(main) = parent {
        if !within(ring, &main.ring) {
            return Err(Reason::OutsideParent.into());
        }
    }
    let neighbours: Vec<Gebiet> = areas::near(sql, art, areas::bbox(ring))?
        .into_iter()
        .filter(|g| &g.id != this && g.parent.as_ref() == parent.map(|p| &p.id))
        .collect();
    let rings: Vec<Ring> = neighbours.iter().map(|g| g.ring.clone()).collect();
    match check(ring, &rings) {
        Ok(()) => Ok(()),
        Err(DrawError::OverlapsArea(i)) => {
            let with = neighbours.get(i).filter(|g| cx.may_outline(g)).map(|g| g.id.clone());
            Err(Reason::Overlaps { with }.into())
        }
        Err(other) => Err(shape(other).into()),
    }
}

/// Every sub-area of `main` must stay inside a new outline of it.
pub(crate) fn children_stay<S: Sql>(sql: &mut S, main: &GebietId, new_ring: &Ring) -> R<()> {
    for child in areas::live_children(sql, main)? {
        if !within(&child.ring, new_ring) {
            return Err(Reason::OutsideParent.into());
        }
    }
    Ok(())
}
