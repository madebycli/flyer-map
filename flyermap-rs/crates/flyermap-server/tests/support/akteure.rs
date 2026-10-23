//! The Akteure of a test server: one Akteur per Aktion over in-memory SQLite, and the live channel of the Durable Object (`Channel`) with an inbox per
//! connection instead of a socket. Everything between the two is the production code; only the carrying out of [`Out`] is the test's own.
use flyermap_aktion::{Aktion, Limits, RusqliteSql};
use flyermap_host::http::{request::Request, response::Response};
use flyermap_identity::{AktionId, OrgId};
use flyermap_protocol::{ClientFrame, ClientMsg, ServerFrame};
use flyermap_server::akteur::{
    channel::{Channel, Out},
    link::{Link, HEADER},
    serve::serve,
    Akteure, Kick,
};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};

struct One {
    actor: Aktion<RusqliteSql>,
    channel: Channel,
}

pub struct LocalAkteure {
    clock: Rc<Cell<u64>>,
    actors: RefCell<HashMap<String, One>>,
    inbox: RefCell<HashMap<String, Vec<ServerFrame>>>,
    closed: RefCell<Vec<String>>,
    next: Cell<u64>,
    down: Cell<bool>,
}

impl LocalAkteure {
    pub fn new(clock: Rc<Cell<u64>>) -> LocalAkteure {
        LocalAkteure { clock, actors: RefCell::default(), inbox: RefCell::default(), closed: RefCell::default(), next: Cell::new(1), down: Cell::new(false) }
    }

    /// The Akteur stops answering (and being kicked).
    pub fn set_down(&self, down: bool) {
        self.down.set(down);
    }

    fn now(&self) -> u64 {
        self.clock.get()
    }

    /// How many Akteure were ever started: a stranger's request must not start one.
    pub fn woken(&self) -> usize {
        self.actors.borrow().len()
    }

    fn with_one<T>(&self, link: &Link, f: impl FnOnce(&mut One) -> T) -> T {
        let mut actors = self.actors.borrow_mut();
        let one = actors.entry(link.aktion.clone()).or_insert_with(|| One {
            actor: Aktion::open(RusqliteSql::memory().unwrap(), OrgId::new(&link.org), AktionId::new(&link.aktion), Limits::default()).unwrap(),
            channel: Channel::default(),
        });
        f(one)
    }

    fn carry_out(&self, outs: Vec<Out>) {
        for out in outs {
            match out {
                Out::Send(id, frame) => self.inbox.borrow_mut().entry(id).or_default().push(frame),
                Out::Close(id) => self.closed.borrow_mut().push(id),
                Out::Store(_) => {}
            }
        }
    }

    /// A device connects with the link the edge made for it; returns the connection's id.
    pub fn connect(&self, link: Link) -> String {
        let id = format!("conn-{}", self.next.replace(self.next.get() + 1));
        let now = self.now();
        let outs = self.with_one(&link.clone(), |one| one.channel.open(&one.actor, &id, link, now));
        self.carry_out(outs);
        id
    }

    pub fn send(&self, aktion: &str, conn: &str, msg: ClientMsg) {
        self.send_raw(aktion, conn, &serde_json::to_string(&ClientFrame::new(msg)).unwrap());
    }

    pub fn send_raw(&self, aktion: &str, conn: &str, text: &str) {
        let now = self.now();
        let outs = {
            let mut actors = self.actors.borrow_mut();
            let one = actors.get_mut(aktion).expect("an Akteur that was started");
            one.channel.frame(&mut one.actor, conn, text, now)
        };
        self.carry_out(outs);
    }

    /// The device goes (the socket closes).
    pub fn disconnect(&self, aktion: &str, conn: &str) {
        let outs = self.actors.borrow_mut().get_mut(aktion).expect("an Akteur").channel.closed(conn);
        self.carry_out(outs);
    }

    /// The alarm of the Durable Object.
    pub fn sweep(&self, aktion: &str) {
        let now = self.now();
        let outs = self.actors.borrow_mut().get_mut(aktion).expect("an Akteur").channel.sweep(now);
        self.carry_out(outs);
    }

    /// What the connection was sent since the last call.
    pub fn take(&self, conn: &str) -> Vec<ServerFrame> {
        self.inbox.borrow_mut().remove(conn).unwrap_or_default()
    }

    pub fn is_open(&self, conn: &str) -> bool {
        !self.closed.borrow().iter().any(|c| c == conn)
    }
}

impl Akteure for LocalAkteure {
    async fn call(&self, aktion: &str, request: Request) -> Result<Response, String> {
        if self.down.get() {
            return Err("down for the test".into());
        }
        let link = request.header(HEADER).and_then(|h| Link::decode(h, aktion)).ok_or("the request has no link for this Aktion")?;
        let now = self.now();
        let (response, outs) = self.with_one(&link, |one| {
            let served = serve(&mut one.actor, &link, now, &request);
            (served.response, one.channel.pushed(&served.handled, now))
        });
        self.carry_out(outs);
        Ok(response)
    }

    async fn kick(&self, aktion: &str, kick: &Kick) -> Result<(), String> {
        if self.down.get() {
            return Err("down for the test".into());
        }
        let outs = self.actors.borrow_mut().get_mut(aktion).map(|one| one.channel.kick(kick)).unwrap_or_default();
        self.carry_out(outs);
        Ok(())
    }
}
