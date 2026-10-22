//! Hand-made drawing cases (Plan 057 §6.1): a square Gebiet of about 700 m × 1100 m and strokes around it.
use flyermap_area::{area_m2, check, close, connect, open, snap, split, BorderPoint, DrawError, Mode, Ring};

fn square(w: f64, s: f64, e: f64, n: f64) -> Ring {
    close(&[[w, s], [e, s], [e, n], [w, n]])
}
fn at(area: usize, edge: usize, t: f64) -> BorderPoint {
    BorderPoint { area, edge, t }
}
fn near(a: f64, b: f64, rel: f64) -> bool {
    (a - b).abs() <= rel * b.abs()
}

#[test]
fn a_new_gebiet_takes_the_old_border_between_its_ends() {
    let areas = vec![square(13.0, 51.0, 13.01, 51.01)];
    let out = connect(&areas, at(0, 1, 0.25), &[[13.02, 51.0025], [13.02, 51.0075]], at(0, 1, 0.75), Mode::New).unwrap();
    assert_eq!(out.replaces, None);
    assert_eq!(out.ring.len(), 5, "four corners, closed");
    let a = [13.01, 51.0025];
    let b = [13.01, 51.0075];
    assert!(out.ring.contains(&a) && out.ring.contains(&b));
    assert!(near(area_m2(&out.ring), 0.01 * 111_320.0 * 51.005f64.to_radians().cos() * 0.005 * 110_574.0, 0.01));
    // the old Gebiet gets the same two points as corners: no gap, no sliver
    let (index, touched) = &out.touched[0];
    assert_eq!(*index, 0);
    assert_eq!(open(touched).len(), 6);
    assert!(touched.contains(&a) && touched.contains(&b));
    assert_eq!(check(&out.ring, std::slice::from_ref(touched)), Ok(()));
}

#[test]
fn extending_grows_the_old_gebiet_by_the_piece() {
    let areas = vec![square(13.0, 51.0, 13.01, 51.01)];
    let out = connect(&areas, at(0, 1, 0.25), &[[13.02, 51.0025], [13.02, 51.0075]], at(0, 1, 0.75), Mode::Extend).unwrap();
    assert_eq!(out.replaces, Some(0));
    assert_eq!(open(&out.ring).len(), 8);
    let piece = connect(&areas, at(0, 1, 0.25), &[[13.02, 51.0025], [13.02, 51.0075]], at(0, 1, 0.75), Mode::New).unwrap().ring;
    assert!(near(area_m2(&out.ring), area_m2(&areas[0]) + area_m2(&piece), 1e-6));
}

#[test]
fn corners_are_taken_as_they_are() {
    let areas = vec![square(13.0, 51.0, 13.01, 51.01)];
    let start = snap([13.0101, 51.0001], &areas, 30.0, 15.0);
    let end = snap([13.0099, 51.0099], &areas, 30.0, 15.0);
    assert_eq!(start.border, Some(at(0, 1, 0.0)));
    assert_eq!(end.border, Some(at(0, 2, 0.0)));
    let out = connect(&areas, start.border.unwrap(), &[[13.02, 51.0], [13.02, 51.01]], end.border.unwrap(), Mode::New).unwrap();
    assert_eq!(open(&out.ring).len(), 4);
    assert_eq!(open(&out.touched[0].1), open(&areas[0]), "nothing to insert on corners");
}

#[test]
fn the_shorter_way_round_wins_also_across_the_first_corner() {
    let areas = vec![square(13.0, 51.0, 13.01, 51.01)];
    // from the west edge round the south-west corner to the south edge
    let out = connect(&areas, at(0, 3, 0.5), &[[12.99, 51.005], [12.99, 50.99], [13.005, 50.99]], at(0, 0, 0.5), Mode::New).unwrap();
    assert!(out.ring.contains(&[13.0, 51.0]), "the corner between the ends belongs to the new piece");
    assert!(!out.ring.contains(&[13.01, 51.01]));
}

#[test]
fn strokes_on_the_wrong_side_or_across_are_refused() {
    let areas = vec![square(13.0, 51.0, 13.01, 51.01)];
    assert_eq!(connect(&areas, at(0, 1, 0.25), &[[13.005, 51.005]], at(0, 1, 0.75), Mode::New), Err(DrawError::WrongSide));
    assert_eq!(connect(&areas, at(0, 1, 0.25), &[[13.02, 51.0025], [13.005, 51.005]], at(0, 1, 0.75), Mode::New), Err(DrawError::WrongSide));
    assert_eq!(connect(&areas, at(0, 1, 0.25), &[], at(0, 1, 0.25), Mode::New), Err(DrawError::Empty));
}

#[test]
fn other_gebiete_may_be_touched_but_not_covered() {
    let areas = [square(13.0, 51.0, 13.01, 51.01), square(13.015, 51.0, 13.03, 51.01), square(13.012, 51.004, 13.013, 51.005)];
    assert_eq!(connect(&areas[..2], at(0, 1, 0.25), &[[13.02, 51.0025], [13.02, 51.0075]], at(0, 1, 0.75), Mode::New), Err(DrawError::OverlapsArea(1)));
    let around_the_small_one = [[13.014, 51.0025], [13.014, 51.0075]];
    assert_eq!(
        connect(&[areas[0].clone(), areas[2].clone()], at(0, 1, 0.25), &around_the_small_one, at(0, 1, 0.75), Mode::New),
        Err(DrawError::OverlapsArea(1))
    );
    // ending on the neighbour's border: allowed, it only touches
    let touching = vec![areas[0].clone(), square(13.02, 51.0, 13.03, 51.01)];
    assert!(connect(&touching, at(0, 1, 0.25), &[[13.02, 51.0025], [13.02, 51.0075]], at(0, 1, 0.75), Mode::New).is_ok());
    assert_eq!(connect(&touching, at(0, 1, 0.25), &[[13.02, 51.0025]], at(1, 3, 0.5), Mode::New), Err(DrawError::DifferentAreas));
}

#[test]
fn a_slip_of_the_finger_is_too_small() {
    let areas = vec![square(13.0, 51.0, 13.01, 51.01)];
    assert_eq!(connect(&areas, at(0, 1, 0.5), &[[13.01001, 51.00501]], at(0, 1, 0.5005), Mode::New), Err(DrawError::TooSmall));
}

#[test]
fn a_main_area_is_split_into_two_pieces_that_make_it_whole() {
    let main = square(13.0, 51.0, 13.01, 51.01);
    let (small, large) = split(&main, at(0, 0, 0.3), &[[13.003, 51.004]], at(0, 2, 0.7)).unwrap();
    assert!(area_m2(&small) <= area_m2(&large));
    assert!(near(area_m2(&small) + area_m2(&large), area_m2(&main), 1e-9));
    assert_eq!(check(&small, std::slice::from_ref(&large)), Ok(()), "the pieces touch along the cut, they do not overlap");
    assert_eq!(split(&main, at(0, 0, 0.3), &[[13.003, 50.99]], at(0, 2, 0.7)), Err(DrawError::WrongSide));
}

#[test]
fn outlines_are_checked() {
    let a = square(13.0, 51.0, 13.01, 51.01);
    assert_eq!(check(&close(&[[13.0, 51.0], [13.01, 51.01], [13.01, 51.0], [13.0, 51.01]]), &[]), Err(DrawError::SelfCrossing));
    assert_eq!(check(&close(&[[13.0, 51.0], [13.01, 51.0]]), &[]), Err(DrawError::TooFewPoints));
    assert_eq!(check(&a, std::slice::from_ref(&a)), Err(DrawError::OverlapsArea(0)), "the same outline twice");
    assert_eq!(check(&square(13.01, 51.0, 13.02, 51.01), std::slice::from_ref(&a)), Ok(()), "a neighbour sharing the border");
    assert_eq!(check(&square(13.005, 51.0, 13.02, 51.01), std::slice::from_ref(&a)), Err(DrawError::OverlapsArea(0)));
    assert_eq!(check(&square(13.002, 51.002, 13.003, 51.003), &[a]), Err(DrawError::OverlapsArea(0)), "inside another");
}

#[test]
fn snapping_reaches_only_so_far() {
    let areas = vec![square(13.0, 51.0, 13.01, 51.01)];
    let far = snap([13.02, 51.005], &areas, 30.0, 10.0);
    assert_eq!(far.border, None);
    assert!(far.distance_m > 600.0);
    let edge = snap([13.0102, 51.005], &areas, 30.0, 10.0);
    let b = edge.border.unwrap();
    assert_eq!((b.area, b.edge), (0, 1));
    assert!((b.t - 0.5).abs() < 1e-6);
    assert_eq!(edge.point[0], 13.01);
}
