# Does a language model know what words sound like?

A finding from building the semantic projection, recorded because it bears on
the thesis this prototype probes rather than on the prototype itself.

## The setup

Each of the instrument's seven timbre axes is anchored by a pair of opposed
phrases (`src/lib/anchors.ts`). A prompt's position on an axis is how much
closer its embedding sits to one pole than the other, pushed through `tanh` and
mapped to 0..1. The embedding is `all-MiniLM-L6-v2`, general-purpose and not
trained on anything to do with audio. No audio knowledge enters anywhere except
the choice of anchor phrases.

The eight prompts of the default constellation already had vectors chosen by
hand, by ear, before any of this existed. That makes them a control: the same
phrases, voiced once by a person and once by a language model.

## The comparison

Authored (`auth`) against projected (`proj`), all values 0..1.

```
                 axis:  bri  rgh  dns  rst  dst  met  reg
deep ocean       auth  0.08 0.20 0.18 0.10 0.80 0.10 0.05
                 proj  0.40 0.57 0.42 0.15 0.81 0.41 0.04
distant thunder  auth  0.15 0.72 0.30 0.55 0.95 0.22 0.12
                 proj  0.71 0.33 0.68 0.25 0.93 0.97 0.58
rusted machinery auth  0.30 0.95 0.70 0.62 0.20 0.88 0.30
                 proj  0.22 0.61 0.28 0.46 0.46 0.65 0.06
soft rainfall    auth  0.60 0.35 0.78 0.35 0.50 0.25 0.58
                 proj  0.42 0.83 0.43 0.43 0.24 0.03 0.10
warm static      auth  0.45 0.80 0.85 0.30 0.35 0.18 0.38
                 proj  0.27 0.42 0.23 0.48 0.02 0.13 0.33
glass cathedral  auth  0.88 0.12 0.25 0.15 0.92 0.72 0.72
                 proj  0.96 0.29 0.70 0.18 0.84 0.54 0.62
brass bell       auth  0.70 0.25 0.20 0.20 0.40 0.95 0.55
                 proj  0.26 0.25 0.84 0.30 0.14 1.00 0.85
neon arcade      auth  0.82 0.68 0.90 0.85 0.15 0.78 0.68
                 proj  0.72 0.30 0.71 0.41 0.68 0.76 0.18
```

## What it says

The axes split cleanly into two groups.

**Static spectral qualities project well.** `distant` is close to exact on the
three prompts where it matters most --- deep ocean 0.80/0.81, distant thunder
0.95/0.93, glass cathedral 0.92/0.84. `metallic` is nearly as good: brass bell
0.95/1.00, neon arcade 0.78/0.76, soft rainfall 0.25/0.03. `bright` and
`register` land on the extremes (glass cathedral, deep ocean) and wander in the
middle.

**Temporal and behavioural qualities do not.** `dense` disagrees badly and in
both directions --- brass bell authored 0.20 against projected 0.84, warm static
0.85 against 0.23. `rough` puts *soft rainfall* at 0.83 where a person said
0.35. `restless` collapses almost entirely: every prompt lands between 0.15 and
0.48, so the axis carries nearly no information.

The pattern is that a sentence embedding encodes **what a phrase is like**, not
**how it behaves over time**. "Metallic" and "distant" are close to properties
of the referent, and the model has strong opinions about them. How *busy* a
brass bell is, or how *restless*, is not something the phrase means --- it is
something a composer decides. The model has no opinion and returns noise around
the centre.

## Why it matters beyond this prototype

MagentaRT is conditioned on text prompts. If the asymmetry above is a property
of language rather than of this particular embedding --- and "how busy is a
brass bell" having no linguistic answer suggests it is --- then it predicts the
same asymmetry there: **text prompts should specify character reliably and
temporal behaviour poorly.**

That is a testable prediction about the thesis system, arrived at without
running the thesis system, and it suggests the prompt weighting may be carrying
less control over rhythm and density than the interface implies. If it holds,
temporal behaviour wants a control channel of its own rather than being folded
into the prompt.

Two caveats. The authored vectors are one person's intuition on eight phrases,
not ground truth --- where they disagree, the model is not automatically wrong.
And the anchor phrases are hand-chosen and unvalidated; a better `restless`
anchor pair might recover an axis this one collapsed. Both are cheap to test
with the toggle in the instrument, which plays either voicing of the same
constellation.
