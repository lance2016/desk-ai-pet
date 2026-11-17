import { describe, expect, it } from "vitest";
import { ART_CANVAS, ART_FIGURE_HEIGHT, ART_GROUND_GAP } from "../assets/ArtPrompt";
import { cropFromPlacement, fittedPlacement, keptRegion, placementFromCrop, promptPlacement, restingPlacement, unionRect } from "./stagePlacement";

const stage = { width: 620, height: 640 };

describe("stage placement", () => {
  it("turns a placement into the cropper's terms and back", () => {
    const frame = { width: 1024, height: 768 };
    const placement = { left: -40, top: 25, scale: 0.6 };
    const back = placementFromCrop(cropFromPlacement(placement, frame, stage), frame, stage);

    expect(back.left).toBeCloseTo(placement.left);
    expect(back.top).toBeCloseTo(placement.top);
    expect(back.scale).toBeCloseTo(placement.scale);
  });

  it("leaves a picture at stage scale where the pet shows it", () => {
    expect(restingPlacement({ width: 420, height: 580 }, stage, "center")).toEqual({ scale: 1, left: 100, top: 60 });
    expect(restingPlacement({ width: 220, height: 580 }, stage, "left")).toEqual({ scale: 1, left: 0, top: 60 });
  });

  it("gives every picture drawn to the art prompt the same scale, whatever the pose", () => {
    const placement = promptPlacement(ART_CANVAS, stage, "center", 580);
    if (!placement) throw new Error("a square picture should be placed by the prompt");
    const side = ART_CANVAS.height * placement.scale;

    expect(ART_FIGURE_HEIGHT * placement.scale).toBeCloseTo(580);
    // The ground drawn in the picture is the stage's ground.
    expect(placement.top + side - ART_GROUND_GAP * placement.scale).toBeCloseTo(stage.height);
    expect(placement.left + side / 2).toBeCloseTo(stage.width / 2);
    // Twice the pixels, same scale for the character.
    expect(promptPlacement({ width: 2048, height: 2048 }, stage, "center", 580)?.scale).toBeCloseTo(placement.scale / 2);
  });

  it("puts what a left-aligned picture shows against the left edge", () => {
    const placement = promptPlacement(ART_CANVAS, stage, "left", 580, 300);
    expect(placement && placement.left + 300 * placement.scale).toBeCloseTo(0);
  });

  it("does not read a picture of another shape as drawn to the prompt", () => {
    expect(promptPlacement({ width: 1024, height: 1536 }, stage, "center", 580)).toBeNull();
  });

  it("fits what a picture shows into the action's usual frame, on the ground", () => {
    const placement = fittedPlacement({ x: 100, y: 50, width: 400, height: 800 }, { width: 430, height: 580 }, stage, "center");

    expect(placement.scale).toBeCloseTo(580 / 800);
    expect(placement.top + 850 * placement.scale).toBeCloseTo(stage.height);
    expect(placement.left + 300 * placement.scale).toBeCloseTo(stage.width / 2);
  });

  it("keeps the stage around the picture down to the ground, centred", () => {
    expect(keptRegion({ x: 200, y: 100.5, width: 150, height: 300 }, stage, "center")).toEqual({ x: 200, y: 100, width: 220, height: 540 });
  });

  it("keeps a left-aligned picture from the left edge", () => {
    expect(keptRegion({ x: 0, y: 60, width: 230.2, height: 580 }, stage, "left")).toEqual({ x: 0, y: 60, width: 231, height: 580 });
  });

  it("never keeps more than the stage", () => {
    expect(keptRegion({ x: -50, y: -20, width: 900, height: 800 }, stage, "center")).toEqual({ x: 0, y: 0, width: 620, height: 640 });
  });

  it("joins the visible parts of several frames", () => {
    expect(unionRect({ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 30, width: 20, height: 50 })).toEqual({ x: 0, y: 20, width: 40, height: 60 });
    expect(unionRect(null, { x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});
