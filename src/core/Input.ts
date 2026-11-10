export type Action = 'throttle' | 'brake' | 'left' | 'right';

const KEYMAP: Record<string, Action> = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/** Held driving keys plus one-shot handlers for menu-style keys. */
export class Input {
  private held = new Set<Action>();
  private touch = new Set<Action>();
  private keyHandlers = new Map<string, () => void>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (action) {
        this.held.add(action);
        e.preventDefault();
      }
      if (!e.repeat) this.keyHandlers.get(e.code)?.();
    });
    target.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (action) this.held.delete(action);
    });
    target.addEventListener('blur', () => this.held.clear());
  }

  isDown(action: Action): boolean {
    return this.held.has(action) || this.touch.has(action);
  }

  /** On-screen pedals and steering buttons. */
  setTouch(action: Action, down: boolean): void {
    if (down) this.touch.add(action);
    else this.touch.delete(action);
  }

  /** Digital steering as an axis: -1 left, +1 right. */
  get steer(): number {
    return (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
  }

  onKey(code: string, handler: () => void): void {
    this.keyHandlers.set(code, handler);
  }
}
