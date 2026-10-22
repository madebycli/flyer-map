//! Ids are opaque strings; the newtypes only keep an Aktion id from being used where a Gebiet id is meant.
macro_rules! id {
    ($name:ident) => {
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

id!(OrgId);
id!(AktionId);
id!(GruppeId);
id!(GebietId);
