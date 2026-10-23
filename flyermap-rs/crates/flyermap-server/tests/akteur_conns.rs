//! The connection table of an Akteur survives sleep: what is stored comes back as it was, and a row that is not a connection is not one.
use flyermap_aktion::{RusqliteSql, Sql, Value};
use flyermap_identity::{AccessSet, Grant, OrgId, Role, Scope};
use flyermap_server::akteur::{conns, link::Link, live::Conn};

fn conn(id: &str, subscribed: bool) -> Conn {
    let grant = Grant::new(Role::Member, Scope::Organisation { org: OrgId::new("o1") });
    Conn { id: id.into(), link: Link::new("o1", "a1", "per_1", &format!("ses_{id}"), &AccessSet::new(vec![grant])), subscribed }
}

fn sql() -> RusqliteSql {
    let mut sql = RusqliteSql::memory().unwrap();
    conns::install(&mut sql).unwrap();
    sql
}

#[test]
fn what_is_stored_comes_back_and_installing_twice_changes_nothing() {
    let mut sql = sql();
    conns::store(&mut sql, &conn("b", false)).unwrap();
    conns::store(&mut sql, &conn("a", true)).unwrap();
    conns::install(&mut sql).unwrap();
    assert_eq!(conns::load(&mut sql).unwrap(), [conn("a", true), conn("b", false)], "in the order of the ids");
}

#[test]
fn storing_again_updates_and_forgetting_removes() {
    let mut sql = sql();
    conns::store(&mut sql, &conn("a", false)).unwrap();
    conns::store(&mut sql, &conn("a", true)).unwrap();
    assert_eq!(conns::load(&mut sql).unwrap(), [conn("a", true)]);
    conns::forget(&mut sql, "a").unwrap();
    conns::forget(&mut sql, "never-was").unwrap();
    assert!(conns::load(&mut sql).unwrap().is_empty());
}

#[test]
fn a_row_that_is_not_a_connection_is_skipped() {
    let mut sql = sql();
    conns::store(&mut sql, &conn("good", true)).unwrap();
    sql.execute("INSERT INTO shell_conn (id, link, subscribed) VALUES (?, ?, ?)", &[Value::from("bad"), Value::from("{not a link"), Value::from(1_i64)])
        .unwrap();
    assert_eq!(conns::load(&mut sql).unwrap(), [conn("good", true)]);
}
