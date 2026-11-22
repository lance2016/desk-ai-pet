// Pixi compiles some code with `new Function` unless this is loaded first; the app's CSP has no 'unsafe-eval'.
import "pixi.js/unsafe-eval";
import { Application, Container, Rectangle, Sprite, Texture, type Ticker } from "pixi.js";
import { isLayerVisible, layerElapsedSeconds, layerMotionProgress } from "../appearance/layerTiming";
import type { ActionAppearance } from "../appearance/AppearanceStore";
import type { AssetPack } from "../assets/AssetLoader";
import type { AnimationEntry, AnimationLayer, PetManifest } from "../assets/Manifest";
import type { HitRegion } from "../types";
import { calmMotion, sampleAdjustedMotion, sampleMotion, settleMotion, type MotionTransform } from "./motions";
import type { OpaqueMask, PetRenderer } from "./PetRenderer";

/** A mask cell counts as drawn above this alpha (0-255). */
const OPAQUE_ALPHA = 16;
/** Motions need smooth movement, but a desktop pet has no use for a higher rate. */
const MAX_FPS = 30;
/** The sleep loop barely moves; drawing it less often saves power while the pet naps. */
const SLEEP_ACTION = "sleep";
const SLEEP_MAX_FPS = 12;
/**
 * A single picture that only breathes (the idle pose) changes by about a pixel a frame: half the
 * rate looks the same and halves what the app, the page and the GPU spend while the pet stands there.
 */
const CALM_MAX_FPS = 15;
const CALM_MOTIONS: ReadonlySet<string | undefined> = new Set([undefined, "none", "breathe"]);
/** A `randomFlip` action faces either way equally often. */
const FLIP_CHANCE = 0.5;

interface LoadedAnimation {
  entry: AnimationEntry;
  motionSpeed?: number;
  motionStrength?: number;
  frames: Texture[];
  /** The decoded sheet, kept for reading its alpha. */
  image: HTMLImageElement;
  layers: Array<{ definition: AnimationLayer; frames: Texture[]; image: HTMLImageElement }>;
}

interface LayerSprite {
  definition: AnimationLayer;
  frames: Texture[];
  sprite: Sprite;
}

interface Playback {
  animation: LoadedAnimation;
  elapsedMs: number;
}

/**
 * Loads with a plain image element. PixiJS's own asset loader fails on the
 * `tauri://` scheme a packaged app is served from.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url.startsWith("data:") ? "uploaded image" : url}`));
    image.src = url;
  });
}

function sliceFrames(sheet: Texture, count: number): Texture[] {
  const frameWidth = sheet.width / count;
  return Array.from(
    { length: count },
    (_, index) =>
      new Texture({ source: sheet.source, frame: new Rectangle(index * frameWidth, 0, frameWidth, sheet.height) }),
  );
}

/** PixiJS implementation of the renderer. The only module that imports pixi.js. */
export class PixiRenderer implements PetRenderer {
  private app: Application | null = null;
  private readonly stage = new Container();
  private readonly scene = new Container();
  private readonly sprite = new Sprite();
  private readonly layerSprites: LayerSprite[] = [];
  private readonly animations = new Map<string, LoadedAnimation>();
  private readonly originalAnimations = new Map<string, LoadedAnimation>();
  private readonly appearanceVersions = new Map<string, number>();
  private readonly customTextures = new Map<string, Array<{ texture: Texture; frames: Texture[] }>>();
  private pack: AssetPack | null = null;
  /** One image per file, shared by every animation that uses the file. */
  private readonly sheets = new Map<string, Promise<{ image: HTMLImageElement; texture: Texture }>>();
  private manifest: PetManifest | null = null;
  private playback: Playback | null = null;
  private fit = 1;
  /** Mirrored for the right screen edge. */
  private mirrored = false;
  /** Mirrored by the playing action's own random facing. */
  private flipped = false;
  /** Where the motion last put the pet, and where the playing action picked it up from. */
  private lastMotion: MotionTransform | null = null;
  private settleFrom: MotionTransform | null = null;

  /** The renderer owns its canvas and mounts it inside `host`. `random` decides the facing of `randomFlip` actions. */
  constructor(private readonly host: HTMLElement, private readonly random: () => number = Math.random) {
    this.sprite.anchor.set(0.5, 1);
    this.sprite.visible = false;
    this.scene.sortableChildren = true;
    this.scene.addChild(this.sprite);
    this.stage.addChild(this.scene);
  }

  private stopWatchingRatio: (() => void) | null = null;
  /** Follows the system's Reduce Motion setting. */
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  async loadAssetPack(pack: AssetPack): Promise<ReadonlySet<string>> {
    const app = new Application();
    await app.init({
      width: this.host.clientWidth || 1,
      height: this.host.clientHeight || 1,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    app.ticker.maxFPS = MAX_FPS;
    app.ticker.add(this.update);
    this.watchPixelRatio();
    app.stage.addChild(this.stage);
    this.host.appendChild(app.canvas);
    this.app = app;
    this.manifest = pack.manifest;
    this.pack = pack;

    await Promise.all(pack.manifest.animations.map((entry) => this.loadAnimation(pack, entry)));
    this.resize(this.host.clientWidth, this.host.clientHeight);
    return new Set(this.animations.keys());
  }

  async setAppearance(animationId: string, appearance: ActionAppearance | null): Promise<void> {
    const version = (this.appearanceVersions.get(animationId) ?? 0) + 1;
    this.appearanceVersions.set(animationId, version);
    const original = this.originalAnimations.get(animationId);
    if (!original) throw new Error(`Unknown animation: ${animationId}`);
    let updated = original;
    const owned: Array<{ texture: Texture; frames: Texture[] }> = [];
    try {
      if (appearance) {
        const image = await loadImage(appearance.image);
        const texture = Texture.from(image);
        if (texture.width % appearance.frames !== 0) {
          texture.destroy(true);
          throw new Error("Image width must be divisible by frame count");
        }
        const frames = sliceFrames(texture, appearance.frames);
        owned.push({ texture, frames });
        let layers = original.layers;
        if (appearance.layers) {
          if (!this.pack) throw new Error("Asset pack is unavailable");
          layers = [];
          for (const layer of appearance.layers) {
            const src = "image" in layer.source ? layer.source.image : this.pack.resolve(layer.source.file);
            const layerImage = await loadImage(src);
            const layerTexture = Texture.from(layerImage);
            if (layerTexture.width % layer.frames !== 0) {
              layerTexture.destroy(true);
              throw new Error("Layer image width must be divisible by frame count");
            }
            const layerFrames = sliceFrames(layerTexture, layer.frames);
            owned.push({ texture: layerTexture, frames: layerFrames });
            const { source, name: _name, ...options } = layer;
            const definition: AnimationLayer = { ...options, file: "file" in source ? source.file : "custom-layer.png" };
            layers.push({ definition, frames: layerFrames, image: layerImage });
          }
        }
        updated = {
          ...original,
          entry: { ...original.entry, frames: appearance.frames, fps: appearance.fps, motion: appearance.motion, loop: appearance.loop, randomFlip: appearance.randomFlip ?? original.entry.randomFlip },
          image, frames, layers,
          motionSpeed: appearance.motionSpeed,
          motionStrength: appearance.motionStrength,
        };
      }
      if (!this.app || this.appearanceVersions.get(animationId) !== version) {
        for (const texture of owned) this.releaseCustomTexture(texture);
        return;
      }
      const previous = this.customTextures.get(animationId);
      this.animations.set(animationId, updated);
      if (owned.length) this.customTextures.set(animationId, owned);
      else this.customTextures.delete(animationId);
      if (this.playback?.animation.entry.id === animationId) this.playAction(animationId);
      if (previous) for (const texture of previous) this.releaseCustomTexture(texture);
    } catch (error) {
      for (const texture of owned) this.releaseCustomTexture(texture);
      throw error;
    }
  }

  async addAnimation(entry: AnimationEntry): Promise<boolean> {
    if (!this.pack) return false;
    await this.loadAnimation(this.pack, entry);
    return this.animations.has(entry.id);
  }

  removeAnimation(animationId: string): void {
    // Bumping the version drops any picture still loading for it.
    this.appearanceVersions.set(animationId, (this.appearanceVersions.get(animationId) ?? 0) + 1);
    this.animations.delete(animationId);
    this.originalAnimations.delete(animationId);
    const owned = this.customTextures.get(animationId);
    this.customTextures.delete(animationId);
    if (owned) for (const texture of owned) this.releaseCustomTexture(texture);
  }

  playAction(animationId: string): void {
    const animation = this.animations.get(animationId);
    if (!animation) {
      console.warn(`No animation loaded for "${animationId}"`);
      return;
    }
    this.clearLayerSprites();
    for (const layer of animation.layers) {
      const sprite = new Sprite(layer.frames[0]);
      sprite.anchor.set(0.5, 1);
      sprite.zIndex = layer.definition.zIndex;
      this.scene.addChild(sprite);
      this.layerSprites.push({ definition: layer.definition, frames: layer.frames, sprite });
    }
    this.scene.sortChildren();
    if (this.app) this.app.ticker.maxFPS = maxFps(animationId, animation);
    const carried = this.playback ? this.lastMotion : null;
    const facedLeft = this.facesLeft();
    this.playback = { animation, elapsedMs: 0 };
    this.flipped = animation.entry.randomFlip && this.random() < FLIP_CHANCE;
    // Motions are sampled facing right: turning around turns what is carried over with it.
    this.settleFrom = carried && this.facesLeft() !== facedLeft ? { ...carried, x: -carried.x, rotation: -carried.rotation } : carried;
    this.sprite.visible = true;
    this.draw();
  }

  stopAction(): void {
    this.playback = null;
    this.sprite.visible = false;
    this.clearLayerSprites();
  }

  setMirrored(mirrored: boolean): void {
    this.mirrored = mirrored;
    this.draw();
  }

  resize(width: number, height: number): void {
    if (!this.app || !this.manifest || width <= 0 || height <= 0) return;
    const { canvas } = this.manifest;
    // Dragged onto a screen with another scale, the canvas must follow or it blurs.
    if (this.app.renderer.resolution !== window.devicePixelRatio) this.app.renderer.resolution = window.devicePixelRatio;
    this.app.renderer.resize(width, height);
    this.fit = Math.min(width / canvas.width, height / canvas.height);
    this.stage.scale.set(this.fit);
    // Keep the stage centered horizontally and resting on the bottom edge.
    this.stage.position.set((width - canvas.width * this.fit) / 2, height - canvas.height * this.fit);
  }

  hitTest(x: number, y: number): HitRegion | null {
    if (!this.manifest || !this.playback) return null;
    const frame = this.playback.animation.frames[0];
    const stageX = (x - this.stage.position.x) / this.fit;
    const stageY = (y - this.stage.position.y) / this.fit;
    // Position inside the frame as fractions, ignoring the current motion offset.
    const centerX = this.restingCenterX(this.playback.animation.entry, frame.width);
    const fromLeft = (stageX - (centerX - frame.width / 2)) / frame.width;
    const u = this.facesLeft() ? 1 - fromLeft : fromLeft;
    const v = (stageY - (this.manifest.canvas.height - frame.height)) / frame.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const head = this.manifest.headArea;
    const onHead = u >= head.x && u <= head.x + head.width && v >= head.y && v <= head.y + head.height;
    return onHead ? "head" : "body";
  }

  opaqueMask(cell: number): OpaqueMask | null {
    if (!this.app || !this.manifest || !this.playback) return null;
    const { entry, frames, image, layers } = this.playback.animation;
    const frame = frames[0];
    const columns = Math.ceil(this.app.screen.width / cell);
    const rows = Math.ceil(this.app.screen.height / cell);

    // Draw the first frame where it rests in the view, one canvas pixel per cell.
    const canvas = document.createElement("canvas");
    canvas.width = columns;
    canvas.height = rows;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const width = frame.width * this.fit;
    const height = frame.height * this.fit;
    const centerX = this.stage.position.x + this.restingCenterX(entry, frame.width) * this.fit;
    const top = this.stage.position.y + (this.manifest.canvas.height - frame.height) * this.fit;
    context.scale(1 / cell, 1 / cell);
    if (this.facesLeft()) {
      context.translate(centerX * 2, 0);
      context.scale(-1, 1);
    }
    for (let index = 0; index < frames.length; index += 1) {
      context.drawImage(
        image,
        index * frame.width,
        0,
        frame.width,
        frame.height,
        centerX - width / 2,
        top,
        width,
        height,
      );
    }
    for (const layer of layers) {
      const layerFrame = layer.frames[0];
      const layerWidth = layerFrame.width * this.fit * layer.definition.scaleX;
      const layerHeight = layerFrame.height * this.fit * layer.definition.scaleY;
      const layerCenterX = centerX + layer.definition.x * this.fit;
      const layerTop = this.stage.position.y + (this.manifest.canvas.height + layer.definition.y - layerFrame.height) * this.fit;
      for (let index = 0; index < layer.frames.length; index += 1) {
        context.drawImage(
          layer.image,
          index * layerFrame.width,
          0,
          layerFrame.width,
          layerFrame.height,
          layerCenterX - layerWidth / 2,
          layerTop,
          layerWidth,
          layerHeight,
        );
      }
    }

    const pixels = context.getImageData(0, 0, columns, rows).data;
    const cells = Array.from({ length: columns * rows }, (_, index) => pixels[index * 4 + 3] > OPAQUE_ALPHA);
    return { columns, rows, cells };
  }

  /** Resizes again whenever the window moves to a screen with another pixel ratio. */
  private watchPixelRatio(): void {
    this.stopWatchingRatio?.();
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => {
      this.resize(this.host.clientWidth, this.host.clientHeight);
      this.watchPixelRatio();
    };
    query.addEventListener("change", onChange, { once: true });
    this.stopWatchingRatio = () => query.removeEventListener("change", onChange);
  }

  destroy(): void {
    this.stopWatchingRatio?.();
    this.stopWatchingRatio = null;
    this.playback = null;
    if (!this.app) return;
    this.app.ticker.remove(this.update);
    this.app.destroy({ removeView: true }, { children: true });
    this.app = null;
    for (const textures of this.customTextures.values()) for (const texture of textures) this.releaseCustomTexture(texture);
    this.customTextures.clear();
    for (const sheet of this.sheets.values()) {
      // A sheet that failed to load has nothing to release.
      sheet.then(({ texture }) => texture.destroy(true)).catch(() => {});
    }
    this.sheets.clear();
  }

  private releaseCustomTexture(owned: { texture: Texture; frames: Texture[] }): void {
    for (const frame of owned.frames) frame.destroy();
    owned.texture.destroy(true);
  }

  private async loadAnimation(pack: AssetPack, entry: AnimationEntry): Promise<void> {
    try {
      const { image, texture } = await this.loadSheet(pack.resolve(entry.file));
      const layers = await Promise.all(entry.layers.map(async (definition) => {
        const loaded = await this.loadSheet(pack.resolve(definition.file));
        return { definition, frames: sliceFrames(loaded.texture, definition.frames), image: loaded.image };
      }));
      const animation = { entry, motionSpeed: entry.motionSpeed, motionStrength: entry.motionStrength, frames: sliceFrames(texture, entry.frames), image, layers };
      this.animations.set(entry.id, animation);
      this.originalAnimations.set(entry.id, animation);
    } catch (error) {
      // A missing asset is expected to be recoverable: the action falls back.
      console.warn(`Animation "${entry.id}" is unavailable: could not load its configured image layers`, error);
    }
  }

  private loadSheet(url: string): Promise<{ image: HTMLImageElement; texture: Texture }> {
    const cached = this.sheets.get(url);
    if (cached) return cached;
    const sheet = loadImage(url).then((image) => ({ image, texture: Texture.from(image) }));
    this.sheets.set(url, sheet);
    return sheet;
  }

  /** Whether the drawing shows flipped: the edge mirroring and the action's own facing cancel out when both apply. */
  private facesLeft(): boolean {
    return this.mirrored !== this.flipped;
  }

  /** Horizontal center of the drawing on the stage, before any motion. */
  private restingCenterX(entry: AnimationEntry, frameWidth: number): number {
    const canvasWidth = this.manifest?.canvas.width ?? 0;
    const centerX = entry.align === "left" ? frameWidth / 2 : canvasWidth / 2;
    return this.mirrored ? canvasWidth - centerX : centerX;
  }

  private readonly update = (ticker: Ticker): void => {
    if (!this.playback) return;
    this.playback = { ...this.playback, elapsedMs: this.playback.elapsedMs + ticker.deltaMS };
    this.draw();
  };

  private draw(): void {
    if (!this.playback || !this.manifest) return;
    const { animation, elapsedMs } = this.playback;
    const { entry, frames } = animation;

    const frameNumber = Math.floor((elapsedMs / 1000) * entry.fps);
    const frameIndex = entry.loop ? frameNumber % frames.length : Math.min(frameNumber, frames.length - 1);
    this.sprite.texture = frames[frameIndex];

    const progress = entry.duration ? Math.min(1, elapsedMs / entry.duration) : (elapsedMs % 2000) / 2000;
    const reduceMotion = this.reducedMotion.matches;
    const sampled = sampleAdjustedMotion(calmMotion(entry.motion, reduceMotion), elapsedMs / 1000, progress, animation.motionSpeed ?? 1, animation.motionStrength ?? 1);
    const motion = this.settleFrom ? settleMotion(this.settleFrom, sampled, elapsedMs) : sampled;
    this.lastMotion = motion;
    const facing = this.facesLeft() ? -1 : 1;
    const centerX = this.restingCenterX(entry, frames[frameIndex].width);
    this.sprite.position.set(centerX + motion.x * facing, this.manifest.canvas.height + motion.y);
    this.sprite.scale.set(motion.scaleX * facing, motion.scaleY);
    this.sprite.rotation = motion.rotation * facing;
    this.sprite.alpha = motion.alpha;

    for (const layer of this.layerSprites) {
      const layerTime = layerElapsedSeconds(layer.definition, elapsedMs / 1000, frames.length, entry.fps, entry.loop);
      const layerFrameNumber = Math.floor(layerTime * layer.definition.fps);
      const layerFrameIndex = entry.loop
        ? layerFrameNumber % layer.frames.length
        : Math.min(layerFrameNumber, layer.frames.length - 1);
      layer.sprite.texture = layer.frames[layerFrameIndex];
      const layerProgress = layerMotionProgress(layer.definition, layerTime, frames.length, entry.fps, progress);
      const layerMotion = sampleMotion(calmMotion(layer.definition.motion, reduceMotion), layerTime, layerProgress);
      layer.sprite.position.set(
        centerX + (motion.x + layer.definition.x + layerMotion.x) * facing,
        this.manifest.canvas.height + motion.y + layer.definition.y + layerMotion.y,
      );
      layer.sprite.scale.set(
        motion.scaleX * layer.definition.scaleX * layerMotion.scaleX * facing,
        motion.scaleY * layer.definition.scaleY * layerMotion.scaleY,
      );
      layer.sprite.rotation = (motion.rotation + layer.definition.rotation + layerMotion.rotation) * facing;
      layer.sprite.alpha = motion.alpha * layerMotion.alpha;
      layer.sprite.visible = isLayerVisible(layer.definition, frameIndex, frames.length);
    }
  }

  private clearLayerSprites(): void {
    for (const layer of this.layerSprites) {
      this.scene.removeChild(layer.sprite);
      layer.sprite.destroy();
    }
    this.layerSprites.length = 0;
  }
}

/** How often an action needs drawing: the nap and a still, breathing picture less than the rest. */
function maxFps(animationId: string, { entry, frames, layers }: { entry: { motion?: string }; frames: readonly unknown[]; layers: readonly unknown[] }): number {
  if (animationId === SLEEP_ACTION) return SLEEP_MAX_FPS;
  return frames.length === 1 && layers.length === 0 && CALM_MOTIONS.has(entry.motion) ? CALM_MAX_FPS : MAX_FPS;
}
