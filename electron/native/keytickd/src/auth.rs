//! Who is on the other end of the socket, and whether they may listen.
//!
//! The decision is polkit's, not ours: the action `org.openscreen.keytick.capture`
//! (see `system/org.openscreen.keytick.policy`) asks the user at the screen for
//! their password, and refuses anyone who is not in the active local session.
//! A process running as the user can therefore ask, but cannot answer for them.

use std::fs;
use std::io;
use std::mem;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::net::UnixStream;
use std::process::{Command, Stdio};

pub const ACTION_ID: &str = "org.openscreen.keytick.capture";
const PKCHECK: &str = "/usr/bin/pkcheck";
/// `SO_PEERPIDFD` (Linux 6.5). Not yet named by every `libc` release.
const SO_PEERPIDFD: libc::c_int = 77;

pub struct Peer {
    pub pid: i32,
    pub uid: u32,
    /// A handle on the connecting process itself. A pid alone can be recycled
    /// between the connection and the polkit check; this cannot.
    pidfd: Option<OwnedFd>,
}

pub fn peer(stream: &UnixStream) -> io::Result<Peer> {
    let fd = stream.as_raw_fd();
    let mut cred: libc::ucred = unsafe { mem::zeroed() };
    let mut len = mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: `cred` and `len` describe a writable buffer of the size the kernel expects.
    let rc = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            &mut cred as *mut _ as *mut libc::c_void,
            &mut len,
        )
    };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }

    let mut raw_pidfd: libc::c_int = -1;
    let mut len = mem::size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: as above, for a single int.
    let rc = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            SO_PEERPIDFD,
            &mut raw_pidfd as *mut _ as *mut libc::c_void,
            &mut len,
        )
    };
    // SAFETY: on success the kernel handed us a new descriptor that we now own.
    let pidfd = (rc == 0 && raw_pidfd >= 0).then(|| unsafe { OwnedFd::from_raw_fd(raw_pidfd) });

    Ok(Peer {
        pid: cred.pid,
        uid: cred.uid,
        pidfd,
    })
}

impl Peer {
    /// False once the connecting process has exited. Without a pidfd (a kernel
    /// before 6.5) this cannot be known and the answer is "still alive".
    fn alive(&self) -> bool {
        let Some(pidfd) = &self.pidfd else {
            return true;
        };
        let mut poll = libc::pollfd {
            fd: pidfd.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // A pidfd becomes readable when its process exits.
        // SAFETY: one valid pollfd, zero timeout.
        unsafe { libc::poll(&mut poll, 1, 0) == 0 }
    }
}

/// Field 22 of `/proc/<pid>/stat`: the process start time, which polkit uses
/// together with the pid to name one process and not whichever holds the pid.
pub fn parse_start_time(stat: &str) -> Option<u64> {
    // The command name (field 2) is in parentheses and may itself contain
    // spaces and parentheses, so fields are counted from the LAST ')'.
    let after_comm = &stat[stat.rfind(')')? + 1..];
    after_comm.split_ascii_whitespace().nth(19)?.parse().ok()
}

fn start_time(pid: i32) -> Option<u64> {
    parse_start_time(&fs::read_to_string(format!("/proc/{pid}/stat")).ok()?)
}

/// Asks polkit whether `peer` may receive key timing, letting it prompt.
/// Blocks for as long as the user takes to answer.
pub fn authorize(peer: &Peer) -> bool {
    let Some(start) = start_time(peer.pid) else {
        return false;
    };
    // The start time was read from /proc by pid. Only if the process that
    // connected is still alive is that pid guaranteed to still be its own.
    if !peer.alive() {
        return false;
    }
    let status = Command::new(PKCHECK)
        .arg("--action-id")
        .arg(ACTION_ID)
        .arg("--process")
        .arg(format!("{},{},{}", peer.pid, start, peer.uid))
        .arg("--allow-user-interaction")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    matches!(status, Ok(status) if status.success()) && peer.alive()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_time_is_field_22() {
        let stat = "4242 (electron) S 1 4242 4242 0 -1 4194560 100 0 0 0 5 6 0 0 20 0 30 0 987654 1000000 200 18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0";
        assert_eq!(parse_start_time(stat), Some(987654));
    }

    #[test]
    fn a_command_name_with_spaces_and_parentheses_does_not_shift_the_fields() {
        let stat = "7 (evil) name (x) S 1 7 7 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 555 0 0";
        assert_eq!(parse_start_time(stat), Some(555));
    }

    #[test]
    fn garbage_has_no_start_time() {
        assert_eq!(parse_start_time(""), None);
        assert_eq!(parse_start_time("1 (x) S 1"), None);
    }
}
