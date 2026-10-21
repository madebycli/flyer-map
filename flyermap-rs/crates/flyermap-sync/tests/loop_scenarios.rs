mod support;
use flyermap_core::Status;
use flyermap_diag::{install, MemoryRecorder, Recorder};
use flyermap_sync::{Event, State, TimerKind};
use std::rc::Rc;
use support::{
    device::Device,
    server::{Fate, Server},
};

const T0: u64 = 1_800_000_000_000;

fn world() -> (Server, Device, Device) {
    (Server::new(T0), Device::new("alice", T0), Device::new("bob", T0))
}

#[test]
fn a_local_edit_waits_a_moment_then_goes_out_and_comes_back_as_the_servers_truth() {
    let (mut server, mut alice, mut bob) = world();
    alice.mark("h:1", Status::Completed);
    assert_eq!(alice.timers, [(TimerKind::Kick, 50)]);
    assert!(alice.saves.contains(&flyermap_sync::Save::Outbox), "the queue is saved at once");
    alice.sync(&mut server);
    assert_eq!(alice.store.pending_len(), 0);
    assert_eq!(alice.machine.state(), State::Idle);
    bob.mark("h:2", Status::Later);
    bob.sync(&mut server);
    alice.mark("h:3", Status::NotDeliverable);
    alice.sync(&mut server);
    bob.kick(&mut server);
    assert_eq!(alice.view(), bob.view());
    assert_eq!(server.truth().len(), 3);
}

#[test]
fn two_devices_overwrite_the_same_house_at_once_one_winner_and_the_loser_is_told() {
    let (mut server, mut alice, mut bob) = world();
    alice.mark("h:1", Status::Completed);
    bob.now += 5;
    bob.mark("h:1", Status::Later);
    alice.sync(&mut server);
    bob.sync(&mut server);
    alice.mark("h:9", Status::Completed); // another round for alice to pull
    alice.sync(&mut server);
    assert_eq!(server.truth()["h:1"], Status::Later);
    assert_eq!(alice.view()["h:1"], Status::Later);
    assert_eq!(alice.store.conflicts().len(), 1, "alice's edit was replaced by a different status");
    assert!(bob.store.conflicts().is_empty());
}

#[test]
fn lost_answers_and_duplicate_deliveries_change_nothing() {
    let (mut server, mut alice, mut bob) = world();
    alice.mark("h:1", Status::Completed);
    alice.fates = vec![Fate::LoseAnswer];
    alice.sync(&mut server);
    assert_eq!(alice.machine.state(), State::Offline);
    assert_eq!(alice.store.pending_len(), 1, "not confirmed, so still queued");
    assert_eq!(alice.timers, [(TimerKind::Retry, 1000)]);
    alice.retry(&mut server);
    assert_eq!(alice.store.pending_len(), 0);
    assert_eq!(alice.machine.state(), State::Idle);
    bob.mark("h:2", Status::Later);
    bob.sync(&mut server);
    assert_eq!(server.truth().len(), 2);
    assert_eq!(server.truth()["h:1"], Status::Completed);
}

#[test]
fn backoff_doubles_while_the_network_is_down_and_resets_when_it_returns() {
    let (mut server, mut alice, _) = world();
    alice.mark("h:1", Status::Completed);
    alice.fail_all = true;
    alice.sync(&mut server);
    let mut waits = vec![alice.timers[0].1];
    for _ in 0..5 {
        alice.retry(&mut server);
        waits.push(alice.timers[0].1);
    }
    assert_eq!(waits, [1000, 2000, 4000, 8000, 16_000, 30_000]);
    alice.fail_all = false;
    alice.retry(&mut server);
    assert_eq!(alice.machine.state(), State::Idle);
    assert!(alice.timers.is_empty());
    assert_eq!(alice.machine.info().last_error, None);
    assert!(alice.machine.info().last_ok_at.is_some());
}

#[test]
fn a_device_whose_clock_is_an_hour_off_is_corrected_by_the_server_and_still_wins_when_it_edits_last() {
    let (mut server, mut alice, mut bob) = world();
    bob.now = T0 - 3_600_000; // bob's phone runs an hour behind
    bob.mark("h:1", Status::Later);
    bob.sync(&mut server); // learns the server time
    assert_eq!(bob.store.clock_offset_ms(), 3_600_000);
    alice.mark("h:1", Status::Completed);
    alice.sync(&mut server);
    bob.now += 10_000;
    server.now += 10_000;
    bob.mark("h:1", Status::NotDeliverable);
    bob.sync(&mut server);
    alice.sync(&mut server);
    assert_eq!(server.truth()["h:1"], Status::NotDeliverable, "the later edit wins although bob's own clock is behind");
}

#[test]
fn edits_the_server_refuses_are_rolled_back_and_never_retried() {
    let (mut server, mut alice, _) = world();
    server.forbidden.push("a1".into());
    alice.mark("h:1", Status::Completed);
    alice.sync(&mut server);
    assert_eq!(alice.store.pending_len(), 0);
    assert_eq!(alice.store.status_of(&flyermap_core::Key::new("h:1")), Status::Open, "the screen shows what the server has");
    assert!(alice.timers.is_empty(), "no retry for a refusal");
}

#[test]
fn paging_pulls_until_nothing_is_new() {
    let (mut server, mut alice, mut bob) = world();
    server.page = 2;
    for n in 0..7 {
        bob.mark(&format!("h:{n}"), Status::Completed);
    }
    bob.sync(&mut server);
    alice.mark("h:x", Status::Later);
    alice.sync(&mut server);
    assert_eq!(alice.view().len(), 8);
    let rounds: Vec<_> = alice.machine.history().collect();
    assert!(rounds.last().unwrap().pages >= 4, "{:?}", rounds.last());
}

#[test]
fn a_kick_during_a_round_runs_one_more_round_and_dispose_stops_everything() {
    let (mut server, mut alice, _) = world();
    alice.mark("h:1", Status::Completed);
    let actions = alice.machine.handle(&mut alice.store, alice.now, Event::Timer(TimerKind::Kick));
    assert!(alice.machine.is_running());
    assert!(alice.machine.handle(&mut alice.store, alice.now, Event::Timer(TimerKind::Kick)).is_empty(), "already running: remembered, not started twice");
    let _ = actions;
    alice.machine.handle(&mut alice.store, alice.now, Event::Dispose);
    assert!(alice.machine.handle(&mut alice.store, alice.now, Event::Kick).is_empty());
    alice.sync(&mut server);
}

#[test]
fn the_diagnostics_tell_what_went_wrong_and_when_it_recovered() {
    let now = Rc::new(std::cell::Cell::new(T0));
    let clock = Rc::clone(&now);
    let rec = Rc::new(MemoryRecorder::new(move || clock.get()));
    install(Rc::clone(&rec) as Rc<dyn Recorder>);
    let (mut server, mut alice, _) = world();
    alice.mark("h:1", Status::Completed);
    alice.fail_all = true;
    alice.sync(&mut server);
    alice.fail_all = false;
    alice.retry(&mut server);
    let report = rec.report("test", Default::default(), vec![]);
    assert_eq!(report.problems[0].code, "sync.failed");
    assert_eq!(report.counters["sync.failures"], 1);
    assert_eq!(report.counters["sync.result.failed"], 1);
    assert!(report.counters["sync.result.ok"] >= 1);
    assert!(report.events.iter().any(|e| e.message == "sync recovered"));
    let probe = alice.machine.probe(&alice.store, T0);
    assert_eq!(probe["state"], "idle");
    assert_eq!(probe["rounds"].as_array().unwrap().len(), 2);
    flyermap_diag::uninstall();
}
