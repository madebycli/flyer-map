//! The Akteur of one Aktion: the one writer of its state. `handle` takes a command from a caller and either does it, completely, or does nothing; whatever it
//! does is a run of numbered entries in the log. The Akteur holds no rights of its own: it asks `decide` (see `rights`), and does no I/O but through [`Sql`].
use crate::{
    audience::Audience,
    caller::Caller,
    cmd::{self, Done},
    config::Limits,
    fail::Fail,
    out::Out,
    queries::{self, areas, done, log, meta},
    rights::Ctx,
    schema,
    sql::{Sql, SqlError},
    validate,
};
use flyermap_core::clock::{decode_clock, encode_clock, ClockState};
use flyermap_diag::{count, diag, gauge, span, Level};
use flyermap_identity::{AktionId, OrgId};
use flyermap_protocol::{Answer, Command, Entry, Reason, Verdict, Why};
use sha2::{Digest, Sha256};

/// The node name of the Akteur's own clock.
const NODE: &str = "srv";
/// The answers kept for retries are swept at most this often.
const SWEEP_EVERY_MS: u64 = 60 * 60 * 1000;

#[derive(Debug, thiserror::Error)]
pub enum OpenError {
    #[error("{0}")]
    Storage(#[from] SqlError),
    /// The storage holds another Aktion (or another Organisation).
    #[error("this storage belongs to another Aktion")]
    Foreign,
    /// The storage was made by another version of the layout.
    #[error("this storage has another layout version")]
    Version,
}

/// What `handle` returns.
#[derive(Clone, Debug)]
pub struct Handled {
    /// The answer for the one who sent the command.
    pub reply: Answer,
    /// The head of the log after the command.
    pub head: u64,
    /// The new entries, for every device that is connected: show each one only what [`Audience::sees`] lets it see.
    pub broadcast: Vec<Entry>,
    pub audience: Audience,
    /// The command had been done before (same caller, same command id): the answer is the earlier one and nothing changed.
    pub replayed: bool,
}

pub struct Aktion<S: Sql> {
    pub(crate) sql: S,
    pub(crate) org: OrgId,
    pub(crate) aktion: AktionId,
    pub(crate) limits: Limits,
    pub(crate) head: u64,
    pub(crate) floor: u64,
    pub(crate) clock: ClockState,
    last_sweep: u64,
}

struct Processed {
    verdict: Verdict,
    entries: Vec<Entry>,
    audience: Audience,
    head: u64,
    clock: Option<ClockState>,
    replayed: bool,
}

/// The command as a fixed-size fingerprint, to tell a retry from a different command under the same id.
fn fingerprint(cmd: &Command) -> String {
    let digest = Sha256::digest(serde_json::to_vec(&cmd.body).unwrap_or_default());
    digest.iter().take(16).fold(String::with_capacity(32), |mut s, b| {
        s.push_str(&format!("{b:02x}"));
        s
    })
}

impl<S: Sql> Aktion<S> {
    /// Take over a storage: make the tables if it is new, otherwise check that it is this Aktion's and of this layout.
    pub fn open(mut sql: S, org: OrgId, aktion: AktionId, limits: Limits) -> Result<Aktion<S>, OpenError> {
        let (head, floor, clock) = sql.atomically::<_, OpenError>(|sql| {
            schema::install(sql)?;
            let fresh = ClockState { wall: 0, counter: 0, node: NODE.to_string() };
            match meta::get(sql, meta::SCHEMA)? {
                None => {
                    meta::set(sql, meta::SCHEMA, &schema::VERSION.to_string())?;
                    meta::set(sql, meta::ORG, org.as_str())?;
                    meta::set(sql, meta::AKTION, aktion.as_str())?;
                    meta::set(sql, meta::CLOCK, encode_clock(&fresh).as_str())?;
                    meta::set(sql, meta::FLOOR, "0")?;
                }
                Some(version) if version != schema::VERSION.to_string() => return Err(OpenError::Version),
                Some(_) => {
                    if meta::get(sql, meta::ORG)?.as_deref() != Some(org.as_str()) || meta::get(sql, meta::AKTION)?.as_deref() != Some(aktion.as_str()) {
                        return Err(OpenError::Foreign);
                    }
                }
            }
            let floor = meta::get(sql, meta::FLOOR)?.and_then(|v| v.parse().ok()).unwrap_or(0);
            let clock = meta::get(sql, meta::CLOCK)?.and_then(|v| decode_clock(&v)).unwrap_or(fresh);
            Ok((log::head(sql)?, floor, clock))
        })?;
        Ok(Aktion { sql, org, aktion, limits, head, floor, clock, last_sweep: 0 })
    }

    /// The position of the newest entry (0: none yet).
    pub fn head(&self) -> u64 {
        self.head
    }

    /// Entries up to and including this position have been compacted away.
    pub fn floor(&self) -> u64 {
        self.floor
    }

    pub fn org(&self) -> &OrgId {
        &self.org
    }

    pub fn aktion(&self) -> &AktionId {
        &self.aktion
    }

    /// Forget the oldest entries of the log, keeping the newest `Limits::log_keep` (never fewer than one). A device behind the new floor takes a snapshot
    /// instead of reading the log. The tables are not touched: they hold the state, the log only holds how it came to be. Returns the floor.
    pub fn compact(&mut self) -> Result<u64, SqlError> {
        let floor = self.head.saturating_sub(self.limits.log_keep.max(1));
        if floor <= self.floor {
            return Ok(self.floor);
        }
        self.sql.atomically::<_, SqlError>(|sql| {
            log::delete_through(sql, floor)?;
            meta::set(sql, meta::FLOOR, &floor.to_string())
        })?;
        self.floor = floor;
        count("aktion.compacted", 1);
        gauge("aktion.floor", floor as f64);
        Ok(floor)
    }

    /// The storage, for the host to measure or to break on purpose in a test. Writing to it by hand voids everything the Akteur promises.
    pub fn storage_mut(&mut self) -> &mut S {
        &mut self.sql
    }

    /// Give the storage back (the host closes it, or measures it).
    pub fn into_sql(self) -> S {
        self.sql
    }

    /// Do one command for `caller` at server time `now` (ms), or refuse it. All or nothing: a refused command, or one the storage failed on, changed nothing.
    /// The same command (same caller, same id) a second time is not done again; the first answer comes back.
    pub fn handle(&mut self, caller: &Caller, cmd: Command, now: u64) -> Handled {
        let kind = cmd.body.kind();
        let timer = span(&format!("aktion.cmd.{kind}"));
        let handled = match self.process(caller, &cmd, now) {
            Ok(p) => Handled {
                reply: Answer { cid: cmd.cid.clone(), verdict: p.verdict },
                head: p.head,
                broadcast: p.entries,
                audience: p.audience,
                replayed: p.replayed,
            },
            Err(fail) => {
                let reason = match fail {
                    Fail::Reason(reason) => reason,
                    Fail::Sql(error) => {
                        diag!(Level::Error, "aktion", code "aktion.storage", "storage failed", kind = kind, error = error.0);
                        Reason::Storage
                    }
                };
                let audience = Audience::new(&self.org, &self.aktion, Vec::new());
                Handled {
                    reply: Answer { cid: cmd.cid.clone(), verdict: Verdict::rejected(reason) },
                    head: self.head,
                    broadcast: Vec::new(),
                    audience,
                    replayed: false,
                }
            }
        };
        record(kind, &handled);
        gauge("aktion.head", self.head as f64);
        timer.end();
        handled
    }

    fn process(&mut self, caller: &Caller, cmd: &Command, now: u64) -> Result<Processed, Fail> {
        if !caller.is_valid() {
            return Err(Reason::Forbidden { why: Why::NoGrant }.into());
        }
        validate::id(cmd.cid.as_str())?;
        let Aktion { sql, org, aktion, limits, head, clock, last_sweep, .. } = self;
        let cx = Ctx { org, aktion, caller, now, limits };
        cx.enter()?;
        let (fingerprint, sweep) = (fingerprint(cmd), now.saturating_sub(*last_sweep) >= SWEEP_EVERY_MS);
        let outcome = sql.atomically::<_, Fail>(|sql| {
            if let Some(prior) = done::get(sql, &caller.principal, cmd.cid.as_str())? {
                if prior.fingerprint != fingerprint {
                    return Err(Reason::CidReused.into());
                }
                let verdict: Verdict = queries::unjson(&prior.answer)?;
                return Ok(Processed {
                    verdict,
                    entries: Vec::new(),
                    audience: Audience::new(org, aktion, Vec::new()),
                    head: *head,
                    clock: None,
                    replayed: true,
                });
            }
            if sweep {
                done::prune(sql, now.saturating_sub(limits.done_ttl_ms))?;
            }
            let mut out = Out::new(*head, clock.clone(), now, &caller.principal);
            let Done { applied, stale, refused, orphans } = cmd::dispatch(sql, &cx, &mut out, &cmd.body)?;
            let verdict = Verdict::Accepted { applied, stale, refused, orphans };
            done::put(sql, &caller.principal, cmd.cid.as_str(), &fingerprint, &queries::json(&verdict), now)?;
            if out.clock_used {
                meta::set(sql, meta::CLOCK, encode_clock(&out.clock).as_str())?;
            }
            let mut ids: Vec<_> = out.entries.iter().filter_map(|e| e.change.gebiet().cloned()).collect();
            ids.sort();
            ids.dedup();
            let audience = Audience::new(org, aktion, areas::facts(sql, &ids)?);
            Ok(Processed { verdict, head: out.head(), clock: out.clock_used.then(|| out.clock.clone()), entries: out.entries, audience, replayed: false })
        });
        let done = outcome?;
        *head = done.head;
        if let Some(next) = &done.clock {
            *clock = next.clone();
        }
        if sweep {
            *last_sweep = now;
        }
        Ok(done)
    }
}

/// Counters per kind of command and per reason; no data.
fn record(kind: &str, handled: &Handled) {
    count("aktion.cmd", 1);
    count(&format!("aktion.cmd.{kind}"), 1);
    match &handled.reply.verdict {
        Verdict::Accepted { applied, refused, .. } => {
            count("aktion.accepted", 1);
            count("aktion.applied", u64::from(*applied));
            count("aktion.entries", handled.broadcast.len() as u64);
            if !refused.is_empty() {
                count("aktion.items_refused", refused.len() as u64);
            }
        }
        Verdict::Rejected { reason } => {
            count("aktion.rejected", 1);
            count(&format!("aktion.rejected.{}", reason.code()), 1);
        }
    }
    if handled.replayed {
        count("aktion.replayed", 1);
    }
}
