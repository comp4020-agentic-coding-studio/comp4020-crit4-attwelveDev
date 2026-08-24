import { Engine, type Position } from "../lib/engine";
import { clamp01 } from "../lib/mapping";

// Wiring: DOM events in, normalised position out, engine driven. Everything
// with any logic in it lives in lib/ so it can be tested without a browser.

/** How far one arrow-key press moves the point, as a fraction of the field. */
const KEY_STEP = 0.045;

const KEY_VECTORS: Readonly<Record<string, Position>> = {
  ArrowLeft: { x: -KEY_STEP, y: 0 },
  ArrowRight: { x: KEY_STEP, y: 0 },
  ArrowUp: { x: 0, y: KEY_STEP },
  ArrowDown: { x: 0, y: -KEY_STEP },
};

export function start(): void {
  const field = document.querySelector<HTMLElement>('[data-testid="field"]');
  const cursor = document.querySelector<HTMLElement>('[data-testid="cursor"]');
  if (!field || !cursor) return;

  const engine = new Engine();
  let position: Position = { x: 0.5, y: 0.5 };
  let started = false;

  function render(): void {
    cursor!.style.left = `${position.x * 100}%`;
    // The field's y axis runs downward and the instrument's runs upward, so
    // pitch rises as the point rises. Flip here, once, at the boundary.
    cursor!.style.top = `${(1 - position.y) * 100}%`;
  }

  function moveTo(next: Position): void {
    position = { x: clamp01(next.x), y: clamp01(next.y) };
    engine.setPosition(position);
    render();
  }

  async function begin(): Promise<void> {
    if (started) return;
    started = true;
    // Reveal the cursor and retire the invitation immediately, so the page
    // acknowledges the gesture without waiting on the audio graph.
    document.body.dataset.playing = "true";
    await engine.start();
    // Distinct from `playing`: this only goes up once the context is genuinely
    // running, which is the difference between "we asked" and "it sounds".
    document.body.dataset.audio = engine.running ? "running" : "blocked";
    engine.setPosition(position);
  }

  function positionFromPointer(event: PointerEvent): Position {
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

  render();
}
