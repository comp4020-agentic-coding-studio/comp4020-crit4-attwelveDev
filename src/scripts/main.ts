import { CONSTELLATION } from "../data/constellation";
import { Engine } from "../lib/engine";
import { EventLayer } from "../lib/events";
import { applyEnergy } from "../lib/gesture";
import { clamp01, mapLinear } from "../lib/mapping";
import { blendTimbres, type Timbre } from "../lib/timbre";
import {
  DEFAULT_FOCUS,
  FOCUS_RANGE,
  gaussianWeights,
  type Point,
} from "../lib/weighting";

// Wiring: DOM events in, a position out, the field blended, the engine driven.
// Everything with logic in it lives in lib/ so it can be tested without a
// browser; this file is deliberately the only part that knows about elements.

/** How far one arrow-key press moves the point, as a fraction of the field. */
const KEY_STEP = 0.045;

const KEY_VECTORS: Readonly<Record<string, Point>> = {
  ArrowLeft: { x: -KEY_STEP, y: 0 },
  ArrowRight: { x: KEY_STEP, y: 0 },
  ArrowUp: { x: 0, y: KEY_STEP },
  ArrowDown: { x: 0, y: -KEY_STEP },
};

const POSITIONS = CONSTELLATION.map((prompt) => prompt.at);
const AUTHORED = CONSTELLATION.map((prompt) => prompt.timbre);

/**
 * Which set of timbre vectors the field is voiced with. Positions never change
 * between the two, so the same place in the field can be heard both ways ---
 * that controlled comparison is the point of the toggle.
 */
type Voicing = "authored" | "projected";

export function start(): void {
  const field = document.querySelector<HTMLElement>('[data-testid="field"]');
  const cursor = document.querySelector<HTMLElement>('[data-testid="cursor"]');
  const toggle = document.querySelector<HTMLButtonElement>(
    '[data-testid="voicing"]',
  );
  const readout = document.querySelector<HTMLElement>(
    '[data-testid="voicing-value"]',
  );
  const handsButton = document.querySelector<HTMLButtonElement>(
    '[data-testid="hands"]',
  );
  const handsReadout = document.querySelector<HTMLElement>(
    '[data-testid="hands-value"]',
  );
  const mirror = document.querySelector<HTMLVideoElement>(
    '[data-testid="mirror"]',
  );
  if (!field || !cursor) return;

  const marks = [...field.querySelectorAll<HTMLElement>("[data-prompt]")];
  const engine = new Engine();
  const events = new EventLayer(engine);

  let position: Point = { x: 0.5, y: 0.5 };
  let started = false;
  let voicing: Voicing = "authored";
  let projected: Timbre[] | null = null;
  let loading = false;
  let tracker: import("../lib/hands").HandTracker | null = null;
  /** How tightly the blend selects. Fixed unless a hand is steering it. */
  let focus = DEFAULT_FOCUS;
  /** How emphatic the hand's movement is. Always 0 without a hand. */
  let energy = 0;

  function timbres(): readonly Timbre[] {
    return voicing === "projected" && projected ? projected : AUTHORED;
  }

  /**
   * `busy` reserves the readout's width while the text is changing on its own
   * --- the download percentage counts up character by character, and a button
   * that resizes on every tick is worse than one briefly too wide.
   */
  function setReadout(text: string, busy = false): void {
    if (readout) readout.textContent = text;
    if (busy) toggle?.setAttribute("data-busy", "true");
    else toggle?.removeAttribute("data-busy");
  }

  function render(weights: readonly number[]): void {
    cursor!.style.left = `${position.x * 100}%`;
    // The field's y axis runs downward and the instrument's runs upward, so
    // sound rises as the point rises. Flip here, once, at the boundary.
    cursor!.style.top = `${(1 - position.y) * 100}%`;

    // Each prompt brightens with how much of it you are hearing. Weights are
    // normalised, so the strongest is rarely near 1 --- scale against the
    // loudest so the field still reads when everything is blended.
    const loudest = Math.max(...weights, 1e-6);
    marks.forEach((mark, index) => {
      const share = (weights[index] ?? 0) / loudest;
      mark.style.setProperty("--share", share.toFixed(3));
    });
  }

  function moveTo(next: Point): void {
    position = { x: clamp01(next.x), y: clamp01(next.y) };
    const weights = gaussianWeights(position, POSITIONS, focus);
    // The field says what this place sounds like; gestural energy says how
    // agitated it is here. Split along the line the projection experiment
    // found --- see docs/semantic-projection.md.
    const timbre = applyEnergy(blendTimbres(timbres(), weights), energy);
    engine.setTimbre(timbre);
    events.setTimbre(timbre);
    render(weights);
  }

  /**
   * Fetch the model and voice the constellation from language.
   *
   * Imported dynamically, and by nothing at startup: the model is tens of
   * megabytes and the authored field has to play the instant a stranger
   * arrives. This is the only path that pays for it, and only when asked.
   */
  async function loadProjected(): Promise<boolean> {
    if (projected) return true;
    if (loading) return false;
    loading = true;
    setReadout("loading 0%", true);

    try {
      const [{ buildAnchors, projectToTimbre }, { embed, loadEmbedder }] =
        await Promise.all([
          import("../lib/anchors"),
          import("../lib/embedding"),
        ]);

      await loadEmbedder((fraction) => {
        setReadout(`loading ${Math.round(fraction * 100)}%`, true);
      });

      setReadout("projecting", true);
      const anchors = await buildAnchors();
      const voiced: Timbre[] = [];
      for (const prompt of CONSTELLATION) {
        voiced.push(projectToTimbre(await embed(prompt.text), anchors));
      }
      projected = voiced;
      return true;
    } catch (error) {
      // A failed download must not strand the instrument in a mode that has
      // no vectors --- fall back to the voicing that always works.
      console.error("could not load the language model", error);
      voicing = "authored";
      toggle?.setAttribute("aria-pressed", "false");
      setReadout("unavailable");
      return false;
    } finally {
      loading = false;
    }
  }

  async function setVoicing(next: Voicing): Promise<void> {
    if (loading) return;
    if (next === "projected" && !(await loadProjected())) return;
    voicing = next;
    toggle?.setAttribute("aria-pressed", String(next === "projected"));
    setReadout(next === "projected" ? "language model" : "authored");
    moveTo(position);
  }

  async function begin(): Promise<void> {
    if (started) return;
    started = true;
    // Reveal the field and retire the invitation immediately, so the page
    // acknowledges the gesture without waiting on the audio graph.
    document.body.dataset.playing = "true";
    await engine.start();
    // Distinct from `playing`: this only goes up once the context is genuinely
    // running, which is the difference between "we asked" and "it sounds".
    document.body.dataset.audio = engine.running ? "running" : "blocked";
    moveTo(position);
    events.start();
  }

  function positionFromPointer(event: PointerEvent): Point {
    const bounds = field!.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: 1 - (event.clientY - bounds.top) / bounds.height,
    };
  }

  // The first press starts the instrument; after that the point simply follows
  // the pointer with no button held, which is what makes it feel playable
  // rather than draggable.
  field.addEventListener("pointerdown", (event) => {
    void begin();
    moveTo(positionFromPointer(event));
  });

  field.addEventListener("pointermove", (event) => {
    if (!started) return;
    moveTo(positionFromPointer(event));
  });

  toggle?.addEventListener("click", () => {
    void setVoicing(voicing === "authored" ? "projected" : "authored");
  });

  /**
   * Hand tracking, offered rather than required.
   *
   * Dynamically imported for the same reason as the embedder: the model and
   * its wasm runtime are tens of megabytes, and none of it may load before a
   * stranger can play. Pointer and keyboard keep working throughout, including
   * on every failure path --- a refused camera must cost nothing.
   */
  const HAND_LABELS: Record<string, string> = {
    idle: "off",
    loading: "starting",
    tracking: "on",
    denied: "no camera",
    failed: "unavailable",
  };

  handsButton?.addEventListener("click", () => {
    void (async () => {
      if (!mirror) return;

      if (tracker?.tracking) {
        tracker.stop();
        handsButton.setAttribute("aria-pressed", "false");
        return;
      }

      handsButton.setAttribute("aria-pressed", "true");
      tracker ??= new (await import("../lib/hands")).HandTracker({
        video: mirror,
        // The hand drives the same travelling point the pointer does, so
        // everything downstream is unchanged and the two inputs are
        // interchangeable rather than parallel code paths. Openness and
        // energy are the two things a pointer cannot express.
        onReading: ({ point, openness, energy: gestural }) => {
          void begin();
          // Spread to blur across many prompts, close to pick one out.
          focus = mapLinear(openness, FOCUS_RANGE.min, FOCUS_RANGE.max);
          energy = gestural;
          moveTo(point);
        },
        onState: (state) => {
          document.body.dataset.hands = state;
          if (handsReadout) handsReadout.textContent = HAND_LABELS[state] ?? state;
          if (state !== "tracking" && state !== "loading") {
            handsButton.setAttribute("aria-pressed", "false");
          }
        },
      });

      await tracker.start();
    })();
  });

  window.addEventListener("keydown", (event) => {
    const vector = KEY_VECTORS[event.key];
    if (!vector) return;
    event.preventDefault();
    void begin();
    moveTo({ x: position.x + vector.x, y: position.y + vector.y });
  });

  moveTo(position);
}
