//! The order of the answer (context only breaks ties between similar matches), the limit, the groups, and keeping the index up to date.
mod common;
use common::*;
use flyermap_search::*;

fn with(text: &str, edit: impl FnOnce(&mut Context)) -> Query {
    let mut query = Query::new(text);
    edit(&mut query.context);
    query
}

#[test]
fn the_nearer_of_two_equal_streets_comes_first() {
    let index = index();
    let near_north = with("bahnhofstraße", |c| c.center = Some(at(NORTH.0, NORTH.1)));
    let near_south = with("bahnhofstraße", |c| c.center = Some(at(SOUTH.0, SOUTH.1)));
    assert_eq!(ids(&index.search(&near_north))[0], "s:bahn-n");
    assert_eq!(ids(&index.search(&near_south))[0], "s:bahn-s");
}

#[test]
fn the_current_gebiet_breaks_the_tie() {
    let index = index();
    let north = with("bahnhofstraße", |c| c.area = Some("a:nord".into()));
    let south = with("bahnhofstraße", |c| c.area = Some("a:sued".into()));
    assert_eq!(ids(&index.search(&north))[0], "s:bahn-n");
    assert_eq!(ids(&index.search(&south))[0], "s:bahn-s");
}

#[test]
fn what_was_used_lately_comes_first() {
    let index = index();
    let recent = |id: &str| with("bahnhofstraße", |c| c.recent = vec![Recent { id: id.into(), at: 5 }]);
    assert_eq!(ids(&index.search(&recent("s:bahn-s")))[0], "s:bahn-s");
    assert_eq!(ids(&index.search(&recent("s:bahn-n")))[0], "s:bahn-n");
}

#[test]
fn a_good_match_far_away_beats_a_poor_one_that_is_near() {
    let index = index();
    // standing in the south, the exact "Hauptstraße" in the north still beats the compound "Am Hauptbahnhof" next to us
    let query = with("hauptstraße", |c| c.center = Some(at(SOUTH.0, SOUTH.1)));
    assert_eq!(ids(&index.search(&query))[0], "s:haupt");
}

#[test]
fn a_lone_number_is_read_on_the_street_the_person_is_on() {
    let index = index();
    let in_north = with("12", |c| c.center = Some(at(NORTH.0, NORTH.1)));
    let in_south = with("12", |c| c.center = Some(at(SOUTH.0, SOUTH.1)));
    assert_eq!(ids(&index.search(&in_north))[0], "h:Hauptstraße:12");
    assert_eq!(ids(&index.search(&in_south))[0], "h:Bahnhofstraße:12");
    // the street last used wins over a map that merely lies about 400 m from another street
    let used = with("12", |c| {
        c.center = Some(at(SOUTH.0, SOUTH.1 + 0.0036));
        c.recent = vec![Recent { id: "s:haupt".into(), at: 1 }];
    });
    assert_eq!(ids(&index.search(&used))[0], "h:Hauptstraße:12");
    // without any of that, the same number on every street is offered
    let found = ids(&search(&index, "12"));
    assert!(found.contains(&"h:Hauptstraße:12".to_string()) && found.contains(&"h:Bahnhofstraße:12".to_string()), "{found:?}");
}

#[test]
fn only_the_allowed_kinds_appear() {
    let index = index();
    let streets = with("nord", |c| c.kinds = KindSet::of(&[Kind::Street]));
    assert!(index.search(&streets).hits.iter().all(|h| h.kind == Kind::Street));
    let nothing = with("müller", |c| c.kinds = KindSet::NONE);
    assert!(index.search(&nothing).is_empty());
    let no_people = with("müller", |c| c.kinds = KindSet::ALL.without(Kind::Person));
    assert!(!ids(&index.search(&no_people)).contains(&"p:juergen".to_string()));
    assert!(ids(&index.search(&no_people)).contains(&"s:mueller".to_string()));
}

#[test]
fn the_limit_holds_and_every_kind_keeps_some_room() {
    let mut entries = town();
    for n in 1..=150 {
        for base in [100, 1000] {
            entries.push(house("Hauptstraße", &(base + n).to_string(), at(NORTH.0, NORTH.1), Some("a:nord")));
        }
    }
    let index = Index::build(entries);
    // houses show up once a number is typed; "1" starts more than a hundred of them
    let query = with("hauptstr 1", |c| c.limit = 10);
    let results = index.search(&query);
    assert_eq!(results.len(), 10);
    assert!(results.hits.iter().any(|h| h.kind == Kind::Street), "a hundred houses must not push out the street");
    assert_eq!(index.search(&with("hauptstr 1", |c| c.limit = 0)).len(), 0);
    assert_eq!(index.search(&with("hauptstr 1", |c| c.limit = 100_000)).len(), 200, "the limit is capped");
    // without a number there is nothing to look up in the houses: the street is the answer
    assert_eq!(ids(&index.search(&with("hauptstr", |c| c.limit = 10))), vec!["s:haupt".to_string()]);
}

#[test]
fn groups_list_the_kinds_by_their_best_hit() {
    let index = index();
    let results = search(&index, "nord");
    assert!(!results.groups.is_empty());
    assert_eq!(results.groups[0].hits[0], 0, "the first group holds the best hit");
    for group in &results.groups {
        assert!(group.hits.windows(2).all(|w| w[0] < w[1]), "best first inside a group");
        assert!(group.hits.iter().all(|&i| results.hits[i].kind == group.kind));
    }
    let total: usize = results.groups.iter().map(|g| g.hits.len()).sum();
    assert_eq!(total, results.len());
}

#[test]
fn houses_of_a_street_come_in_number_order() {
    let index = index();
    let houses = |text: &str| -> Vec<String> { search(&index, text).hits.into_iter().filter(|h| h.kind == Kind::House).map(|h| h.title).collect() };
    // equally good answers are told apart by the number, not by where they were stored: 12a before 12b, 2 before 10
    assert_eq!(houses("hauptstr 12"), ["Hauptstraße 12", "Hauptstraße 12a", "Hauptstraße 12b", "Hauptstraße 12-14"]);
    let by_prefix = houses("hauptstr 1");
    assert_eq!(by_prefix[0], "Hauptstraße 1");
    let place = |t: &str| by_prefix.iter().position(|h| h == t).unwrap_or_else(|| panic!("{t} missing in {by_prefix:?}"));
    assert!(place("Hauptstraße 10") < place("Hauptstraße 12"));
}

#[test]
fn insert_update_and_remove_keep_the_index_right() {
    let mut index = Index::new();
    assert!(index.is_empty());
    let entry = street("s:x", "Lindenallee", at(13.0, 52.0), None);
    assert_eq!(index.insert(entry.clone()), Ok(()));
    assert_eq!(index.insert(entry.clone()), Err(EntryError::Exists));
    assert_eq!(ids(&search(&index, "linden")), vec!["s:x".to_string()]);

    assert_eq!(index.update(street("s:x", "Ulmenweg", at(13.0, 52.0), None)), Ok(()));
    assert!(search(&index, "linden").is_empty(), "the old name is gone");
    assert_eq!(ids(&search(&index, "ulmen")), vec!["s:x".to_string()]);
    assert_eq!(index.update(street("s:nope", "Nirgends", at(0.0, 0.0), None)), Err(EntryError::Missing));

    let removed = index.remove(&"s:x".into());
    assert_eq!(removed.map(|e| e.title()), Some("Ulmenweg".to_string()));
    assert!(search(&index, "ulmen").is_empty());
    assert!(index.is_empty() && index.remove(&"s:x".into()).is_none());
}

#[test]
fn entries_that_cannot_be_searched_are_refused() {
    let mut index = Index::new();
    assert_eq!(index.insert(street("", "Name", at(0.0, 0.0), None)), Err(EntryError::EmptyId));
    assert_eq!(index.insert(street("s:1", "...", at(0.0, 0.0), None)), Err(EntryError::NoText));
    assert_eq!(index.insert(house("", "12", at(0.0, 0.0), None)), Err(EntryError::IncompleteHouse));
    assert_eq!(index.insert(house("Hauptstraße", "", at(0.0, 0.0), None)), Err(EntryError::IncompleteHouse));
    let built = Index::build(vec![street("s:1", "...", at(0.0, 0.0), None), street("s:2", "Gut", at(0.0, 0.0), None)]);
    assert_eq!((built.len(), built.rejected()), (1, 1));
}

#[test]
fn get_gives_back_what_was_put_in() {
    let index = index();
    for entry in town() {
        assert_eq!(index.get(entry.id()).as_ref(), Some(&entry), "{}", entry.id());
    }
}

#[test]
fn an_updated_index_answers_exactly_like_one_built_from_scratch() {
    let built = index();
    let mut worked = Index::new();
    let mut entries = town();
    entries.reverse();
    for entry in entries {
        worked.insert(entry).unwrap();
    }
    // churn: take half out and put it back changed and then as it was
    let leave: Vec<Entry> = town().into_iter().step_by(2).collect();
    for entry in &leave {
        worked.remove(entry.id());
    }
    for entry in &leave {
        worked.insert(entry.clone()).unwrap();
    }
    assert_eq!(worked.len(), built.len());
    for text in ["haupt", "12", "hauptstr 12", "müller", "bahnhof", "nord", "neu", "klingel", "17 juni", "str"] {
        for context in [Context::default(), Context { center: Some(at(SOUTH.0, SOUTH.1)), ..Context::default() }] {
            let query = Query { text: text.to_string(), context };
            assert_eq!(built.search(&query), worked.search(&query), "{text}");
        }
    }
}

#[test]
fn the_same_question_gives_the_same_answer() {
    let index = index();
    for text in ["str", "12", "nord", "a"] {
        assert_eq!(search(&index, text), search(&index, text), "{text}");
    }
}

#[test]
fn the_index_reports_what_it_holds() {
    let index = index();
    assert_eq!(index.len(), town().len());
    assert!(index.contains(&"s:haupt".into()) && !index.contains(&"s:none".into()));
    let memory = index.memory();
    assert_eq!(memory.total(), memory.entries + memory.labels + memory.vocabulary + memory.lookup);
    assert!(memory.total() > 0);
}
