// The names of the key sound samples. Pure data, on its own so that the main process (which
// stages the files and checks names against this list) and the renderer agree without either
// importing the other's code.

/** Samples a plain key press picks from, by voice. */
export const KEY_DOWN_SAMPLES = [
	"key-1",
	"key-2",
	"key-3",
	"key-4",
	"key-5",
	"key-6",
	"key-7",
	"key-8",
	"key-9",
] as const;
/** Samples a release picks from, by voice. Every kind of key lets go with one of these. */
export const KEY_UP_SAMPLES = ["key-up-1", "key-up-2", "key-up-3"] as const;
export const KEY_SPECIAL_SAMPLES = ["space", "enter", "backspace", "modifier"] as const;

/** Every sample the sound can play, in the order the scene's `samples` list carries them. */
export const KEY_SOUND_SAMPLES = [
	...KEY_DOWN_SAMPLES,
	...KEY_UP_SAMPLES,
	...KEY_SPECIAL_SAMPLES,
] as const;
export type KeySoundSample = (typeof KEY_SOUND_SAMPLES)[number];

export const keySampleFile = (sample: KeySoundSample) => `${sample}.wav`;
