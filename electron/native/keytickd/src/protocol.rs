//! The wire format and the per-connection state machine.
//!
//! Everything a client can learn is decided here, in pure code with no device
//! and no socket, so the privacy rules are unit-tested directly:
//!
//! * nothing is emitted before the client is authorized AND has asked to start;
//! * a key is reduced to its press/release time, one of five classes and a
//!   voice number. The key code itself never reaches a line of output;
//! * the voice number is a random draw per key, redrawn on every `start`, so
//!   two takes cannot be compared and no table maps a voice back to a key.

use std::collections::HashMap;

/// The longest command line a client may send. Commands are single words; a
/// client that sends more than this is not speaking the protocol.
pub const MAX_COMMAND_BYTES: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    /// Ask for authorization without starting a capture (the settings toggle).
    Auth,
    /// Start streaming key events; authorizes first when needed.
    Start,
    /// Stop streaming and close every keyboard.
    Stop,
}

pub fn parse_command(line: &str) -> Option<Command> {
    match line.trim() {
        "auth" => Some(Command::Auth),
        "start" => Some(Command::Start),
        "stop" => Some(Command::Stop),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyClass {
    Key,
    Space,
    Enter,
    Backspace,
    Modifier,
}

impl KeyClass {
    pub fn as_str(self) -> &'static str {
        match self {
            KeyClass::Key => "key",
            KeyClass::Space => "space",
            KeyClass::Enter => "enter",
            KeyClass::Backspace => "backspace",
            KeyClass::Modifier => "mod",
        }
    }
}

// Linux input event codes (include/uapi/linux/input-event-codes.h).
const KEY_BACKSPACE: u16 = 14;
const KEY_ENTER: u16 = 28;
const KEY_LEFTCTRL: u16 = 29;
const KEY_LEFTSHIFT: u16 = 42;
const KEY_RIGHTSHIFT: u16 = 54;
const KEY_LEFTALT: u16 = 56;
const KEY_SPACE: u16 = 57;
const KEY_KPENTER: u16 = 96;
const KEY_RIGHTCTRL: u16 = 97;
const KEY_RIGHTALT: u16 = 100;
const KEY_DELETE: u16 = 111;
const KEY_LEFTMETA: u16 = 125;
const KEY_RIGHTMETA: u16 = 126;
/// First button code (`BTN_MISC`). Everything from here up is a mouse, gamepad
/// or tablet button, or a rarely used extended key; none of it is typing.
const FIRST_NON_KEYBOARD_CODE: u16 = 0x100;

/// The class a key code sounds as, or `None` for a code that is not a keyboard
/// key at all (mouse buttons share the `EV_KEY` event type).
pub fn classify(code: u16) -> Option<KeyClass> {
    if code == 0 || code >= FIRST_NON_KEYBOARD_CODE {
        return None;
    }
    Some(match code {
        KEY_ENTER | KEY_KPENTER => KeyClass::Enter,
        KEY_SPACE => KeyClass::Space,
        KEY_BACKSPACE | KEY_DELETE => KeyClass::Backspace,
        KEY_LEFTCTRL | KEY_RIGHTCTRL | KEY_LEFTSHIFT | KEY_RIGHTSHIFT | KEY_LEFTALT
        | KEY_RIGHTALT | KEY_LEFTMETA | KEY_RIGHTMETA => KeyClass::Modifier,
        _ => KeyClass::Key,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Down,
    Up,
}

/// evdev key values: 0 release, 1 press, 2 autorepeat. A held key repeating is
/// one physical press, so autorepeat makes no sound and is dropped here.
pub fn edge(value: i32) -> Option<Edge> {
    match value {
        1 => Some(Edge::Down),
        0 => Some(Edge::Up),
        _ => None,
    }
}

/// What the service says back to a command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reply {
    Authorized,
    Denied,
    Started,
    Stopped,
    BadCommand,
}

impl Reply {
    pub fn line(self) -> &'static str {
        match self {
            Reply::Authorized => "{\"type\":\"authorized\"}\n",
            Reply::Denied => "{\"type\":\"denied\"}\n",
            Reply::Started => "{\"type\":\"started\"}\n",
            Reply::Stopped => "{\"type\":\"stopped\"}\n",
            Reply::BadCommand => "{\"type\":\"error\",\"message\":\"unknown command\"}\n",
        }
    }
}

/// One client connection. `authorize` and `random_voice` are injected so the
/// rules above are testable without polkit or a random source.
pub struct Session {
    authorized: bool,
    streaming: bool,
    /// Key code → voice, drawn lazily and thrown away on every `start`/`stop`.
    voices: HashMap<u16, u8>,
}

impl Session {
    pub fn new() -> Self {
        Session {
            authorized: false,
            streaming: false,
            voices: HashMap::new(),
        }
    }

    pub fn is_streaming(&self) -> bool {
        self.streaming
    }

    pub fn on_command(&mut self, command: Command, authorize: &mut dyn FnMut() -> bool) -> Reply {
        match command {
            Command::Auth | Command::Start => {
                if !self.authorized {
                    self.authorized = authorize();
                }
                if !self.authorized {
                    return Reply::Denied;
                }
                if command == Command::Auth {
                    return Reply::Authorized;
                }
                self.voices.clear();
                self.streaming = true;
                Reply::Started
            }
            Command::Stop => {
                self.voices.clear();
                self.streaming = false;
                Reply::Stopped
            }
        }
    }

    /// The line to send for one evdev key event, or `None` when it must not be
    /// reported: not streaming, not a keyboard key, or an autorepeat.
    pub fn on_key(
        &mut self,
        code: u16,
        value: i32,
        time_ms: u64,
        random_voice: &mut dyn FnMut() -> u8,
    ) -> Option<String> {
        if !self.streaming {
            return None;
        }
        let class = classify(code)?;
        let edge = edge(value)?;
        let voice = *self.voices.entry(code).or_insert_with(random_voice);
        Some(format!(
            "{{\"type\":\"key\",\"t\":{},\"e\":\"{}\",\"c\":\"{}\",\"v\":{}}}\n",
            time_ms,
            match edge {
                Edge::Down => "d",
                Edge::Up => "u",
            },
            class.as_str(),
            voice
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY_A: u16 = 30;
    const KEY_B: u16 = 48;
    const BTN_LEFT: u16 = 0x110;

    fn started() -> Session {
        let mut session = Session::new();
        assert_eq!(session.on_command(Command::Start, &mut || true), Reply::Started);
        session
    }

    #[test]
    fn nothing_is_reported_before_start() {
        let mut session = Session::new();
        assert_eq!(session.on_key(KEY_A, 1, 10, &mut || 7), None);
        assert_eq!(session.on_command(Command::Auth, &mut || true), Reply::Authorized);
        // Authorized is not started: the toggle being on is not a recording.
        assert_eq!(session.on_key(KEY_A, 1, 10, &mut || 7), None);
    }

    #[test]
    fn a_denied_client_never_streams() {
        let mut session = Session::new();
        assert_eq!(session.on_command(Command::Start, &mut || false), Reply::Denied);
        assert!(!session.is_streaming());
        assert_eq!(session.on_key(KEY_A, 1, 10, &mut || 7), None);
    }

    #[test]
    fn authorization_is_asked_once_per_connection() {
        let mut session = Session::new();
        let mut asked = 0;
        let mut authorize = || {
            asked += 1;
            true
        };
        session.on_command(Command::Auth, &mut authorize);
        session.on_command(Command::Start, &mut authorize);
        session.on_command(Command::Stop, &mut authorize);
        session.on_command(Command::Start, &mut authorize);
        assert_eq!(asked, 1);
    }

    #[test]
    fn nothing_is_reported_after_stop() {
        let mut session = started();
        assert_eq!(session.on_command(Command::Stop, &mut || true), Reply::Stopped);
        assert_eq!(session.on_key(KEY_A, 1, 10, &mut || 7), None);
    }

    #[test]
    fn a_press_and_its_release_are_reported_with_one_voice() {
        let mut session = started();
        let mut draws = [41u8, 99].into_iter();
        let mut voice = || draws.next().unwrap();
        assert_eq!(
            session.on_key(KEY_A, 1, 1000, &mut voice).unwrap(),
            "{\"type\":\"key\",\"t\":1000,\"e\":\"d\",\"c\":\"key\",\"v\":41}\n"
        );
        assert_eq!(
            session.on_key(KEY_A, 0, 1080, &mut voice).unwrap(),
            "{\"type\":\"key\",\"t\":1080,\"e\":\"u\",\"c\":\"key\",\"v\":41}\n"
        );
        // A different key draws its own voice.
        assert!(session.on_key(KEY_B, 1, 1100, &mut voice).unwrap().contains("\"v\":99"));
    }

    #[test]
    fn the_key_code_never_appears_in_the_output() {
        let mut session = started();
        // Voice and time are chosen so that the code (30) can only come from a leak.
        let line = session.on_key(KEY_A, 1, 7, &mut || 5).unwrap();
        assert!(!line.contains("30"), "{line}");
    }

    #[test]
    fn voices_are_redrawn_on_every_start() {
        let mut session = started();
        assert!(session.on_key(KEY_A, 1, 1, &mut || 1).unwrap().contains("\"v\":1"));
        session.on_command(Command::Stop, &mut || true);
        session.on_command(Command::Start, &mut || true);
        assert!(session.on_key(KEY_A, 1, 2, &mut || 2).unwrap().contains("\"v\":2"));
    }

    #[test]
    fn autorepeat_is_silent() {
        let mut session = started();
        assert_eq!(session.on_key(KEY_A, 2, 10, &mut || 7), None);
    }

    #[test]
    fn mouse_buttons_are_not_keys() {
        let mut session = started();
        assert_eq!(session.on_key(BTN_LEFT, 1, 10, &mut || 7), None);
        assert_eq!(classify(0), None);
    }

    #[test]
    fn classes() {
        assert_eq!(classify(KEY_ENTER), Some(KeyClass::Enter));
        assert_eq!(classify(KEY_KPENTER), Some(KeyClass::Enter));
        assert_eq!(classify(KEY_SPACE), Some(KeyClass::Space));
        assert_eq!(classify(KEY_BACKSPACE), Some(KeyClass::Backspace));
        assert_eq!(classify(KEY_DELETE), Some(KeyClass::Backspace));
        assert_eq!(classify(KEY_LEFTSHIFT), Some(KeyClass::Modifier));
        assert_eq!(classify(KEY_RIGHTMETA), Some(KeyClass::Modifier));
        assert_eq!(classify(KEY_A), Some(KeyClass::Key));
    }

    #[test]
    fn commands() {
        assert_eq!(parse_command("start\n"), Some(Command::Start));
        assert_eq!(parse_command(" stop "), Some(Command::Stop));
        assert_eq!(parse_command("auth"), Some(Command::Auth));
        assert_eq!(parse_command("dump"), None);
        assert_eq!(parse_command(""), None);
    }
}
