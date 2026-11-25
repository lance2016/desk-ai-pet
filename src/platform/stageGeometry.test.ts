import { describe, expect, it } from "vitest";
import { clampWindowX, clampWindowY, dockSideAt, monitorUnderPet, offscreenInsets, snappedWindowX, SPEECH_SIDE_OVERHANG, speechSide, STAGE_MARGIN, stageSize, verticalInsets } from "./stageGeometry";

const MONITOR = { left: 0, right: 1000 };
const SIDE = STAGE_MARGIN.side;
const WIDTH = 248 + SIDE * 2;

describe("stage geometry", () => {
  it("adds the margins around the pet", () => {
    expect(stageSize(248, 256)).toEqual({ width: WIDTH, height: STAGE_MARGIN.top + 256 + STAGE_MARGIN.bottom });
  });

  it("keeps the pet on screen while its empty margins may hang off", () => {
    expect(clampWindowX(-500, WIDTH, MONITOR)).toBe(-SIDE);
    expect(clampWindowX(300, WIDTH, MONITOR)).toBe(300);
    expect(clampWindowX(2000, WIDTH, MONITOR)).toBe(1000 - WIDTH + SIDE);
  });

  it("docks only when the pet itself reaches an edge", () => {
    expect(dockSideAt(0, WIDTH, MONITOR)).toBeNull();
    expect(dockSideAt(-SIDE, WIDTH, MONITOR)).toBe("left");
    expect(dockSideAt(1000 - WIDTH + SIDE, WIDTH, MONITOR)).toBe("right");
  });

  it("does not dock at a seam where another monitor continues", () => {
    const main = { left: 0, right: 1000, top: 0, bottom: 800 };
    const external = { left: 1000, right: 2920, top: -200, bottom: 880 };
    const monitors = [main, external];
    expect(dockSideAt(1000 - WIDTH + SIDE, WIDTH, main, monitors)).toBeNull();
    expect(dockSideAt(-SIDE, WIDTH, main, monitors)).toBe("left");
    expect(dockSideAt(1000 - SIDE, WIDTH, external, monitors)).toBeNull();
  });

  it("keeps the pet on screen vertically while the bubble and bar room may hang off", () => {
    const HEIGHT = STAGE_MARGIN.top + 256 + STAGE_MARGIN.bottom;
    const screen = { top: 0, bottom: 900 };
    expect(clampWindowY(-500, HEIGHT, screen)).toBe(-STAGE_MARGIN.top);
    expect(clampWindowY(100, HEIGHT, screen)).toBe(100);
    expect(clampWindowY(2000, HEIGHT, screen)).toBe(900 - HEIGHT + STAGE_MARGIN.bottom);
  });

  it("reports how far the window reaches under the menu bar or the Dock", () => {
    const usable = { top: 25, bottom: 820 };
    expect(verticalInsets(0, 400, usable)).toEqual({ top: 25, bottom: 0 });
    expect(verticalInsets(500, 400, usable)).toEqual({ top: 0, bottom: 80 });
  });

  it("snaps the pet flush against the edge it docks to", () => {
    expect(snappedWindowX("left", WIDTH, MONITOR) + SIDE).toBe(0);
    expect(snappedWindowX("right", WIDTH, MONITOR) + WIDTH - SIDE).toBe(1000);
  });

  it("reports how much of the window is off screen", () => {
    expect(offscreenInsets(-SIDE, WIDTH, MONITOR)).toEqual({ left: SIDE, right: 0 });
    expect(offscreenInsets(100, WIDTH, MONITOR)).toEqual({ left: 0, right: 0 });
    expect(offscreenInsets(1000 - WIDTH + 30, WIDTH, MONITOR)).toEqual({ left: 0, right: 30 });
  });

  describe("monitorUnderPet", () => {
    const LAPTOP = { left: 0, top: 0, right: 1440, bottom: 900 };
    const EXTERNAL = { left: 1440, top: -200, right: 3360, bottom: 880 };
    const ABOVE = { left: 0, top: -1080, right: 1920, bottom: 0 };
    const HEIGHT = STAGE_MARGIN.top + 256 + STAGE_MARGIN.bottom;

    it("picks the monitor the pet was dropped on, not the one it came from", () => {
      expect(monitorUnderPet({ x: 1500, y: 100, width: WIDTH, height: HEIGHT }, [LAPTOP, EXTERNAL])).toBe(EXTERNAL);
      expect(monitorUnderPet({ x: 100, y: 100, width: WIDTH, height: HEIGHT }, [LAPTOP, EXTERNAL])).toBe(LAPTOP);
    });

    it("goes by the middle of the pet when it straddles two monitors", () => {
      const window = { y: 100, width: WIDTH, height: HEIGHT };
      expect(monitorUnderPet({ ...window, x: 1440 - WIDTH / 2 - 10 }, [LAPTOP, EXTERNAL])).toBe(LAPTOP);
      expect(monitorUnderPet({ ...window, x: 1440 - WIDTH / 2 + 10 }, [LAPTOP, EXTERNAL])).toBe(EXTERNAL);
    });

    it("looks at height too, for monitors stacked on top of each other", () => {
      expect(monitorUnderPet({ x: 100, y: -600, width: WIDTH, height: HEIGHT }, [LAPTOP, ABOVE])).toBe(ABOVE);
    });

    it("falls back to the nearest monitor when the pet is between them", () => {
      expect(monitorUnderPet({ x: 1500, y: -900, width: WIDTH, height: HEIGHT }, [LAPTOP, EXTERNAL])).toBe(EXTERNAL);
      expect(monitorUnderPet({ x: 0, y: 0, width: WIDTH, height: HEIGHT }, [])).toBeNull();
    });
  });
});

describe("speechSide", () => {
  const head = { left: 44, right: 56 };
  const onScreen = { left: 0, right: 0, top: 0, bottom: 0 };

  it("keeps the bubble above the head while there is room up there", () => {
    expect(speechSide(onScreen, head, null)).toBeNull();
    expect(speechSide({ ...onScreen, top: SPEECH_SIDE_OVERHANG }, head, null)).toBeNull();
  });

  it("moves it beside the head under the menu bar, to the side with more room", () => {
    const underMenuBar = { ...onScreen, top: STAGE_MARGIN.top };
    expect(speechSide(underMenuBar, head, null)).toBe("right");
    expect(speechSide({ ...underMenuBar, right: 40 }, head, null)).toBe("left");
    expect(speechSide({ ...underMenuBar, left: 40 }, { left: 56, right: 44 }, null)).toBe("right");
  });

  it("keeps the bubble above a pet peeking from an edge while there is room", () => {
    expect(speechSide(onScreen, head, "left")).toBeNull();
  });

  it("speaks from the side away from the edge when a peeking pet is under the menu bar", () => {
    expect(speechSide({ ...onScreen, top: STAGE_MARGIN.top }, head, "left")).toBe("right");
    expect(speechSide({ ...onScreen, top: STAGE_MARGIN.top }, head, "right")).toBe("left");
  });
});
