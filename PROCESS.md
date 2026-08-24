# Process overview

<!-- DRAFT SCAFFOLD — edit before shipping.

     The citations, checks and technical facts below are accurate. What needs
     your hand is the judgement: each moment should say why *you* made the call
     you made. Where a bracketed note appears, that's a gap only you can fill.
     Cut anything that doesn't match how the week actually felt. -->

## What I built

**Field** is a browser instrument built as a probe for my honours thesis, in
which performers steer AI-generated music by positioning text-prompt spheres
relative to a centre, with distance setting each prompt's influence. Eight
authored prompts sit as fixed landmarks in a two-dimensional field; the player
moves a single travelling point, and hears a Gaussian-weighted blend of whatever
is near. MagentaRT is local-only and cannot ship to Pages, so procedural Web
Audio synthesis stands in for the model — which is the point rather than a
compromise. With the generator removed the response is instant and
attributable, so the *interaction* can be interrogated at a speed the real
system can't offer.

The prototype deliberately inverts my thesis's metaphor: instead of moving
eight prompts, the player moves themselves through a fixed terrain. That cuts
the control load from eight objects to one, which matters because the performer
this is ultimately for already has both hands on another instrument.

## The moments that mattered

### The spec test wrote a line of the architecture

Before any prototype existed I turned the week's published spec into tests
([`ff2b86f`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-attwelveDev/commit/ff2b86f)),
including an assertion that no pre-recorded audio ships — the spec says sound
must be made live in the page, not played back. Those tests started red, which
was the intent.

The payoff came later and not where I expected. Building the pad's reverb, the
obvious move is to load an impulse-response file. That test forbids it, so the
impulse is generated at runtime from decaying noise instead
([`6f6fb51`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-attwelveDev/commit/6f6fb51)).
A constraint I wrote before I knew what I was building chose an implementation
for me. The spec tests went red-to-green across
[`ff2b86f...2ff210b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-attwelveDev/compare/ff2b86f...2ff210b).

<!-- [Your line here: did writing tests before the prototype change how you
     approached the build, or did it feel like overhead until this moment?] -->

### A drone that no setting could change

Playing the first complete build, I heard an ominous bass buzz under every
prompt, masking whatever each was supposed to sound like. The obvious response
is to retune — drop the drive, move the filter.

The real fault was structural. The only spectral control in the graph was a
lowpass, which by definition removes highs; nothing anywhere removed lows. The
fundamental and its bottom harmonics were therefore present *identically* in
every prompt regardless of what any timbre axis did. The bass was the one
quality that mathematically could not vary. Two further causes compounded it: a
waveshaper on every voice at all times, which imposes its own harmonic
signature on whatever it is fed and so collapsed the prompts toward each other,
and five sawtooth partials capped at 233 Hz, where a saw already contains every
harmonic and leaves the axes nothing to control
([`5cdfe12`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-attwelveDev/commit/5cdfe12)).

The correction went into the harness rather than the fix: three rules in
`CLAUDE.md` about spectral design, the sharpest being that *if no part of the
graph can remove a band, that band is a constant*.

### Measuring what I couldn't hear — and the limits of that

The week's brief says an agent can build a synth but can't hear the result. I
leaned on measurement to close part of that gap: an `AnalyserNode` tapped onto
the output, sampling spectral balance across six prompts, and later sampling
RMS over time to get a dynamic-contrast figure.

That measurement caught something listening hadn't isolated. Contrast sat at
1.3–1.6×, meaning the signal barely moved — events were sitting *inside* the
pad rather than above it. The cause was my own limiter: at −10 dB with a 12:1
ratio and a 3 ms attack it was catching every pluck transient and crushing it
back to the drone's level. I had built the thing that destroyed the contrast I
needed
([`5522efa`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-attwelveDev/commit/5522efa)).
Contrast after the fix: 3.5–5.0×.

But the numbers never initiated a fix. Both audio problems were found by ear
first, and measurement only told me *why*. A spectrum plot cannot tell you
something is unpleasant to sit with.

<!-- [Your line here: how did you decide when it sounded right? What were you
     listening for that a number couldn't stand in for?] -->

## Where to look

- Harness carried forward from Assignment 1, keeping the general rules and
  dropping what was specific to that prototype:
  [`ad47a73`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-attwelveDev/commit/ad47a73)
- The build, plan through instrument:
  [`3c19be6...5522efa`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-attwelveDev/compare/3c19be6...5522efa)
- `PLAN.md` records what was deliberately left out and why — hand tracking, a
  real generative model, trajectory-as-score.
