import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KeytickClient, parseKeyLine } from "./keytickClient";

/** A stand-in for the service: answers commands the way keytickd does. */
function fakeService(socketPath: string, options: { allow: boolean }) {
	const commands: string[] = [];
	let client: net.Socket | null = null;
	const server = net.createServer((socket) => {
		client = socket;
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			for (const command of chunk.split("\n").filter(Boolean)) {
				commands.push(command);
				if (command === "auth") {
					socket.write(options.allow ? '{"type":"authorized"}\n' : '{"type":"denied"}\n');
				} else if (command === "start") {
					socket.write(options.allow ? '{"type":"started"}\n' : '{"type":"denied"}\n');
				} else if (command === "stop") {
					socket.write('{"type":"stopped"}\n');
				}
			}
		});
	});
	return {
		commands,
		listen: () => new Promise<void>((resolve) => server.listen(socketPath, resolve)),
		send: (line: string) => client?.write(line),
		hangUp: () => client?.destroy(),
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("KeytickClient", () => {
	let dir: string;
	let socketPath: string;

	beforeEach(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), "keytick-"));
		socketPath = path.join(dir, "sock");
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("is unavailable when the socket does not exist", async () => {
		const client = new KeytickClient({ socketPath, platform: "linux" });
		expect(client.isInstalled()).toBe(false);
		expect(await client.authorize()).toBe("unavailable");
		expect(await client.start()).toBe("unavailable");
		expect(client.stop()).toEqual([]);
	});

	it("is unavailable off Linux even if the path exists", async () => {
		const service = fakeService(socketPath, { allow: true });
		await service.listen();
		const client = new KeytickClient({ socketPath, platform: "win32" });
		expect(client.isInstalled()).toBe(false);
		expect(await client.start()).toBe("unavailable");
		await service.close();
	});

	it("collects key events between start and stop, in wall-clock time", async () => {
		const service = fakeService(socketPath, { allow: true });
		await service.listen();
		const client = new KeytickClient({ socketPath, platform: "linux" });

		expect(await client.authorize()).toBe("ok");
		// Authorized but not started: an event now is not part of any take.
		service.send('{"type":"key","t":1,"e":"d","c":"key","v":1}\n');
		await settle();

		expect(await client.start()).toBe("ok");
		service.send('{"type":"key","t":1000,"e":"d","c":"key","v":41}\n{"type":"key","t":10');
		service.send('80,"e":"u","c":"mod","v":7}\n');
		await settle();

		expect(client.stop()).toEqual([
			{ atMs: 1000, type: "down", kind: "key", voice: 41 },
			{ atMs: 1080, type: "up", kind: "modifier", voice: 7 },
		]);
		await settle();
		expect(service.commands).toEqual(["auth", "start", "stop"]);
		// A second stop has nothing left and does not ask the service again.
		expect(client.stop()).toEqual([]);
		client.dispose();
		await service.close();
	});

	it("reports a dismissed prompt as denied", async () => {
		const service = fakeService(socketPath, { allow: false });
		await service.listen();
		const client = new KeytickClient({ socketPath, platform: "linux" });
		expect(await client.authorize()).toBe("denied");
		expect(await client.start()).toBe("denied");
		expect(client.isCapturing).toBe(false);
		client.dispose();
		await service.close();
	});

	it("fails a pending command, and reconnects later, when the service goes away", async () => {
		const service = fakeService(socketPath, { allow: true });
		await service.listen();
		const client = new KeytickClient({ socketPath, platform: "linux" });
		expect(await client.start()).toBe("ok");
		service.hangUp();
		await settle();
		expect(client.isCapturing).toBe(false);
		expect(await client.start()).toBe("ok");
		client.dispose();
		await service.close();
	});
});

describe("parseKeyLine", () => {
	it("accepts a well-formed key event", () => {
		expect(parseKeyLine({ type: "key", t: 5, e: "d", c: "enter", v: 0 })).toEqual({
			atMs: 5,
			type: "down",
			kind: "enter",
			voice: 0,
		});
	});

	it("rejects anything else", () => {
		expect(parseKeyLine({ type: "started" })).toBeNull();
		expect(parseKeyLine({ type: "key", t: "5", e: "d", c: "key", v: 1 })).toBeNull();
		expect(parseKeyLine({ type: "key", t: 5, e: "x", c: "key", v: 1 })).toBeNull();
		expect(parseKeyLine({ type: "key", t: 5, e: "d", c: "KEY_A", v: 1 })).toBeNull();
		expect(parseKeyLine({ type: "key", t: 5, e: "d", c: "key", v: 256 })).toBeNull();
		expect(parseKeyLine(null)).toBeNull();
	});
});
