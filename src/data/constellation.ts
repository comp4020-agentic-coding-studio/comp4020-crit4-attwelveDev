import type { Timbre } from "../lib/timbre";
import type { Point } from "../lib/weighting";

export interface Prompt {
  /** The word the player reads. */
  text: string;
  /** Where it sits in the field. Normalised, y up. */
  at: Point;
  /** What it sounds like. */
  timbre: Timbre;
}

// The default constellation: the vocabulary this instrument speaks.
//
// These vectors are authored rather than embedded. The navigation questions
// this prototype exists to answer --- whether distance-weighting is the right
// mapping, how many prompts blend before the result turns to mud --- don't
// depend on where the numbers came from, and authoring them removes a 23MB
// model from the critical path. The shape matches what a semantic projection
// would emit, so live embedding can replace this without the engine noticing.
//
// Laid out so neighbours are sonic neighbours: dark and warm to the left,
// bright and metallic to the right, still up, restless down. That is the
// arrangement a semantic projection would be trying to find anyway, and it
// means travelling a short distance is always a small change.
export const CONSTELLATION: readonly Prompt[] = [
  {
    text: "deep ocean",
    at: { x: 0.12, y: 0.8 },
    timbre: {
      bright: 0.08,
      rough: 0.2,
      dense: 0.18,
      restless: 0.1,
      distant: 0.8,
      metallic: 0.1,
      register: 0.05,
    },
  },
  {
    text: "distant thunder",
    at: { x: 0.18, y: 0.44 },
    timbre: {
      bright: 0.15,
      rough: 0.72,
      dense: 0.3,
      restless: 0.55,
      distant: 0.95,
      metallic: 0.22,
      register: 0.12,
    },
  },
  {
    text: "rusted machinery",
    at: { x: 0.3, y: 0.14 },
    timbre: {
      bright: 0.3,
      rough: 0.95,
      dense: 0.7,
      restless: 0.62,
      distant: 0.2,
      metallic: 0.88,
      register: 0.3,
    },
  },
  {
    text: "soft rainfall",
    at: { x: 0.5, y: 0.68 },
    timbre: {
      bright: 0.6,
      rough: 0.35,
      dense: 0.78,
      restless: 0.35,
      distant: 0.5,
      metallic: 0.25,
      register: 0.58,
    },
  },
  {
    text: "warm static",
    at: { x: 0.56, y: 0.28 },
    timbre: {
      bright: 0.45,
      rough: 0.8,
      dense: 0.85,
      restless: 0.3,
      distant: 0.35,
      metallic: 0.18,
      register: 0.38,
    },
  },
  {
    text: "glass cathedral",
    at: { x: 0.84, y: 0.86 },
    timbre: {
      bright: 0.88,
      rough: 0.12,
      dense: 0.25,
      restless: 0.15,
      distant: 0.92,
      metallic: 0.72,
      register: 0.72,
    },
  },
  {
    text: "brass bell",
    at: { x: 0.88, y: 0.54 },
    timbre: {
      bright: 0.7,
      rough: 0.25,
      dense: 0.2,
      restless: 0.2,
      distant: 0.4,
      metallic: 0.95,
      register: 0.55,
    },
  },
  {
    text: "neon arcade",
    at: { x: 0.86, y: 0.16 },
    timbre: {
      bright: 0.82,
      rough: 0.68,
      dense: 0.9,
      restless: 0.85,
      distant: 0.15,
      metallic: 0.78,
      register: 0.68,
    },
  },
];
