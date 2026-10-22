//! Connected drawing: a stroke that starts and ends on the border of a Gebiet, outside of it. The two ends cut the old border in two; the
//! smaller shape is the new piece. `Mode::New` makes it a Gebiet of its own (sharing the old border exactly), `Mode::Extend` adds it to the
//! old Gebiet.
use crate::{
    arc::{candidates, side, with_inserted},
    check::{check, overlaps},
    frame::Frame,
    ring::{ccw, close, open, signed_area},
    snap::BorderPoint,
    DrawError, LngLat, Ring,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    New,
    Extend,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Outcome {
    /// The drawn Gebiet (`Mode::New`) or the grown one (`Mode::Extend`), closed and counter-clockwise.
    pub ring: Ring,
    /// `Mode::Extend`: the index of the Gebiet that `ring` replaces.
    pub replaces: Option<usize>,
    /// Neighbours with the two ends inserted as corners, so both sides share the very same points (`Mode::New`).
    pub touched: Vec<(usize, Ring)>,
}

pub fn connect(areas: &[Ring], start: BorderPoint, path: &[LngLat], end: BorderPoint, mode: Mode) -> Result<Outcome, DrawError> {
    if start.area != end.area {
        return Err(DrawError::DifferentAreas);
    }
    let index = start.area;
    let old = open(areas.get(index).ok_or(DrawError::UnknownArea(index))?);
    if start.along() == end.along() && path.is_empty() {
        return Err(DrawError::Empty);
    }
    let frame = Frame::around(old.iter().chain(path));
    let stroke: Vec<LngLat> = std::iter::once(start.position(&old)).chain(path.iter().copied()).chain(std::iter::once(end.position(&old))).collect();
    match side(&frame, &old, &stroke) {
        Some(false) => {}
        Some(true) | None => return Err(DrawError::WrongSide),
    }
    let (one, two) = candidates(&old, &start, path, &end);
    let (piece, grown) = if signed_area(&frame, &one).abs() <= signed_area(&frame, &two).abs() { (one, two) } else { (two, one) };
    let others: Vec<(usize, &Ring)> = areas.iter().enumerate().filter(|(i, _)| *i != index).collect();
    check(&close(&piece), &[])?;
    if let Some(i) = others.iter().find(|(_, r)| overlaps(&frame, &piece, &open(r))).map(|(i, _)| *i) {
        return Err(DrawError::OverlapsArea(i));
    }
    Ok(match mode {
        Mode::New => Outcome { ring: close(&ccw(&frame, piece)), replaces: None, touched: vec![(index, close(&with_inserted(&old, &[start, end])))] },
        Mode::Extend => {
            check(&close(&grown), &[])?;
            Outcome { ring: close(&ccw(&frame, grown)), replaces: Some(index), touched: Vec::new() }
        }
    })
}
