//! Random histories. Whatever the commands, in whatever order, from whoever: the invariants hold after every one (the `World` checks them), a retry is
//! answered the same and happens once, nobody causes an entry they have no right to, the tables are a function of the log, and a device that is told
//! what it may see ends with what a person with its rights may see.
mod support;
use flyermap_aktion::{Caller, Dump, Handled, Limits};
use flyermap_identity::{decide, Action, Resource};
use flyermap_protocol::{Change, Command, CommandId, Verdict};
use support::{
    gen::{cast, command, pick_caller, seed_commands, Rng},
    mirror::{oracle, Mirror},
    who,
    world::World,
};

const STEPS: usize = 120;
const SEEDS: u64 = 120;
const HALF_HOUR: u64 = 30 * 60 * 1000;

/// The actions of which at least one lets this caller cause this entry. An entry is caused by a command; the same entry can come from several (a
/// recount of a Lauf from a mark, from a clean-up, from a hand-over), so the sets are as wide as the commands that make them, and no wider.
fn explains(change: &Change) -> &'static [Action] {
    match change {
        Change::MarkSet { .. } => &[Action::Mark, Action::DrawArea],
        Change::NoteSet { .. } => &[Action::Annotate, Action::DrawArea],
        Change::MarksRemoved { .. }
        | Change::NotesRemoved { .. }
        | Change::HandedOver { .. }
        | Change::GebietSet { .. }
        | Change::GebietRemoved { .. } => &[Action::DrawArea],
        Change::GruppeSet { .. } | Change::GruppeRemoved { .. } => &[Action::ManageGroup],
        Change::Collected { .. } => &[Action::Collect],
        Change::Released { .. } => &[Action::Collect, Action::ManageAktion],
        Change::LaufSet { .. } | Change::LaufEnded { .. } => &[Action::StartRun, Action::Mark, Action::DrawArea],
    }
}

fn assert_entries_are_theirs(caller: &Caller, handled: &Handled, dump: &Dump, now: u64) {
    for entry in &handled.broadcast {
        assert_eq!(entry.by, caller.principal, "entries carry the label of whoever caused them");
        let resources: Vec<Resource> = match entry.change.gebiet() {
            Some(id) => dump
                .gebiete
                .iter()
                .filter(|(g, _)| &g.id == id)
                .map(|(g, _)| Resource::gebiet(&who::org(), &who::aktion(), &g.id, g.art, g.gruppe.as_ref()))
                .collect(),
            None => {
                let gruppe = match &entry.change {
                    Change::GruppeSet { gruppe } => gruppe.id.clone(),
                    Change::GruppeRemoved { id, .. } => id.clone(),
                    _ => unreachable!(),
                };
                vec![Resource::aktion(&who::org(), &who::aktion()), Resource::gruppe(&who::org(), &who::aktion(), &gruppe)]
            }
        };
        assert!(!resources.is_empty(), "an entry about a Gebiet that does not exist: {entry:?}");
        let allowed = resources.iter().any(|r| explains(&entry.change).iter().any(|a| decide(&caller.access, now, *a, r).is_allowed()));
        assert!(allowed, "{} caused {entry:?} without a right to", caller.principal);
    }
}

struct Watcher {
    caller: Caller,
    device: Mirror,
    online: bool,
}

fn bring_up_to_date(w: &mut World, watcher: &mut Watcher) {
    if !watcher.device.catch_up(&mut w.a, &watcher.caller, w.now, 9) {
        watcher.device = Mirror::from_scratch(&mut w.a, &watcher.caller, w.now, 9);
    }
    watcher.online = true;
}

fn run(seed: u64, compacting: bool) {
    let mut rng = Rng::new(seed * 2 + u64::from(compacting));
    let limits = Limits { done_ttl_ms: 2 * 60 * 60 * 1000, log_keep: if compacting { 25 } else { u64::MAX / 4 }, ..Limits::default() };
    let mut w = World::with(limits);
    for body in seed_commands() {
        w.ok(&who::admin(), body);
    }
    let cast = cast();
    let mut watchers: Vec<Watcher> = [who::admin(), who::lead("nord"), who::member("nord"), who::member("sued"), who::helper("h1"), who::viewer()]
        .into_iter()
        .map(|caller| Watcher { device: Mirror::from_scratch(&mut w.a, &caller, w.now, 9), caller, online: true })
        .collect();
    // (who, the command, the answer, when): to be sent again
    let mut sent: Vec<(Caller, Command, Verdict, u64)> = Vec::new();
    let mut counter = 0;

    for _ in 0..STEPS {
        w.tick(rng.below(3000));
        if rng.chance(3) {
            w.tick(60 * 60 * 1000);
        }
        let dump = w.a.dump().unwrap();
        let retry = rng.chance(10).then(|| sent.iter().rev().filter(|(_, _, _, at)| w.now - at < HALF_HOUR).nth(rng.below(4) as usize).cloned()).flatten();
        let (caller, command, earlier) = match retry {
            Some((caller, command, verdict, _)) => (caller, command, Some(verdict)),
            None => {
                counter += 1;
                (pick_caller(&mut rng, &cast).clone(), Command { cid: CommandId::new(format!("c{counter}")), body: command(&mut rng, w.now, &dump) }, None)
            }
        };
        let head = w.a.head();
        let handled = w.send_command(&caller, command.clone());
        match (&earlier, &handled.reply.verdict) {
            (Some(Verdict::Accepted { .. }), _) => {
                assert!(handled.replayed, "an answered command is not done again");
                assert_eq!(Some(&handled.reply.verdict), earlier.as_ref());
                assert!(handled.broadcast.is_empty() && w.a.head() == head);
            }
            (_, Verdict::Accepted { .. }) => assert!(!handled.replayed),
            _ => {}
        }
        if earlier.is_none() {
            sent.push((caller.clone(), command, handled.reply.verdict.clone(), w.now));
        }
        let after = w.a.dump().unwrap();
        assert_entries_are_theirs(&caller, &handled, &after, w.now);

        for watcher in &mut watchers {
            match (watcher.online, rng.chance(8)) {
                (true, true) => watcher.online = false,
                (false, true) => bring_up_to_date(&mut w, watcher),
                _ => {}
            }
            if watcher.online {
                watcher.device.apply_all(&handled.audience.filter(&watcher.caller, w.now, &handled.broadcast));
                watcher.device.advance(handled.head);
            }
        }
        if compacting && rng.chance(12) {
            w.a.compact().unwrap();
            w.assert_sound();
        }
    }

    let dump = w.a.dump().unwrap();
    for watcher in &mut watchers {
        bring_up_to_date(&mut w, watcher);
        assert_eq!(watcher.device.view(), oracle(&dump, &watcher.caller, w.now), "seed {seed}: {} after {STEPS} steps", watcher.caller.principal);
        let fresh = Mirror::from_scratch(&mut w.a, &watcher.caller, w.now, 1000);
        assert_eq!(fresh.view(), watcher.device.view(), "seed {seed}: {} from scratch", watcher.caller.principal);
    }
    if !compacting {
        w.assert_replays();
    }
    // the history did something: it was not all refusals
    assert!(w.a.head() >= 8, "seed {seed}: head {}", w.a.head());
}

#[test]
fn random_histories_keep_every_promise() {
    for seed in 0..SEEDS {
        run(seed, false);
    }
}

#[test]
fn random_histories_with_the_log_compacted_keep_every_promise() {
    for seed in 0..SEEDS {
        run(seed, true);
    }
}
