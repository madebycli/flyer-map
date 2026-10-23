//! The platform's requests and responses to ours and back. Nothing here decides anything.
use flyermap_host::http::{request::Request, response::Response};
use worker::{Headers, Method, Request as CfRequest, RequestInit, Response as CfResponse, Result};

pub async fn request_of(req: &mut CfRequest) -> Result<Request> {
    let headers = req.headers().entries().map(|(k, v)| (k.to_ascii_lowercase(), v)).collect();
    let body = if matches!(req.method(), Method::Get | Method::Head) { Vec::new() } else { req.bytes().await.unwrap_or_default() };
    Ok(Request { method: req.method().to_string(), url: req.url()?.to_string(), headers, body })
}

pub fn response_of(response: Response) -> Result<CfResponse> {
    let headers = Headers::new();
    for (name, value) in &response.headers {
        headers.append(name, value)?;
    }
    Ok(CfResponse::from_bytes(response.body)?.with_status(response.status).with_headers(headers))
}

/// An internal request for a Durable Object (`https://akteur.internal/…`): only what the Akteur is meant to see.
pub fn internal_request(request: &Request) -> Result<CfRequest> {
    let headers = Headers::new();
    for (name, value) in &request.headers {
        headers.append(name, value)?;
    }
    let mut init = RequestInit::new();
    init.with_method(Method::from(request.method.clone())).with_headers(headers);
    if !request.body.is_empty() {
        init.with_body(Some(js_sys::Uint8Array::from(request.body.as_slice()).into()));
    }
    CfRequest::new_with_init(&request.url, &init)
}

pub async fn answer_of(mut response: CfResponse) -> Result<Response> {
    let headers = response.headers().entries().map(|(k, v)| (k.to_ascii_lowercase(), v)).collect();
    Ok(Response { status: response.status_code(), headers, body: response.bytes().await? })
}
