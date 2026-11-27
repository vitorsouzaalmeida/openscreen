#!/bin/sh
# Installs the OpenScreen key timing service from this checkout or from an
# installed app's resources. Run as root: sudo sh install.sh [path-to-binary]
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
binary=${1:-}
if [ -z "$binary" ]; then
	# Staged by scripts/build-linux-keytickd.mjs next to this script, or built
	# in place by a bare `cargo build --release` in the crate.
	for candidate in \
		"$here/openscreen-keytickd" \
		"$here/../target/release/openscreen-keytickd"; do
		if [ -x "$candidate" ]; then
			binary=$candidate
			break
		fi
	done
fi
if [ -z "$binary" ] || [ ! -x "$binary" ]; then
	echo "openscreen-keytickd binary not found; build it with: npm run build:native:keytickd" >&2
	exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
	echo "run as root: sudo sh $0" >&2
	exit 1
fi

install -Dm755 "$binary" /usr/lib/openscreen/openscreen-keytickd
install -Dm644 "$here/openscreen-keytick.socket" /etc/systemd/system/openscreen-keytick.socket
install -Dm644 "$here/openscreen-keytick.service" /etc/systemd/system/openscreen-keytick.service
install -Dm644 "$here/openscreen-keytick.sysusers.conf" /etc/sysusers.d/openscreen-keytick.conf
install -Dm644 "$here/org.openscreen.keytick.policy" /usr/share/polkit-1/actions/org.openscreen.keytick.policy

systemd-sysusers /etc/sysusers.d/openscreen-keytick.conf
systemctl daemon-reload
# A running copy would keep serving the old binary.
systemctl stop openscreen-keytick.service 2>/dev/null || true
systemctl enable --now openscreen-keytick.socket
echo "OpenScreen key timing service installed. Turn on 'Key sounds' in OpenScreen to use it."
