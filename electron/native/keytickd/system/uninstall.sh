#!/bin/sh
# Removes the OpenScreen key timing service. Run as root: sudo sh uninstall.sh
set -eu
if [ "$(id -u)" -ne 0 ]; then
	echo "run as root: sudo sh $0" >&2
	exit 1
fi
systemctl disable --now openscreen-keytick.socket 2>/dev/null || true
systemctl stop openscreen-keytick.service 2>/dev/null || true
rm -f /etc/systemd/system/openscreen-keytick.socket \
	/etc/systemd/system/openscreen-keytick.service \
	/etc/sysusers.d/openscreen-keytick.conf \
	/usr/share/polkit-1/actions/org.openscreen.keytick.policy \
	/usr/lib/openscreen/openscreen-keytickd
rmdir /usr/lib/openscreen 2>/dev/null || true
systemctl daemon-reload
echo "OpenScreen key timing service removed. The 'openscreen-keytick' account is left in place; remove it with: userdel openscreen-keytick"
