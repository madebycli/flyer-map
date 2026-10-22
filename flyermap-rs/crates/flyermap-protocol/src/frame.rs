//! The live channel (WebSocket, one per Aktion). Every frame says which version of the protocol it speaks; a frame of another version is answered with
//! [`ServerMsg::Error`] and the channel closes.
use crate::{answer::Answer, change::Entry, command::Command, ids::LaufId};
use serde::{Deserialize, Serialize};

/// The protocol version in every frame.
pub const VERSION: u16 = 6;

/// Who the server takes the device for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct You {
    /// The opaque label under which the device's edits are logged (`by` of the entries).
    pub principal: String,
}

/// One person (device) online, and the Lauf it is in, if any.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Online {
    pub principal: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lauf: Option<LaufId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Presence {
    pub online: Vec<Online>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum ClientMsg {
    /// An edit. The answer comes as [`ServerMsg::Answer`].
    Command {
        command: Command,
    },
    /// Start (or restart) the live feed after position `since` (none: from now on).
    Subscribe {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        since: Option<u64>,
    },
    Ping {
        n: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClientFrame {
    pub v: u16,
    pub msg: ClientMsg,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum ServerMsg {
    /// The first frame after connecting.
    Hello {
        head: u64,
        floor: u64,
        server_now: u64,
        you: You,
    },
    /// New entries the device may see, oldest first (`head` is where the log stands).
    Entries {
        entries: Vec<Entry>,
        head: u64,
    },
    /// The device is too far behind: take a snapshot.
    Resync {
        head: u64,
        floor: u64,
    },
    Answer {
        answer: Answer,
        head: u64,
    },
    Presence {
        presence: Presence,
    },
    Pong {
        n: u64,
    },
    /// The channel cannot go on.
    Error {
        code: ProtocolError,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolError {
    /// The frame is of another version.
    Version,
    /// The frame is not a frame.
    Malformed,
    /// The caller has no access to this Aktion (any more).
    Forbidden,
    /// Too many frames too fast.
    Slow,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ServerFrame {
    pub v: u16,
    pub msg: ServerMsg,
}

impl ClientFrame {
    pub fn new(msg: ClientMsg) -> ClientFrame {
        ClientFrame { v: VERSION, msg }
    }
    pub fn is_supported(&self) -> bool {
        self.v == VERSION
    }
}

impl ServerFrame {
    pub fn new(msg: ServerMsg) -> ServerFrame {
        ServerFrame { v: VERSION, msg }
    }
    pub fn is_supported(&self) -> bool {
        self.v == VERSION
    }
}
