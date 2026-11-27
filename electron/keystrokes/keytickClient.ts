// Client for the Linux key timing service (electron/native/keytickd).
//
// The service owns the keyboards; this process never opens one. What arrives here is already
// reduced to press and release times, a key class and a per-take voice number, and only after
// the user has answered the service's polkit prompt. One connection is kept for the life of
// the app, because the service authorizes per connection: reconnecting would ask again.

import { existsSync } from "node:fs";
import net from "node:net";
import { type KeyEvent, type KeyKind } from "../../src/lib/keystrokes/keyRecording";

export const KEYTICK_SOCKET_PATH = "/run/openscreen-keytick.sock";
export const KEYTICK_PROVIDER = "keytickd";

/** A take that long at a steady 15 keys a second. Past it the oldest presses are dropped. */
const MAX_KEY_EVENTS = 400_000;

export type KeytickAnswer =
	/** The service did what was asked. */
	| "ok"
	/** The user dismissed the prompt, or is not allowed to answer it. */
	| "denied"
	/** No service: not Linux, not installed, or it went away. */
	| "unavailable";

type Reply = "authorized" | "denied" | "started" | "stopped" | "error";

const WIRE_KINDS: Record<string, KeyKind> = {
	key: "key",
	space: "space",
	enter: "enter",
	backspace: "backspace",
	mod: "modifier",
};

/** One line from the service that is a key event, or `null` for anything else or malformed. */
export function parseKeyLine(message: unknown): KeyEvent | null {
	if (!message || typeof message !== "object") return null;
	const { type, t, e, c, v } = message as Record<string, unknown>;
	if (type !== "key") return null;
	const kind = typeof c === "string" ? WIRE_KINDS[c] : undefined;
	if (
		typeof t !== "number" ||
		!Number.isFinite(t) ||
		(e !== "d" && e !== "u") ||
		!kind ||
		typeof v !== "number" ||
		!Number.isInteger(v) ||
		v < 0 ||
		v > 255
	) {
		return null;
	}
	return { atMs: t, type: e === "d" ? "down" : "up", kind, voice: v };
}

export interface KeytickClientOptions {
	socketPath?: string;
	platform?: NodeJS.Platform;
}

export class KeytickClient {
	private readonly socketPath: string;
	private readonly platform: NodeJS.Platform;
	private socket: net.Socket | null = null;
	private connecting: Promise<net.Socket | null> | null = null;
	private buffered = "";
	/** Commands sent and not yet answered; the service answers in order. */
	private waiting: Array<(reply: Reply | null) => void> = [];
	private capturing = false;
	private events: KeyEvent[] = [];

	constructor(options: KeytickClientOptions = {}) {
		this.socketPath = options.socketPath ?? KEYTICK_SOCKET_PATH;
		this.platform = options.platform ?? process.platform;
	}

	/** Whether the service's socket exists. Cheap; says nothing about authorization. */
	isInstalled(): boolean {
		return this.platform === "linux" && existsSync(this.socketPath);
	}

	get isCapturing(): boolean {
		return this.capturing;
	}

	/**
	 * Asks the service to authorize this connection, which raises the system password prompt
	 * the first time. Resolves when the user has answered it.
	 */
	async authorize(): Promise<KeytickAnswer> {
		const reply = await this.request("auth");
		if (reply === "authorized") return "ok";
		return reply === "denied" ? "denied" : "unavailable";
	}

	/** Starts collecting key events. Prompts first when this connection is not yet authorized. */
	async start(): Promise<KeytickAnswer> {
		const reply = await this.request("start");
		if (reply === "started") {
			this.events = [];
			this.capturing = true;
			return "ok";
		}
		return reply === "denied" ? "denied" : "unavailable";
	}

	/** Stops collecting and returns what was collected, in wall-clock time. */
	stop(): KeyEvent[] {
		const events = this.events;
		this.events = [];
		if (this.capturing) {
			this.capturing = false;
			// Not awaited: the events are already here, and the service closing its
			// keyboards does not have to hold up saving the take.
			void this.request("stop");
		}
		return events;
	}

	dispose(): void {
		this.capturing = false;
		this.events = [];
		this.socket?.destroy();
		this.socket = null;
	}

	private async request(command: "auth" | "start" | "stop"): Promise<Reply | null> {
		const socket = await this.connect();
		if (!socket) return null;
		return new Promise((resolve) => {
			this.waiting.push(resolve);
			socket.write(`${command}\n`, (error) => {
				if (error) this.dropConnection();
			});
		});
	}

	private connect(): Promise<net.Socket | null> {
		if (this.socket) return Promise.resolve(this.socket);
		if (!this.isInstalled()) return Promise.resolve(null);
		this.connecting ??= new Promise((resolve) => {
			const socket = net.createConnection(this.socketPath);
			socket.setEncoding("utf8");
			socket.once("connect", () => {
				this.socket = socket;
				this.connecting = null;
				resolve(socket);
			});
			socket.on("data", (chunk: string) => this.onData(chunk));
			socket.on("error", () => {
				// "close" follows and does the cleanup.
			});
			socket.on("close", () => {
				if (this.connecting && !this.socket) {
					this.connecting = null;
					resolve(null);
				}
				if (this.socket === socket) this.dropConnection();
			});
		});
		return this.connecting;
	}

	/** The service is gone: every pending command fails, and the authorization with it. */
	private dropConnection() {
		const socket = this.socket;
		this.socket = null;
		this.capturing = false;
		this.buffered = "";
		socket?.destroy();
		const waiting = this.waiting;
		this.waiting = [];
		for (const resolve of waiting) resolve(null);
	}

	private onData(chunk: string) {
		this.buffered += chunk;
		let newline = this.buffered.indexOf("\n");
		while (newline >= 0) {
			const line = this.buffered.slice(0, newline);
			this.buffered = this.buffered.slice(newline + 1);
			this.onLine(line);
			newline = this.buffered.indexOf("\n");
		}
	}

	private onLine(line: string) {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		const key = parseKeyLine(message);
		if (key) {
			if (!this.capturing) return;
			if (this.events.length >= MAX_KEY_EVENTS) this.events.shift();
			this.events.push(key);
			return;
		}
		const type = (message as { type?: unknown } | null)?.type;
		if (
			type === "authorized" ||
			type === "denied" ||
			type === "started" ||
			type === "stopped" ||
			type === "error"
		) {
			this.waiting.shift()?.(type);
		}
	}
}
