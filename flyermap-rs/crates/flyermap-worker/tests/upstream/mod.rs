//! The map data source during a replay: it answers from the recorded list, in order, and only when the Rust Worker sends the very query the
//! TypeScript Worker sent (anything else is a difference, reported at the end).
use flyermap_worker::upstream::{Failure, Fetch, Incoming, Outgoing};
use serde_json::Value;
use std::{cell::RefCell, collections::VecDeque, rc::Rc};

pub struct Replay {
    pub fetch: Fetch,
    pub problems: Rc<RefCell<Vec<String>>>,
    pub left: Rc<RefCell<VecDeque<Value>>>,
}

/// `decodeURIComponent` of the form body `data=…`.
fn query_of(body: &str) -> String {
    let encoded = body.strip_prefix("data=").unwrap_or(body);
    percent_encoding::percent_decode_str(encoded).decode_utf8_lossy().into_owned()
}

pub fn replay(recorded: &Value, url: &str) -> Replay {
    let left: Rc<RefCell<VecDeque<Value>>> = Rc::new(RefCell::new(recorded.as_array().cloned().unwrap_or_default().into()));
    let problems = Rc::new(RefCell::new(Vec::new()));
    let (queue, report, url) = (left.clone(), problems.clone(), url.to_string());
    let fetch: Fetch = Box::new(move |out: Outgoing| {
        let query = query_of(&out.body);
        let next = queue.borrow_mut().pop_front();
        let answer = match next {
            _ if out.url != url => {
                report.borrow_mut().push(format!("upstream: asked {} instead of {url}", out.url));
                Err(Failure::Unreachable)
            }
            Some(entry) if entry["query"].as_str() == Some(query.as_str()) => match entry["status"].as_u64() {
                Some(0) | None => Err(Failure::Unreachable),
                Some(status) => Ok(Incoming { status: status as u16, body: entry["body"].as_str().unwrap_or_default().to_string() }),
            },
            Some(entry) => {
                report.borrow_mut().push(format!("upstream: query differs\n  rust {query}\n  ts   {}", entry["query"]));
                Err(Failure::Unreachable)
            }
            None => {
                report.borrow_mut().push(format!("upstream: an extra request {query}"));
                Err(Failure::Unreachable)
            }
        };
        Box::pin(async move { answer })
    });
    Replay { fetch, problems, left }
}
