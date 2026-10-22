//! What a person may type and still find the thing: spellings, parts of words, typos, house numbers, commands.
mod common;
use common::*;
use flyermap_search::*;

fn first(index: &Index, text: &str) -> String {
    let results = search(index, text);
    results.hits.first().map(|h| h.entry.id().to_string()).unwrap_or_else(|| panic!("nothing found for {text:?}"))
}

#[test]
fn case_umlauts_and_sharp_s_do_not_matter() {
    let index = index();
    for text in ["Hauptstraße", "hauptstrasse", "HAUPTSTRASSE", "hauptstr", "Hauptstr."] {
        assert_eq!(first(&index, text), "s:haupt", "{text}");
    }
    for text in ["müllerstraße", "muellerstrasse", "mullerstrasse", "MÜLLERSTR"] {
        assert_eq!(first(&index, text), "s:mueller", "{text}");
    }
}

#[test]
fn punctuation_is_only_a_separator() {
    let index = index();
    for text in ["Dr. Eschenbach", "dr-eschenbach", "eschenbach str", "Dr.-Eschenbach-Str."] {
        assert_eq!(first(&index, text), "s:eschenbach", "{text}");
    }
}

#[test]
fn a_part_of_a_word_finds_the_word_and_compounds_that_contain_it() {
    let index = index();
    let found = ids(&search(&index, "haupt"));
    assert!(found.contains(&"s:haupt".to_string()) && found.contains(&"s:bahnhof".to_string()), "{found:?}");
    assert_eq!(first(&index, "bahnhof"), "s:bahn-n", "the street that starts with it comes before the compound");
    assert!(ids(&search(&index, "bahnhof")).contains(&"s:bahnhof".to_string()));
}

#[test]
fn several_words_in_any_order() {
    let index = index();
    assert_eq!(first(&index, "juni 17"), "s:juni");
    assert_eq!(first(&index, "des juni"), "s:juni");
    assert_eq!(first(&index, "am bahnhof"), "s:bahnhof");
    assert_eq!(first(&index, "hauptbahnhof am"), "s:bahnhof");
}

#[test]
fn typos_are_forgiven_from_four_letters() {
    let index = index();
    assert_eq!(first(&index, "Hauptstrase"), "s:haupt");
    assert_eq!(first(&index, "Hautpstraße"), "s:haupt");
    assert_eq!(first(&index, "Mulerstraße"), "s:mueller");
    assert_eq!(first(&index, "eschnbach"), "s:eschenbach");
    // too short to guess: three letters with a typo find nothing that is not a prefix
    assert!(search(&index, "xyz").is_empty());
}

#[test]
fn a_house_number_jumps_to_the_house() {
    let index = index();
    for text in ["Hauptstr 12a", "12a Hauptstr", "Hauptstr 12 a", "hauptstraße 12A"] {
        assert_eq!(first(&index, text), "h:Hauptstraße:12a", "{text}");
    }
    assert_eq!(first(&index, "Hauptstr 12"), "h:Hauptstraße:12");
    assert_eq!(first(&index, "Hauptstr 12-14"), "h:Hauptstraße:12-14");
}

#[test]
fn an_exact_number_beats_an_addition_beats_a_range() {
    let index = index();
    let found = ids(&search(&index, "Hauptstr 12"));
    let place = |id: &str| found.iter().position(|f| f == id).unwrap_or_else(|| panic!("{id} missing in {found:?}"));
    assert!(place("h:Hauptstraße:12") < place("h:Hauptstraße:12a"));
    assert!(place("h:Hauptstraße:12a") < place("h:Hauptstraße:12-14"));
    // 13 is not a house, but the range 12-14 holds it
    assert_eq!(first(&index, "Hauptstr 13"), "h:Hauptstraße:12-14");
}

#[test]
fn a_street_without_the_typed_number_is_still_offered_below_the_houses() {
    let index = index();
    let found = ids(&search(&index, "Hauptstr 99"));
    assert_eq!(found, vec!["s:haupt".to_string()], "no house 99: only the street, nothing else invented");
}

#[test]
fn the_house_highlights_cover_street_and_number() {
    let index = index();
    let results = search(&index, "Hauptstr 12a");
    let hit = &results.hits[0];
    assert_eq!(hit.title, "Hauptstraße 12a");
    let marked: Vec<&str> = hit.highlights.iter().map(|r| &hit.title[r.clone()]).collect();
    // an abbreviation that was written out ("str" = "straße") marks the whole word it stands for
    assert_eq!(marked, vec!["Hauptstraße", "12a"]);
}

#[test]
fn highlights_are_sorted_disjoint_and_on_character_boundaries() {
    let index = index();
    for text in ["müller", "mueller", "straße", "haupt bahnhof", "Hauptstr 12", "juni", "Dr Eschenbach"] {
        for hit in search(&index, text).hits {
            let mut end = 0;
            for r in &hit.highlights {
                assert!(r.start >= end && r.start < r.end, "{text}: {:?} in {:?}", hit.highlights, hit.title);
                assert!(hit.title.is_char_boundary(r.start) && hit.title.is_char_boundary(r.end), "{text}: {:?} in {:?}", hit.highlights, hit.title);
                end = r.end;
            }
            assert!(end <= hit.title.len());
        }
    }
}

#[test]
fn commands_are_found_by_label_and_by_keyword() {
    let index = index();
    assert_eq!(first(&index, "neues gebiet"), "c:new-area");
    assert_eq!(first(&index, "anlegen"), "c:new-area");
    assert_eq!(first(&index, "lauf"), "c:run");
    assert_eq!(first(&index, "los"), "c:run");
}

#[test]
fn a_command_that_is_not_allowed_is_never_found() {
    let index = index();
    for text in ["gruppe löschen", "entfernen", "löschen"] {
        assert!(!ids(&search(&index, text)).contains(&"c:delete-group".to_string()), "{text}");
    }
    let mut index = index;
    index.update(command("c:delete-group", "Gruppe löschen", &["entfernen"], true, 10)).unwrap();
    assert_eq!(first(&index, "gruppe löschen"), "c:delete-group");
}

#[test]
fn people_groups_areas_and_notes_are_found_too() {
    let index = index();
    assert_eq!(first(&index, "jürgen"), "p:juergen");
    assert_eq!(first(&index, "juergen mueller"), "p:juergen");
    assert_eq!(first(&index, "nordstadt"), "a:nord");
    assert_eq!(first(&index, "gruppe nord"), "g:nord");
    assert_eq!(first(&index, "klingel hund"), "n:1");
    assert_eq!(first(&index, "südviertel"), "a:sued");
    assert_eq!(first(&index, "suedviertel"), "a:sued");
}

#[test]
fn nothing_that_looks_like_nothing_finds_nothing() {
    let index = index();
    for text in ["", "   ", "...", "qqqqqqqq"] {
        let results = search(&index, text);
        assert!(results.hits.iter().all(|h| h.kind == Kind::Command) || results.is_empty(), "{text:?}: {:?}", titles(&results));
    }
}

#[test]
fn an_empty_search_offers_the_allowed_commands_by_priority() {
    let index = index();
    let results = search(&index, "");
    assert_eq!(ids(&results), vec!["c:new-area".to_string(), "c:run".to_string()]);
}
