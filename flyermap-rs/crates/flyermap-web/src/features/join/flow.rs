//! The way in for a device without access, as a small state machine: which form is up (the invitation code, the account, the second factor), what has been typed,
//! whether a request is out, what went wrong. Pure: one reducer, native tests. The screen draws it, the app sends the requests and reports back.
use super::code::{display_code, normalize_code, CODE_LEN};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Way {
    /// With an invitation: the device is a guest, no account needed.
    #[default]
    Invitation,
    /// With an account: passkey, or name and password.
    Account,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Step {
    /// The first form of the chosen way.
    #[default]
    First,
    /// The six digits of the second factor, after a password.
    SecondFactor,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Join {
    pub way: Way,
    pub step: Step,
    /// The invitation code, in its canonical form (typed or pasted text is cleaned).
    pub code: String,
    pub name: String,
    pub password: String,
    /// Digits only, at most six.
    pub digits: String,
    pub busy: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JoinAction {
    SetWay(Way),
    /// What the field holds now (typed, or pasted: a link is read, too).
    Code(String),
    Name(String),
    Password(String),
    Digits(String),
    /// A request went out.
    Sent,
    /// The server said no, in these words.
    Refused(String),
    /// The server wants the second factor now.
    NeedsSecondFactor(String),
    /// Back from the second factor to the first form.
    Back,
}

impl Join {
    /// A code from the address of the page (a scanned QR code opens the link), already filled in.
    pub fn with_code(code: &str) -> Join {
        Join { code: normalize_code(code), ..Join::default() }
    }

    pub fn reduce(&mut self, action: JoinAction) {
        match action {
            JoinAction::SetWay(way) => {
                if way != self.way {
                    *self = Join { way, code: self.code.clone(), name: self.name.clone(), ..Join::default() };
                }
            }
            JoinAction::Code(text) => {
                let code = super::code::code_from_text(&text).unwrap_or_else(|| normalize_code(&text));
                self.code = code.chars().take(CODE_LEN).collect();
                self.error = None;
            }
            JoinAction::Name(name) => {
                self.name = name;
                self.error = None;
            }
            JoinAction::Password(password) => {
                self.password = password;
                self.error = None;
            }
            JoinAction::Digits(text) => {
                self.digits = text.chars().filter(char::is_ascii_digit).take(6).collect();
                self.error = None;
            }
            JoinAction::Sent => {
                self.busy = true;
                self.error = None;
            }
            JoinAction::Refused(message) => {
                self.busy = false;
                self.error = Some(message);
            }
            JoinAction::NeedsSecondFactor(message) => {
                self.busy = false;
                self.step = Step::SecondFactor;
                self.digits.clear();
                self.error = Some(message).filter(|m| !m.is_empty());
            }
            JoinAction::Back => {
                self.step = Step::First;
                self.digits.clear();
                self.password.clear();
                self.error = None;
            }
        }
    }

    /// Whether the main button of the form that is up may be pressed.
    pub fn can_send(&self) -> bool {
        if self.busy {
            return false;
        }
        match (self.way, self.step) {
            (Way::Invitation, _) => self.code.len() == CODE_LEN,
            (Way::Account, Step::First) => !self.name.trim().is_empty() && !self.password.is_empty(),
            (Way::Account, Step::SecondFactor) => self.digits.len() == 6,
        }
    }

    /// The code as the field shows it (`7K2QX-9M4TB`).
    pub fn shown_code(&self) -> String {
        display_code(&self.code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(actions: impl IntoIterator<Item = JoinAction>) -> Join {
        let mut j = Join::default();
        for a in actions {
            j.reduce(a);
        }
        j
    }

    #[test]
    fn a_code_is_cleaned_while_typing_and_needs_all_ten_characters() {
        let j = run([JoinAction::Code("7k2qx-9m4".into())]);
        assert_eq!((j.code.as_str(), j.can_send()), ("7K2QX9M4", false));
        assert_eq!(j.shown_code(), "7K2QX-9M4");
        let full = run([JoinAction::Code("7k2qx 9m4tb".into())]);
        assert!(full.can_send());
        assert_eq!(run([JoinAction::Code("7K2QX9M4TBXXXX".into())]).code.len(), CODE_LEN, "too long is cut");
    }

    #[test]
    fn a_pasted_link_gives_its_code() {
        let j = run([JoinAction::Code("https://example.test/beitreten/7K2QX-9M4TB".into())]);
        assert_eq!(j.code, "7K2QX9M4TB");
    }

    #[test]
    fn the_account_needs_a_name_and_a_password_then_six_digits() {
        let mut j = run([JoinAction::SetWay(Way::Account), JoinAction::Name("anna".into())]);
        assert!(!j.can_send());
        j.reduce(JoinAction::Password("x".into()));
        assert!(j.can_send());
        j.reduce(JoinAction::Sent);
        assert!(!j.can_send(), "while the request is out");
        j.reduce(JoinAction::NeedsSecondFactor("Bitte den Code aus der App.".into()));
        assert_eq!((j.step, j.busy, j.error.as_deref()), (Step::SecondFactor, false, Some("Bitte den Code aus der App.")));
        assert!(!j.can_send());
        j.reduce(JoinAction::Digits("12a3 456789".into()));
        assert_eq!(j.digits, "123456", "digits only, six at most");
        assert!(j.can_send());
        j.reduce(JoinAction::Back);
        assert_eq!((j.step, j.password.as_str(), j.digits.as_str()), (Step::First, "", ""));
    }

    #[test]
    fn a_refusal_stays_until_the_person_changes_something() {
        let mut j = run([JoinAction::Code("7K2QX9M4TB".into()), JoinAction::Sent, JoinAction::Refused("Diese Einladung ist abgelaufen.".into())]);
        assert_eq!((j.busy, j.error.as_deref()), (false, Some("Diese Einladung ist abgelaufen.")));
        assert!(j.can_send(), "and it can be tried again");
        j.reduce(JoinAction::Code("7K2QX9M4TC".into()));
        assert_eq!(j.error, None);
    }

    #[test]
    fn switching_the_way_keeps_the_code_and_the_name_but_not_the_secrets() {
        let mut j = run([
            JoinAction::Code("7K2QX9M4TB".into()),
            JoinAction::SetWay(Way::Account),
            JoinAction::Name("anna".into()),
            JoinAction::Password("geheim".into()),
        ]);
        j.reduce(JoinAction::SetWay(Way::Invitation));
        assert_eq!((j.code.as_str(), j.name.as_str(), j.password.as_str()), ("7K2QX9M4TB", "anna", ""));
    }

    #[test]
    fn a_code_from_the_address_is_filled_in() {
        assert_eq!(Join::with_code("7k2qx-9m4tb").code, "7K2QX9M4TB");
    }
}
