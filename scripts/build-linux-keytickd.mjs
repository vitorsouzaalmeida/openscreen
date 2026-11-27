// Builds the Linux key timing service (electron/native/keytickd) and stages it,
// with its systemd, sysusers and polkit files and its install script, in
// electron/native/bin/linux-<arch>/keytickd/.
//
// Unlike the capture helper next to it, the app never spawns this binary: it is
// installed system-wide (see keytickd/system/install.sh) and the app only
// connects to its socket. It is staged with the other native binaries so that a
// packaged build carries everything the install needs.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
	console.log("Skipping key timing service build: host platform is not Linux.");
	process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const binaryName = "openscreen-keytickd";
const crateDir = path.join(root, "electron", "native", "keytickd");
const manifest = path.join(crateDir, "Cargo.toml");
const systemDir = path.join(crateDir, "system");
const tag = `linux-${process.arch === "arm64" ? "arm64" : "x64"}`;
const outDir = path.join(root, "electron", "native", "bin", tag, "keytickd");

const build = spawnSync("cargo", ["build", "--release", "--manifest-path", manifest], {
	cwd: crateDir,
	stdio: "inherit",
});
if (build.error) {
	console.error(`Failed to start cargo: ${build.error.message}`);
	process.exit(1);
}
if (build.status !== 0) {
	process.exit(build.status ?? 1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(
	path.join(crateDir, "target", "release", binaryName),
	path.join(outDir, binaryName),
);
fs.chmodSync(path.join(outDir, binaryName), 0o755);
for (const file of fs.readdirSync(systemDir)) {
	fs.copyFileSync(path.join(systemDir, file), path.join(outDir, file));
}
console.log(`Staged ${binaryName} and its system files in ${path.relative(root, outDir)}`);
