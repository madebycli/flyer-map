//! From a device to the Akteur of an Aktion. The edge does what only it can: it knows the session, so it knows who asks and what they hold; it checks that
//! the Aktion exists and that the person may enter it (a stranger gets `not_found` and wakes nothing), builds the link and forwards. What happens then
//! is the Akteur's to decide.
//!
//! Rights that end close the live connections they let in: the handlers that end a grant or a session ask for a kick here, and the app sends it once
//! the change has been made.
use super::{route::Part, Ctx};
use crate::{
    akteur::{
        link::{Link, HEADER},
        Akteure, Kick,
    },
    directory::aktionen::{self, AktionRow},
    error::{fail, Code, Done, Failure},
};
use flyermap_host::{db::Db, http::request::Request};
use flyermap_identity::{may_enter, AccessSet, AktionId, OrgId};

/// A push of commands may be this large (the protocol bounds the commands; this bounds what is read before they are looked at).
const MAX_BODY: usize = 2 * 1024 * 1024;

/// The Aktion, if the caller may enter it, with the link that says who they are in it.
pub async fn authorize<D: Db>(c: &Ctx<'_, D>, aktion: &str) -> Done<(AktionRow, Link)> {
    let me = c.me()?;
    let row = aktionen::get(c.db, aktion).await?.filter(|r| may_enter(&me.access, c.now(), &OrgId::new(&r.org_id), &AktionId::new(&r.id)));
    let Some(row) = row else { return Err(fail(Code::NotFound, "not found")) };
    let link = Link::new(&row.org_id, &row.id, &me.person.id, &me.session.id, &me.access);
    Ok((row, link))
}

fn unavailable(cause: String) -> Failure {
    Failure { code: Code::Unavailable, detail: "the Aktion does not answer".into(), cause: Some(cause) }
}

/// Everything below `/v6/aktionen/:id/` except the live channel.
pub async fn forward<D: Db, A: Akteure>(c: &Ctx<'_, D>, akteure: &A, aktion: &str, part: Part) -> Done {
    let method = c.request.method.as_str();
    if method != if part == Part::Push { "POST" } else { "GET" } {
        return Err(fail(Code::MethodNotAllowed, "method not allowed"));
    }
    let (row, link) = authorize(c, aktion).await?;
    if part == Part::Push {
        if row.archived_at.is_some() {
            return Err(fail(Code::Forbidden, "the Aktion is archived"));
        }
        if !c.request.header("content-type").unwrap_or("").contains("application/json") {
            return Err(fail(Code::UnsupportedMediaType, "JSON expected"));
        }
        if c.request.body.len() > MAX_BODY {
            return Err(fail(Code::TooLarge, "body too large"));
        }
    }
    let query = c.request.url.split_once('?').map_or(String::new(), |(_, q)| format!("?{q}"));
    let internal = Request::new(method, &format!("https://akteur.internal{}{query}", part.internal_path()))
        .with_header(HEADER, &link.encode())
        .with_body(c.request.body.clone());
    akteure.call(&row.id, internal).await.map_err(unavailable)
}

/// The link for a live connection (the app upgrades it to a WebSocket at the Akteur).
pub async fn live_link<D: Db>(c: &Ctx<'_, D>, aktion: &str) -> Done<Link> {
    authorize(c, aktion).await.map(|(_, link)| link)
}

/// Every Aktion of `org`, or just `aktion` when the grant was for one.
async fn aktionen_of<D: Db>(c: &Ctx<'_, D>, org: &str, aktion: Option<&str>) -> Done<Vec<String>> {
    Ok(match aktion {
        Some(a) => vec![a.to_string()],
        None => aktionen::of_org(c.db, org).await?.into_iter().map(|a| a.id).collect(),
    })
}

/// A grant of `person` ended in `org` (in one Aktion, or all): their devices there are dropped and come back with the rights they hold now.
pub async fn kick_grant<D: Db>(c: &Ctx<'_, D>, org: &str, aktion: Option<&str>, person: &str) -> Done<()> {
    for id in aktionen_of(c, org, aktion).await? {
        c.kick(&id, Kick::person(person));
    }
    Ok(())
}

/// A session of the person ended: its connections are dropped in every Aktion the person could be connected to (`access` is what they held).
pub async fn kick_session<D: Db>(c: &Ctx<'_, D>, access: &AccessSet, kick: &Kick) -> Done<()> {
    let mut orgs: Vec<&str> = access.grants.iter().map(|g| g.scope.org().0.as_str()).collect();
    orgs.sort_unstable();
    orgs.dedup();
    for org in orgs {
        for id in aktionen_of(c, org, None).await? {
            c.kick(&id, kick.clone());
        }
    }
    Ok(())
}
