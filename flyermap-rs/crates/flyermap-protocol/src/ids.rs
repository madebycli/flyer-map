//! Ids of the protocol. Opaque strings chosen by the device (offline-first); the newtypes only keep a Lauf id from being used where a note id is meant.
//! `GruppeId` and `GebietId` are the ones of `flyermap-identity`, because rights are decided on them.
macro_rules! id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn new(id: impl Into<String>) -> Self {
                $name(id.into())
            }
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

id!(
    /// A Lauf (a shared outing).
    LaufId
);
id!(
    /// A note. It is the stamp of its creation, so two devices never make the same one.
    NoteId
);
id!(
    /// The idempotency key of one command: the same command sent twice (a lost answer, a retry) has the same id and happens once.
    CommandId
);
