# Plan

## Premise

A field of authored text prompts laid out in space. The player moves a single
point through that field, and what they hear is a distance-weighted blend of the
prompts nearest them. Move toward "glass cathedral" and the sound turns bright
and reverberant; drift between it and "rusted machinery" and you get the morph
between them.

Two modes, deliberately separate:

- **Preparation** — author prompts and lay out the terrain. This is
  instrument-building.
- **Performance** — travel through the terrain you built. This is playing.

The crit deliverable ships a default constellation so a stranger performs
immediately, with authoring as a second mode.

## The question this probes

This is a probe for an honours thesis in which performers steer MagentaRT by
positioning text-prompt spheres relative to a centre, with distance setting each
prompt's influence. MagentaRT is local-only and can't ship to Pages, so the
model is replaced with procedural synthesis driven by the same weighted-prompt
geometry.

That substitution is the point, not a compromise. With the model removed, the
response is instant, deterministic and attributable — so the interaction can be
interrogated at a speed the real system can't offer:

- Is distance-weighting the right mapping, or does it want a sharper falloff?
- How many prompts blend legibly before the result turns to mud?
- Does inverting the metaphor — moving yourself rather than moving the prompts
  — actually reduce the load on a performer whose hands are on another
  instrument?

Answers transfer, because they're about the interaction rather than the
generator.

## Architecture

Four layers, each independently testable:

1. **Constellation** — prompts with a text label, a position, and a parameter
   vector.
2. **Semantic projection** — text → synthesis parameters, via similarity to
   bipolar sonic anchors.
3. **Navigation** — the travelling point, plus a focus radius controlling how
   tightly the blend selects.
4. **Synthesis** — Web Audio voices driven continuously by the blended vector.

### Semantic projection

Each prompt is scored against six bipolar anchor axes. For an axis `a/b` the
value is `cos(prompt, a) - cos(prompt, b)`, giving a signed position on that
axis:

| Axis | Drives |
|---|---|
| bright / dark | filter cutoff |
| smooth / rough | waveshaper drive, detune spread |
| sparse / dense | event rate, voice count |
| still / restless | modulation depth, timing jitter |
| near / distant | reverb send vs. dry level |
| warm / metallic | FM ratio, inharmonicity |

Embeddings come from `all-MiniLM-L6-v2` via Transformers.js (~23MB quantised,
client-side). **The default constellation's vectors are precomputed offline and
shipped as JSON**, so the instrument has no runtime model dependency. Live
embedding is loaded lazily, and only for authoring.

### Navigation and blending

Gaussian falloff rather than raw inverse distance — it stays smooth as the point
crosses a prompt, where inverse distance blows up:

```
w_i = exp(-d_i² / (2σ²))     then normalised so Σw = 1
```

`σ` is the **focus radius**, and it is performable: tight σ means one prompt
dominates, wide σ means everything blends at once. That is a second expressive
dimension for one extra scalar.

Input tiers, all driving the same point:

- **Pointer / trackpad** — primary, works cold with no permissions
- **Arrow keys** — alternate input, and the accessibility path
- **MIDI CC** (mod wheel / expression pedal) — later; this is the tier that
  matters for the thesis, because it is playable while both hands are on a
  keyboard

### Synthesis

Two layers so the instrument has both continuous morph and rhythmic life:

- **Pad** — detuned oscillators → waveshaper → filter → reverb send. Always
  sounding once started; morphs continuously as the point moves.
- **Events** — scheduled notes on a lookahead scheduler, with rate, register and
  timbre driven by the blend.

Parameter changes use `setTargetAtTime` so movement doesn't produce zipper
noise. The reverb impulse response is **generated procedurally** (decaying noise
burst) rather than shipped as a file — `spec/instrument.test.ts` forbids audio
assets, and that constraint is correct: sound must be made live, not played
back.

The context starts suspended and resumes on the first user gesture, per the
autoplay policy.

## Features

### F1 — Audio spine

Start an `AudioContext` on first gesture and sound one voice whose filter
tracks pointer position. Proves the whole loop end to end before anything is
built on it.

**Done:** moving the pointer audibly changes the sound; nothing sounds before
the first gesture.
**Check:** `spec/instrument.test.ts` (AudioContext present, pointer path wired);
manual browser pass for the gesture gate.

### F2 — Constellation and blending

Render the default prompts at their positions, track the travelling point, and
compute normalised Gaussian weights.

**Done:** every prompt label is visible; weights always sum to 1; the nearest
prompt holds the largest weight.
**Check:** co-located unit test on the weighting function — sums to 1, nearest
prompt dominates, no NaN when the point sits exactly on a prompt.

### F3 — Parameter blending into synthesis

Blend prompt vectors by weight and drive the pad layer's parameters
continuously.

**Done:** travelling between two prompts produces an audible, smooth morph with
no clicks or zipper noise.
**Check:** unit test that the blended vector is the weighted mean of its inputs;
manual browser pass for smoothness at both marking viewports.

### F4 — Event layer

Scheduled notes whose rate, register and timbre follow the blend.

**Done:** sparse regions of the field are audibly sparser than dense ones.
**Check:** unit test on the scheduler's rate mapping; manual browser pass.

### F5 — Focus radius

Make σ performable — a key, a scroll gesture, or a second axis.

**Done:** the same position sounds meaningfully different at tight vs. wide
focus.
**Check:** unit test that σ narrows the weight distribution; manual pass.

### F6 — Keyboard navigation

Arrow keys move the point.

**Done:** the instrument is fully playable with no pointer.
**Check:** `spec/instrument.test.ts` keyboard path assertion.

### F7 — Opening invitation

The first screen makes the first sound obvious without instructions.

**Done:** a stranger makes sound within seconds of arriving, uninstructed.
**Check:** no automated check — this is judged at the crit. Test it on a person
who has not seen it.

### F8 — Authoring mode *(stretch)*

Type prompts, embed them live, auto-layout by semantic similarity, nudge from
there.

**Done:** a typed prompt lands somewhere sonically plausible.
**Check:** unit test that the anchor projection returns a bounded vector for
arbitrary input.

## Phasing

**Ship gate is the end of Phase 1.** Everything after is bonus, and gets cut
without hesitation if the clock demands it.

| Phase | Contents |
|---|---|
| 0 | F1 — audio spine |
| 1 | F2, F3, F4, F6, F7 — a complete, playable instrument |
| 2 | F5, visual design pass |
| 3 | F8 — authoring and live embedding |

Non-negotiable before the cutoff, independent of phase: `PROCESS.md` written
with resolving citations, `reflections/crit-4.md` written, `pnpm check` green,
repo flipped public and deployed. `pnpm check:evidence` gates the deploy, so
these are ship-blocking, not polish.

## Out of scope, on purpose

- **A real generative model.** Text-to-audio in the browser is not real-time —
  MusicGen via Transformers.js takes many seconds per few seconds of audio, at
  hundreds of MB. Magenta.js `MusicRNN` could supply generated note material and
  is worth a look *after* the crit; the library is dated enough that dependency
  archaeology would eat a day.
- **Hand tracking.** The right target eventually — a single hand position is
  exactly the coarse continuous control free-air gesture is good at — but a
  camera permission prompt stands between a stranger and their first sound, and
  the rig question (a laptop webcam sees hands over a keyboard badly) is
  unresolved. Post-crit.
- **Trajectory recording.** Once performance is movement through a space, a path
  becomes recordable and notatable — a spatial score for prompt-driven
  generative music. Genuinely interesting, entirely out of scope this week.
- **Multiple simultaneous points, networked play, persistence.**
