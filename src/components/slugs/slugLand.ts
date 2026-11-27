// The painted land on screen: the canvas slugArt paints, as a Phaser texture, plus
// smaller copies for zooms that shrink it. The renderer is WebGL 1, where a texture
// that is not a power of two in size cannot have mipmaps, and the land (1920 × 696
// world px at 2 canvas px each) is not: shrunk more than twice by plain LINEAR
// filtering it shimmers as the overview pans. Each copy is half the one before, so
// whichever is shown is shrunk less than twice.

import * as Phaser from 'phaser';

interface Level {
  canvas: HTMLCanvasElement;
  tex: Phaser.Textures.CanvasTexture;
  img: Phaser.GameObjects.Image;
  /** Canvas px per world px. */
  density: number;
}

export class LandLayer {
  private readonly scene: Phaser.Scene;
  private readonly place: (img: Phaser.GameObjects.Image) => Phaser.GameObjects.Image;
  private readonly key: () => string;
  private readonly levels: Level[] = [];
  private shown = 0;
  private visible = true;
  /** World px painted since the last upload, or null. */
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private scratch: HTMLCanvasElement | null = null;

  /**
   * `canvas` is the land at `density` canvas px per world px; `place` adds an image to
   * the world camera, `key` makes a fresh texture key.
   */
  constructor(scene: Phaser.Scene, canvas: HTMLCanvasElement, density: number, place: (img: Phaser.GameObjects.Image) => Phaser.GameObjects.Image, key: () => string) {
    this.scene = scene;
    this.place = place;
    this.key = key;
    this.add(canvas, density);
  }

  /** The full-size canvas: repaintArea and dugColours work on it. */
  get canvas(): HTMLCanvasElement {
    return this.levels[0].canvas;
  }

  /** The world px box [x0, x1) × [y0, y1) of the full-size canvas was painted again. */
  painted(box: { x0: number; y0: number; x1: number; y1: number }) {
    const d = this.dirty;
    this.dirty = d ? { x0: Math.min(d.x0, box.x0), y0: Math.min(d.y0, box.y0), x1: Math.max(d.x1, box.x1), y1: Math.max(d.y1, box.y1) } : { ...box };
  }

  /**
   * Bring the smaller copies and the GPU up to date with what was painted. Only the
   * changed box is sent: the whole land is 3840 × 1392 px, 21 MB of RGBA, and every
   * blast used to send all of it.
   */
  upload() {
    const d = this.dirty;
    if (!d) return;
    this.dirty = null;
    const top = this.levels[0].density;
    // The box in full-size canvas px, widened to the coarsest copy's px so it halves exactly at every step.
    const step = 2 ** (this.levels.length - 1);
    let x0 = Math.floor((d.x0 * top) / step) * step;
    let y0 = Math.floor((d.y0 * top) / step) * step;
    let x1 = Math.ceil((d.x1 * top) / step) * step;
    let y1 = Math.ceil((d.y1 * top) / step) * step;
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      x1 = Math.min(x1, level.canvas.width);
      y1 = Math.min(y1, level.canvas.height);
      if (i > 0) {
        const ctx = level.canvas.getContext('2d')!;
        ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
        ctx.drawImage(this.levels[i - 1].canvas, x0 * 2, y0 * 2, (x1 - x0) * 2, (y1 - y0) * 2, x0, y0, x1 - x0, y1 - y0);
      }
      this.send(level, x0, y0, x1, y1);
      x0 /= 2;
      y0 /= 2;
      x1 = Math.ceil(x1 / 2);
      y1 = Math.ceil(y1 / 2);
    }
  }

  /** Show the copy that suits `zoom` (device px per world px): the smallest not enlarged. */
  show(zoom: number) {
    while (this.levels[this.levels.length - 1].density > zoom * 2 && this.levels[this.levels.length - 1].canvas.width > 64) this.addHalf();
    let pick = 0;
    while (pick + 1 < this.levels.length && this.levels[pick + 1].density >= zoom) pick++;
    if (pick === this.shown) return;
    this.levels[this.shown].img.setVisible(false);
    this.shown = pick;
    this.levels[pick].img.setVisible(this.visible);
  }

  setVisible(on: boolean) {
    this.visible = on;
    this.levels[this.shown].img.setVisible(on);
  }

  destroy() {
    for (const level of this.levels) {
      level.img.destroy();
      this.scene.textures.remove(level.tex);
    }
    this.levels.length = 0;
  }

  private add(canvas: HTMLCanvasElement, density: number) {
    const tex = this.scene.textures.addCanvas(this.key(), canvas)!;
    const img = this.place(this.scene.add.image(0, 0, tex).setOrigin(0, 0).setDepth(10).setScale(1 / density));
    img.setVisible(this.levels.length === this.shown && this.visible);
    this.levels.push({ canvas, tex, img, density });
  }

  private addHalf() {
    const from = this.levels[this.levels.length - 1];
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(from.canvas.width / 2);
    canvas.height = Math.ceil(from.canvas.height / 2);
    // At exactly half size, bilinear sampling lands between four source px: a 2 × 2 box average.
    canvas.getContext('2d')!.drawImage(from.canvas, 0, 0, canvas.width * 2, canvas.height * 2, 0, 0, canvas.width, canvas.height);
    this.add(canvas, from.density / 2);
  }

  /** texSubImage2D of one box of a level. Phaser 4.2.1 has no call for part of a texture, so this goes to GL itself. */
  private send(level: Level, x0: number, y0: number, x1: number, y1: number) {
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const renderer = this.scene.renderer;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
    const source = level.tex.source[0];
    const wrapper = source.glTexture;
    // glTexture is null until Phaser has made one; refresh makes it from the whole canvas.
    if (!wrapper || (w === level.canvas.width && h === level.canvas.height)) {
      level.tex.refresh();
      return;
    }
    const scratch = (this.scratch ??= document.createElement('canvas'));
    scratch.width = w;
    scratch.height = h;
    scratch.getContext('2d')!.drawImage(level.canvas, x0, y0, w, h, 0, 0, w, h);
    const gl = renderer.gl;
    renderer.glTextureUnits.bind(wrapper, 0);
    renderer.glWrapper.updateTexturing({ texturing: { flipY: source.flipY, premultiplyAlpha: wrapper.pma } });
    // Flipped on upload, the texture's first row is the canvas's last.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, source.flipY ? level.canvas.height - y1 : y0, gl.RGBA, gl.UNSIGNED_BYTE, scratch);
  }
}
