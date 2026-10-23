//! An Aktion over in-memory SQLite with a clock the test moves by hand. Every command sent through it is followed by the invariants check, so a test
//! cannot pass over a state that is broken.
use super::{who, T0};
use flyermap_aktion::{Aktion, Caller, Handled, Limits, RusqliteSql};
use flyermap_protocol::{Body, Command, CommandId, Entry, Reason, Verdict};

pub struct World {
    pub a: Aktion<RusqliteSql>,
    pub now: u64,
    next: u64,
}

impl World {
    pub fn new() -> World {
        World::with(Limits::default())
    }

    pub fn with(limits: Limits) -> World {
        let sql = RusqliteSql::memory().expect("memory database");
        World { a: Aktion::open(sql, who::org(), who::aktion(), limits).expect("open"), now: T0, next: 0 }
    }

    pub fn cid(&mut self) -> CommandId {
        self.next += 1;
        CommandId::new(format!("c{}", self.next))
    }

    pub fn tick(&mut self, ms: u64) {
        self.now += ms;
    }

    /// Send a command with a fresh id; the state must be sound afterwards, whatever the answer.
    pub fn send(&mut self, caller: &Caller, body: Body) -> Handled {
        let cid = self.cid();
        self.send_command(caller, Command { cid, body })
    }

    pub fn send_command(&mut self, caller: &Caller, command: Command) -> Handled {
        let handled = self.a.handle(caller, command, self.now);
        self.assert_sound();
        handled
    }

    /// The command is accepted; returns the verdict.
    pub fn ok(&mut self, caller: &Caller, body: Body) -> Verdict {
        let handled = self.send(caller, body);
        assert!(handled.reply.verdict.is_accepted(), "expected acceptance, got {:?}", handled.reply.verdict);
        handled.reply.verdict
    }

    /// The command is rejected; returns why. Nothing was broadcast and the log did not move.
    pub fn no(&mut self, caller: &Caller, body: Body) -> Reason {
        let head = self.a.head();
        let handled = self.send(caller, body);
        let Verdict::Rejected { reason } = handled.reply.verdict else { panic!("expected a rejection, got {:?}", handled.reply.verdict) };
        assert!(handled.broadcast.is_empty(), "a rejected command broadcasts nothing");
        assert_eq!(self.a.head(), head, "a rejected command leaves the log as it was");
        reason
    }

    pub fn assert_sound(&mut self) {
        let faults = self.a.check().expect("check");
        assert!(faults.is_empty(), "the state is broken: {faults:?}");
    }

    /// The log, from the start.
    pub fn log(&mut self) -> Vec<Entry> {
        self.a.entries(self.a.floor(), 1_000_000).expect("entries")
    }

    /// Rebuild the state from the log into a fresh Aktion: it must be the same.
    pub fn assert_replays(&mut self) {
        let entries = self.log();
        let mut fresh = Aktion::open(RusqliteSql::memory().expect("memory"), who::org(), who::aktion(), Limits::default()).expect("open");
        fresh.replay(&entries, self.now).expect("replay");
        assert_eq!(fresh.head(), self.a.head());
        assert_eq!(fresh.dump().expect("dump"), self.a.dump().expect("dump"), "the tables are a function of the log");
        assert!(fresh.check().expect("check").is_empty());
    }

    /// The usual start: Gruppen `nord` and `sued`, with a Gebiet each (`n1`, `s1`) side by side.
    pub fn standard() -> World {
        let mut w = World::new();
        let admin = who::admin();
        for (g, x) in [("nord", 13.00), ("sued", 13.01)] {
            w.ok(&admin, super::gruppe_in(g, g));
            let gebiet = format!("{}1", &g[..1]);
            w.ok(&admin, super::austeilen(&gebiet, Some(g), super::square(x, 51.0, 0.005)));
        }
        w
    }
}
