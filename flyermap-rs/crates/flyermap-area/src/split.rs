//! A main area (Abholen) cut by a stroke from border to border, inside it: the two pieces, smaller first. One becomes a sub-area; together
//! they are exactly the main area (the same corners on the cut).
use crate::{
    arc::{candidates, side},
    check::check,
    frame::Frame,
    ring::{ccw, close, open, signed_area},
    snap::BorderPoint,
    DrawError, LngLat, Ring,
};

pub fn split(main: &Ring, start: BorderPoint, path: &[LngLat], end: BorderPoint) -> Result<(Ring, Ring), DrawError> {
    let points = open(main);
    if start.along() == end.along() {
        return Err(DrawError::Empty);
    }
    let frame = Frame::around(points.iter().chain(path));
    let stroke: Vec<LngLat> = std::iter::once(start.position(&points)).chain(path.iter().copied()).chain(std::iter::once(end.position(&points))).collect();
    if side(&frame, &points, &stroke) != Some(true) {
        return Err(DrawError::WrongSide);
    }
    let (one, two) = candidates(&points, &start, path, &end);
    let (small, large) = if signed_area(&frame, &one).abs() <= signed_area(&frame, &two).abs() { (one, two) } else { (two, one) };
    let (small, large) = (close(&ccw(&frame, small)), close(&ccw(&frame, large)));
    check(&small, &[])?;
    check(&large, &[])?;
    Ok((small, large))
}
