//! The lists that live on the server and change while the app is open: who is out (Läufe, for the live strip), and for those who manage people the people
//! and the access (invitations, signed-in devices). A list is asked for again and put into the world only when it differs, so a poll that brings no news
//! changes nothing on screen. A connection that does not serve a list is remembered (the Studio then says so instead of showing an empty list as if it were true).
use super::core::Session;
use crate::backend::BackendError;
use leptos::{prelude::*, task::spawn_local};

impl Session {
    /// Ask who is out now.
    pub fn refresh_laeufe(&self) {
        let me = *self;
        spawn_local(async move {
            if let Ok(list) = me.backend().laeufe().await {
                if me.world.with_untracked(|w| w.laeufe != list) {
                    me.world.update(|w| w.laeufe = list);
                }
            }
        });
    }

    /// Ask for the people and the access (only for those who manage people; the server judges again).
    pub fn refresh_people(&self) {
        let me = *self;
        spawn_local(async move {
            let people = me.backend().personen().await;
            let access = me.backend().zugaenge().await;
            let mut missing: Vec<String> = Vec::new();
            match people {
                Ok(list) => {
                    if me.world.with_untracked(|w| w.personen != list) {
                        me.world.update(|w| w.personen = list);
                    }
                }
                Err(BackendError::Unsupported(what)) => missing.push(what.to_string()),
                Err(_) => {}
            }
            match access {
                Ok(list) => {
                    if me.world.with_untracked(|w| w.zugaenge != list) {
                        me.world.update(|w| w.zugaenge = list);
                    }
                }
                Err(BackendError::Unsupported(what)) => missing.push(what.to_string()),
                Err(_) => {}
            }
            if me.missing.with_untracked(|m| *m != missing) {
                me.missing.set(missing);
            }
        });
    }
}
