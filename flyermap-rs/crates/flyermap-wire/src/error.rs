//! Every error the API can answer, with its HTTP status, a stable code and a German sentence. The code is for machines and for support, the sentence is
//! for the person; the client shows the sentence and logs the code.
use serde::{Deserialize, Serialize};

macro_rules! codes {
    ($($variant:ident => ($text:literal, $status:literal, $message:literal)),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum ErrorCode { $($variant),+ }

        impl ErrorCode {
            pub const ALL: &'static [ErrorCode] = &[$(ErrorCode::$variant),+];
            /// The stable code on the wire.
            pub fn as_str(self) -> &'static str { match self { $(ErrorCode::$variant => $text),+ } }
            pub fn status(self) -> u16 { match self { $(ErrorCode::$variant => $status),+ } }
            /// The sentence shown when the handler has nothing more specific to say.
            pub fn message(self) -> &'static str { match self { $(ErrorCode::$variant => $message),+ } }
            pub fn parse(text: &str) -> Option<ErrorCode> { match text { $($text => Some(ErrorCode::$variant),)+ _ => None } }
        }
    };
}

codes! {
    InvalidJson => ("invalid_json", 400, "Ungültiges JSON."),
    InvalidOps => ("invalid_ops", 400, "Ungültige Änderungen."),
    InvalidNotes => ("invalid_notes", 400, "Ungültige Notizen."),
    InvalidWindow => ("invalid_window", 400, "Datum ungültig."),
    InvalidUnits => ("invalid_units", 400, "Einheit ungültig."),
    InvalidKeys => ("invalid_keys", 400, "1 bis 5000 gültige Schlüssel erwartet."),
    HeadcountRequired => ("headcount_required", 400, "Bitte die Anzahl der Personen angeben (1 bis 1000)."),
    InvalidMode => ("invalid_mode", 400, "Beitrittsart ungültig."),
    PasswordRequired => ("password_required", 400, "Das Passwort braucht 4 bis 64 Zeichen."),
    InvalidTotal => ("invalid_total", 400, "Häuserzahl ungültig."),
    NothingToChange => ("nothing_to_change", 400, "Nichts zu ändern."),
    WrongPassword => ("wrong_password", 403, "Das Passwort stimmt nicht."),
    TeamOnly => ("team_only", 403, "In diesen Raum kommen nur Mitglieder der Gruppe."),
    TeamMissing => ("team_missing", 409, "Die Gruppe des Gebiets gibt es nicht mehr."),
    AreaStillExists => ("area_still_exists", 409, "Das Gebiet existiert noch. Erst löschen, dann aufräumen."),
    PruneConfirmRequired => ("prune_confirm_required", 409, "Das würde viele Markierungen dieses Gebiets entfernen. Bitte bestätigen."),
    AlreadySignedIn => ("already_signed_in", 409, "Du bist als Admin angemeldet und siehst den Raum ohnehin."),
    AlreadyMember => ("already_member", 409, "Du gehörst zu dieser Gruppe und bist schon drin."),
    Unauthorized => ("unauthorized", 401, "Kein Zugriff auf diese Aktion."),
    Forbidden => ("forbidden", 403, "Das darfst du nicht."),
    ReadOnly => ("read_only", 403, "Diese Rolle darf nichts markieren."),
    CrossOrigin => ("cross_origin", 403, "Anfrage von fremdem Ursprung."),
    AreaForbidden => ("area_forbidden", 403, "In diesem Gebiet darfst du das nicht."),
    NotFound => ("not_found", 404, "Nicht gefunden."),
    NoPack => ("no_pack", 404, "Für dieses Gebiet wurde noch kein Kartenpaket erzeugt."),
    MethodNotAllowed => ("method_not_allowed", 405, "Methode nicht erlaubt."),
    RoomFinished => ("room_finished", 409, "Der Raum ist beendet."),
    RoomActive => ("room_active", 409, "In diesem Gebiet läuft schon ein Raum."),
    TooLarge => ("too_large", 413, "Anfrage zu groß."),
    UnsupportedMediaType => ("unsupported_media_type", 415, "JSON erwartet."),
    PackEmpty => ("pack_empty", 422, "Im Gebiet wurden keine Straßen oder Gebäude gefunden."),
    PackRecent => ("pack_recent", 429, "Für dieses Gebiet läuft gerade ein Abruf oder lief eben erst einer. Bitte eine Minute warten."),
    RoomFull => ("room_full", 429, "In diesem Raum sind zu viele Gäste."),
    RoomLocked => ("room_locked", 429, "Zu viele Versuche. Bitte in ein paar Minuten noch einmal."),
    WriteFailed => ("write_failed", 500, "Änderungen konnten nicht gespeichert werden."),
    PackCorrupt => ("pack_corrupt", 500, "Kartenpaket beschädigt."),
    Internal => ("internal", 500, "Interner Fehler. Bitte später noch einmal versuchen."),
    NotImplemented => ("not_implemented", 501, "Diese Funktion ist im neuen Server noch nicht da."),
    OverpassIncomplete => ("overpass_incomplete", 502, "Die Kartendatenquelle war überlastet und lieferte nur einen Teil. Bitte später noch einmal versuchen."),
}

/// `{"error":{"code":"…","message":"…"}}`
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
}

/// An error a handler returns: a code plus the sentence (the default one of the code unless the handler knows better).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
}

impl ApiError {
    pub fn new(code: ErrorCode) -> ApiError {
        ApiError { code, message: code.message().to_string() }
    }
    pub fn with(code: ErrorCode, message: &str) -> ApiError {
        ApiError { code, message: message.to_string() }
    }
    pub fn status(&self) -> u16 {
        self.code.status()
    }
    pub fn envelope(&self) -> ErrorEnvelope {
        ErrorEnvelope { error: ErrorBody { code: self.code.as_str().to_string(), message: self.message.clone() } }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_code_round_trips_and_has_a_sane_status_and_sentence() {
        for code in ErrorCode::ALL {
            assert_eq!(ErrorCode::parse(code.as_str()), Some(*code));
            assert!((400..600).contains(&code.status()), "{}", code.as_str());
            assert!(code.message().ends_with('.'), "{}", code.as_str());
        }
        assert_eq!(ErrorCode::parse("nope"), None);
    }

    #[test]
    fn the_body_has_the_shape_the_app_reads() {
        let json = serde_json::to_value(ApiError::with(ErrorCode::Forbidden, "Nur Admins.").envelope()).unwrap();
        assert_eq!(json, serde_json::json!({"error": {"code": "forbidden", "message": "Nur Admins."}}));
        assert_eq!(ApiError::new(ErrorCode::NotFound).status(), 404);
    }
}
