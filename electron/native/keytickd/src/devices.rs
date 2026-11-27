//! The keyboards, open only while a client is streaming.

use std::collections::HashSet;
use std::io::ErrorKind;
use std::os::fd::{AsRawFd, RawFd};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use evdev::{Device, EventType, KeyCode};

/// One raw key event: evdev code and value, and the kernel's own timestamp in
/// wall-clock milliseconds — the clock the capture helper stamps clicks with.
pub struct RawKey {
    pub code: u16,
    pub value: i32,
    pub time_ms: u64,
}

pub struct Keyboards {
    devices: Vec<(PathBuf, Device)>,
}

/// A device counts as a keyboard when it can type: letters and Enter. This
/// leaves out power buttons, media-key nodes and headset controls, which also
/// report `EV_KEY`, and plain mice.
fn is_keyboard(device: &Device) -> bool {
    device.supported_keys().is_some_and(|keys| {
        keys.contains(KeyCode::KEY_A) && keys.contains(KeyCode::KEY_Z) && keys.contains(KeyCode::KEY_ENTER)
    })
}

impl Keyboards {
    pub fn new() -> Self {
        Keyboards { devices: Vec::new() }
    }

    /// Opens every keyboard not already open. Called on `start` and then every
    /// few seconds, so a keyboard plugged in mid-take is picked up.
    pub fn rescan(&mut self) {
        let open: HashSet<PathBuf> = self.devices.iter().map(|(path, _)| path.clone()).collect();
        for (path, device) in evdev::enumerate() {
            if open.contains(&path) || !is_keyboard(&device) {
                continue;
            }
            if device.set_nonblocking(true).is_ok() {
                self.devices.push((path, device));
            }
        }
    }

    pub fn close(&mut self) {
        self.devices.clear();
    }

    pub fn fds(&self) -> Vec<RawFd> {
        self.devices.iter().map(|(_, device)| device.as_raw_fd()).collect()
    }

    /// Reads everything pending on the device behind `fd`. A device that fails
    /// (unplugged) is dropped; `rescan` adopts it again if it comes back.
    pub fn drain(&mut self, fd: RawFd) -> Vec<RawKey> {
        let Some(index) = self.devices.iter().position(|(_, device)| device.as_raw_fd() == fd) else {
            return Vec::new();
        };
        let mut keys = Vec::new();
        let failed = match self.devices[index].1.fetch_events() {
            Ok(events) => {
                for event in events {
                    if event.event_type() != EventType::KEY {
                        continue;
                    }
                    let time_ms = event
                        .timestamp()
                        .duration_since(UNIX_EPOCH)
                        .map(|elapsed| elapsed.as_millis() as u64)
                        .unwrap_or(0);
                    keys.push(RawKey {
                        code: event.code(),
                        value: event.value(),
                        time_ms,
                    });
                }
                false
            }
            Err(err) => !matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted),
        };
        if failed {
            self.devices.remove(index);
        }
        keys
    }
}
