import { CONSTELLATION } from "../data/constellation";
import { Engine } from "../lib/engine";
import { clamp01 } from "../lib/mapping";
import { blendTimbres } from "../lib/timbre";
import { DEFAULT_FOCUS, gaussianWeights, type Point } from "../lib/weighting";

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
const TIMBRES = CONSTELLATION.map((prompt) => prompt.timbre);

export function start(): void {
  const field = document.querySelector<HTMLElement>('[data-testid="field"]');
  const cursor = document.querySelector<HTMLElement>('[data-testid="cursor"]');
  if (!field || !cursor) return;

  const marks = [...field.querySelectorAll<HTMLElement>("[data-prompt]")];
  const engine = new Engine();

  let position: Point = { x: 0.5, y: 0.5 };
  let started = false;

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
    const weights = gaussianWeights(position, POSITIONS, DEFAULT_FOCUS);
    engine.setTimbre(blendTimbres(TIMBRES, weights));
    render(weights);
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

  window.addEventListener("keydown", (event) => {
    const vector = KEY_VECTORS[event.key];
    if (!vector) return;
    event.preventDefault();
    void begin();
    moveTo({ x: position.x + vector.x, y: position.y + vector.y });
  });

  moveTo(position);
}
