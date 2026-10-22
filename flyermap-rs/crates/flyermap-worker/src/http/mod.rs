pub mod jsnum;
pub mod router;

pub use flyermap_host::http::{observe, request, response};

use flyermap_wire::ApiError;
use response::Response;

/// An `ApiError` as the answer to a request.
pub fn error_response(error: &ApiError) -> Response {
    Response::error(error.status(), error.code.as_str(), &error.message)
}
