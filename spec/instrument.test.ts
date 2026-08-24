import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// This week's published spec (crits/04-instrument) turned into tests. Runs
// against the BUILT site, like invariants.test.ts, so it checks the contract
// regardless of how the instrument is implemented or what stack ships it.
//
// Spec lines a test can't judge (left to the crit, not asserted here):
// - "it is expressive: the player's choices shape what they hear, and two
//   players sound different"
// - "a stranger can play it uninstructed — the opening screen invites the
//   first sound"
// - "there is no way to play it wrong — no score, no fail state"
// - "you can account for how you directed, grounded and corrected the work"

const DIST = resolve("dist");
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"];

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const shipped = files();

const pages = shipped
  .filter((path) => path.endsWith(".html"))
  .map((path) => new JSDOM(readFileSync(path, "utf8")).window.document);

// All the JavaScript that ships, however it ships. A bundler is free to emit
// a module as a separate file or inline it into the page, so asserting against
// only one of those makes the check a claim about the build tool rather than
// about the site.
const scripts = [
  ...shipped
    .filter((path) => path.endsWith(".js"))
    .map((path) => readFileSync(path, "utf8")),
  ...pages.flatMap((doc) =>
    [...doc.querySelectorAll("script")].map((tag) => tag.textContent ?? ""),
  ),
].join("\n");

describe("the browser is the instrument, not a tape deck", () => {
  it("ships no pre-recorded audio files", () => {
    const audioAssets = shipped.filter((path) =>
      AUDIO_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext)),
    );
    expect(
      audioAssets,
      `found shipped audio file(s): ${audioAssets.join(", ")} — sound should be synthesised live, not played back`,
    ).toEqual([]);
  });

  it("has no <audio> or <video> playback elements", () => {
    for (const doc of pages) {
      expect(doc.querySelectorAll("audio, video").length).toBe(0);
    }
  });

  it("uses the Web Audio API to synthesise sound", () => {
    expect(
      /\bAudioContext\b/.test(scripts) || /\bwebkitAudioContext\b/.test(scripts),
      "no AudioContext/webkitAudioContext reference found in the built JS — the spec asks for sound made live in the page",
    ).toBe(true);
  });
});

describe("playable with whatever is at hand", () => {
  const pointerTokens = ["pointerdown", "pointermove", "mousedown", "touchstart"];
  const keyboardTokens = ["keydown", "keyup"];

  it("wires up a pointer or touch input path", () => {
    expect(
      pointerTokens.some((token) => scripts.includes(token)),
      `none of ${pointerTokens.join(", ")} found in the built JS`,
    ).toBe(true);
  });

  it("wires up a keyboard input path", () => {
    expect(
      keyboardTokens.some((token) => scripts.includes(token)),
      `none of ${keyboardTokens.join(", ")} found in the built JS`,
    ).toBe(true);
  });
});
