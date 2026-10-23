//! Why a command stopped: a reason the caller is told, or a storage failure (then nothing happened and the caller is told to try again).
use crate::sql::SqlError;
use flyermap_protocol::Reason;

#[derive(Debug)]
pub(crate) enum Fail {
    Reason(Reason),
    Sql(SqlError),
}

impl From<Reason> for Fail {
    fn from(reason: Reason) -> Fail {
        Fail::Reason(reason)
    }
}

impl From<SqlError> for Fail {
    fn from(error: SqlError) -> Fail {
        Fail::Sql(error)
    }
}

pub(crate) type R<T> = Result<T, Fail>;
