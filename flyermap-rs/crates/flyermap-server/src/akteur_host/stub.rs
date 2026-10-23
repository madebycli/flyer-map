//! The edge's way to the Durable Objects: one object per Aktion, addressed by the Aktion's id.
use super::convert;
use crate::akteur::{
    link::{Link, HEADER},
    Akteure, Kick,
};
use flyermap_host::http::{request::Request, response::Response};
use worker::{Headers, Method, ObjectNamespace, Request as CfRequest, RequestInit, Response as CfResponse, Stub};

pub struct DoAkteure {
    pub namespace: ObjectNamespace,
}

impl DoAkteure {
    fn stub(&self, aktion: &str) -> Result<Stub, String> {
        self.namespace.id_from_name(aktion).and_then(|id| id.get_stub()).map_err(|e| e.to_string())
    }

    /// Hand a WebSocket upgrade to the Aktion's object. Only the handshake headers of the client's request go on, and the link is the edge's own.
    pub async fn upgrade(&self, link: &Link, request: &CfRequest) -> worker::Result<CfResponse> {
        if request.headers().get("upgrade")?.as_deref() != Some("websocket") {
            return CfResponse::error("Expected a WebSocket upgrade", 426);
        }
        let headers = Headers::new();
        for name in ["upgrade", "connection", "sec-websocket-key", "sec-websocket-version"] {
            if let Some(value) = request.headers().get(name)? {
                headers.set(name, &value)?;
            }
        }
        headers.set(HEADER, &link.encode())?;
        let mut init = RequestInit::new();
        init.with_method(Method::Get).with_headers(headers);
        let internal = CfRequest::new_with_init("https://akteur.internal/live", &init)?;
        self.namespace.id_from_name(&link.aktion)?.get_stub()?.fetch_with_request(internal).await
    }
}

impl Akteure for DoAkteure {
    async fn call(&self, aktion: &str, request: Request) -> Result<Response, String> {
        let internal = convert::internal_request(&request).map_err(|e| e.to_string())?;
        let answer = self.stub(aktion)?.fetch_with_request(internal).await.map_err(|e| e.to_string())?;
        convert::answer_of(answer).await.map_err(|e| e.to_string())
    }

    async fn kick(&self, aktion: &str, kick: &Kick) -> Result<(), String> {
        let body = serde_json::to_vec(kick).map_err(|e| e.to_string())?;
        let request = Request::new("POST", "https://akteur.internal/kick").with_header("content-type", "application/json").with_body(body);
        let answer = self.call(aktion, request).await?;
        (answer.status == 200).then_some(()).ok_or_else(|| format!("the Akteur answered {}", answer.status))
    }
}
