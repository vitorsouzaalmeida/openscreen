//! `openscreen-keytickd` — key press timing for OpenScreen recordings.
//!
//! WHAT IT IS. A system service that reads the keyboards and tells one
//! authorized client WHEN a key went down or up, which of five classes it
//! belongs to, and a scrambled per-key voice number — never which key. OpenScreen
//! turns that into typing sounds. See `protocol.rs` for the exact rules and
//! `auth.rs` for who may connect.
//!
//! WHY A SERVICE. On Wayland the only source of global key events is evdev, and
//! giving a user's own processes access to it lets every one of them log
//! keystrokes. Here the access belongs to a dedicated account that nothing else
//! runs as, behind a polkit prompt only the person at the screen can answer.
//!
//! LIFETIME. systemd starts it when a client connects to its socket and it
//! exits once the last client has been gone for a while. Keyboards are open
//! only between a client's `start` and `stop`.

mod auth;
mod devices;
mod protocol;

use std::env;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::net::{UnixListener, UnixStream};
use std::process;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use devices::Keyboards;
use protocol::{parse_command, Reply, Session, MAX_COMMAND_BYTES};

/// Clients served at once. OpenScreen needs one; the rest is headroom so a
/// stray connection cannot lock it out.
const MAX_CLIENTS: usize = 8;
/// A client that has not been authorized within this long is dropped.
const UNAUTHORIZED_TIMEOUT_MS: i32 = 120_000;
/// How often an active capture looks for newly plugged keyboards.
const RESCAN_INTERVAL_MS: i32 = 3_000;
/// With no client connected for this long, the service exits.
const IDLE_EXIT_MS: i32 = 30_000;
/// The first descriptor systemd passes to a socket-activated service.
const SD_LISTEN_FDS_START: RawFd = 3;

static CLIENTS: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Authorizer {
    Polkit,
    /// Development only, and only reachable when NOT started by systemd: a copy
    /// run by hand has the keyboard access of whoever runs it, no more.
    Skip,
}

fn main() {
    let (listener, authorizer, activated) = match listener() {
        Ok(found) => found,
        Err(message) => {
            eprintln!("openscreen-keytickd: {message}");
            process::exit(2);
        }
    };

    loop {
        let mut poll = libc::pollfd {
            fd: listener.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: one valid pollfd.
        let ready = unsafe { libc::poll(&mut poll, 1, IDLE_EXIT_MS) };
        if ready == 0 {
            if activated && CLIENTS.load(Ordering::SeqCst) == 0 {
                return;
            }
            continue;
        }
        if ready < 0 {
            continue; // EINTR
        }
        let Ok((stream, _)) = listener.accept() else {
            continue;
        };
        if CLIENTS.fetch_add(1, Ordering::SeqCst) >= MAX_CLIENTS {
            CLIENTS.fetch_sub(1, Ordering::SeqCst);
            continue; // dropping the stream closes it
        }
        thread::spawn(move || {
            serve(stream, authorizer);
            CLIENTS.fetch_sub(1, Ordering::SeqCst);
        });
    }
}

/// The listening socket: the one systemd passed, or — for development — one
/// bound at the path given as `--socket <path>`.
fn listener() -> Result<(UnixListener, Authorizer, bool), String> {
    let activated = env::var("LISTEN_PID").ok().and_then(|pid| pid.parse::<u32>().ok())
        == Some(process::id())
        && env::var("LISTEN_FDS").ok().as_deref() == Some("1");
    if activated {
        // SAFETY: systemd guarantees descriptor 3 is our listening socket.
        let listener = unsafe { UnixListener::from_raw_fd(SD_LISTEN_FDS_START) };
        return Ok((listener, Authorizer::Polkit, true));
    }

    let mut args = env::args().skip(1);
    match (args.next().as_deref(), args.next()) {
        (Some("--socket"), Some(path)) => {
            let _ = fs::remove_file(&path);
            let listener = UnixListener::bind(&path).map_err(|err| format!("bind {path}: {err}"))?;
            let authorizer = if env::var_os("OPENSCREEN_KEYTICK_SKIP_AUTH").is_some() {
                Authorizer::Skip
            } else {
                Authorizer::Polkit
            };
            Ok((listener, authorizer, false))
        }
        _ => Err("not socket-activated; run under systemd or pass --socket <path>".into()),
    }
}

fn random_voice() -> u8 {
    let mut byte = 0u8;
    // SAFETY: a one-byte writable buffer.
    let got = unsafe { libc::getrandom(&mut byte as *mut u8 as *mut libc::c_void, 1, 0) };
    if got != 1 {
        // Without randomness a voice could be predictable; refuse to continue.
        process::abort();
    }
    byte
}

fn serve(mut stream: UnixStream, authorizer: Authorizer) {
    let Ok(peer) = auth::peer(&stream) else {
        return;
    };
    let mut session = Session::new();
    let mut keyboards = Keyboards::new();
    let mut authorized = false;
    let mut pending = Vec::<u8>::new();
    let client_fd = stream.as_raw_fd();

    loop {
        let device_fds = keyboards.fds();
        let mut polls: Vec<libc::pollfd> = std::iter::once(client_fd)
            .chain(device_fds.iter().copied())
            .map(|fd| libc::pollfd {
                fd,
                events: libc::POLLIN,
                revents: 0,
            })
            .collect();
        let timeout = if session.is_streaming() {
            RESCAN_INTERVAL_MS
        } else if authorized {
            -1
        } else {
            UNAUTHORIZED_TIMEOUT_MS
        };
        // SAFETY: `polls` is a valid slice of pollfd for the duration of the call.
        let ready = unsafe { libc::poll(polls.as_mut_ptr(), polls.len() as libc::nfds_t, timeout) };
        if ready < 0 {
            continue; // EINTR
        }
        if ready == 0 {
            if session.is_streaming() {
                keyboards.rescan();
                continue;
            }
            return; // never authorized: stop holding a slot
        }

        for poll in &polls[1..] {
            if poll.revents == 0 {
                continue;
            }
            for key in keyboards.drain(poll.fd) {
                if let Some(line) = session.on_key(key.code, key.value, key.time_ms, &mut random_voice) {
                    if stream.write_all(line.as_bytes()).is_err() {
                        return;
                    }
                }
            }
        }

        if polls[0].revents == 0 {
            continue;
        }
        let mut chunk = [0u8; MAX_COMMAND_BYTES];
        match stream.read(&mut chunk) {
            Ok(0) => return,
            Ok(read) => pending.extend_from_slice(&chunk[..read]),
            Err(err) if matches!(err.kind(), ErrorKind::Interrupted | ErrorKind::WouldBlock) => continue,
            Err(_) => return,
        }
        while let Some(newline) = pending.iter().position(|&byte| byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=newline).collect();
            let reply = match std::str::from_utf8(&line).ok().and_then(parse_command) {
                Some(command) => session.on_command(command, &mut || match authorizer {
                    Authorizer::Polkit => auth::authorize(&peer),
                    Authorizer::Skip => true,
                }),
                None => Reply::BadCommand,
            };
            match reply {
                Reply::Authorized => authorized = true,
                Reply::Started => {
                    authorized = true;
                    keyboards.rescan();
                }
                Reply::Stopped => keyboards.close(),
                Reply::Denied | Reply::BadCommand => {}
            }
            if stream.write_all(reply.line().as_bytes()).is_err() {
                return;
            }
        }
        if pending.len() > MAX_COMMAND_BYTES {
            return; // not speaking the protocol
        }
    }
}
