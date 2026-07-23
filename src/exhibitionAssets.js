import manifest from "./assets/exhibition/victorian-cabinet-hall/manifest.json";
import subtlePlaster from "./assets/exhibition/victorian-cabinet-hall/walls/subtle-plaster-overlay.svg?raw";
import warmPlaster from "./assets/exhibition/victorian-cabinet-hall/walls/warm-plaster.svg?raw";
import linenCloth from "./assets/exhibition/victorian-cabinet-hall/walls/linen-cloth.svg?raw";
import victorianDamask from "./assets/exhibition/victorian-cabinet-hall/walls/victorian-damask.svg?raw";
import crownMolding from "./assets/exhibition/victorian-cabinet-hall/architecture/crown-molding.svg?raw";
import carvedWainscoting from "./assets/exhibition/victorian-cabinet-hall/architecture/carved-wainscoting.svg?raw";
import chairRail from "./assets/exhibition/victorian-cabinet-hall/architecture/chair-rail.svg?raw";
import vaultedArch from "./assets/exhibition/victorian-cabinet-hall/architecture/vaulted-arch.svg?raw";
import brassSconce from "./assets/exhibition/victorian-cabinet-hall/lighting/brass-sconce.svg?raw";
import warmLightWash from "./assets/exhibition/victorian-cabinet-hall/lighting/warm-light-wash.svg?raw";
import ornateGoldFrame from "./assets/exhibition/victorian-cabinet-hall/frames/ornate-gold-9slice.svg?raw";
import carvedWoodFrame from "./assets/exhibition/victorian-cabinet-hall/frames/carved-dark-wood-9slice.svg?raw";
import blackGalleryFrame from "./assets/exhibition/victorian-cabinet-hall/frames/black-gallery-9slice.svg?raw";
import warmWhiteMatFrame from "./assets/exhibition/victorian-cabinet-hall/frames/warm-white-mat-9slice.svg?raw";

function svgDataUrl(source) {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export function cssAssetUrl(value) {
  return `url("${value}")`;
}

export const VICTORIAN_CABINET_HALL = Object.freeze({
  manifest,
  scene: Object.freeze({ ...manifest.scene }),
  walls: Object.freeze({
    plain: svgDataUrl(subtlePlaster),
    plaster: svgDataUrl(warmPlaster),
    linen: svgDataUrl(linenCloth),
    wallpaper: svgDataUrl(victorianDamask)
  }),
  architecture: Object.freeze({
    crownMolding: svgDataUrl(crownMolding),
    wainscoting: svgDataUrl(carvedWainscoting),
    chairRail: svgDataUrl(chairRail),
    vaultedArch: svgDataUrl(vaultedArch)
  }),
  lighting: Object.freeze({
    brassSconce: svgDataUrl(brassSconce),
    lightWash: svgDataUrl(warmLightWash)
  }),
  frames: Object.freeze({
    "ornate-gold": svgDataUrl(ornateGoldFrame),
    "dark-wood": svgDataUrl(carvedWoodFrame),
    "black-gallery": svgDataUrl(blackGalleryFrame),
    "white-mat": svgDataUrl(warmWhiteMatFrame)
  })
});

export const EXHIBITION_SEGMENT_TEMPLATES = Object.freeze({
  horizontal: Object.freeze({
    id: "horizontal",
    width: 1920,
    height: 1080,
    safe: Object.freeze({ top: 8, right: 4.5, bottom: 6, left: 4.5 }),
    plaqueTop: 13.2,
    plaqueSide: 7,
    lightsTop: 8.7,
    lightsSide: 5.4,
    defaultPlacement: Object.freeze({ x: 8, y: 10, width: 19, height: 40 })
  }),
  vertical: Object.freeze({
    id: "vertical",
    width: 1080,
    height: 1600,
    safe: Object.freeze({ top: 10, right: 8, bottom: 8, left: 8 }),
    plaqueTop: 11,
    plaqueSide: 8,
    lightsTop: 8,
    lightsSide: 7,
    defaultPlacement: Object.freeze({ x: 13, y: 17, width: 30, height: 30 })
  }),
  square: Object.freeze({
    id: "square",
    width: 1400,
    height: 1400,
    safe: Object.freeze({ top: 9, right: 7, bottom: 7, left: 7 }),
    plaqueTop: 12,
    plaqueSide: 8,
    lightsTop: 8,
    lightsSide: 6,
    defaultPlacement: Object.freeze({ x: 10, y: 15, width: 24, height: 34 })
  }),
  monumental: Object.freeze({
    id: "monumental",
    width: 2400,
    height: 1080,
    safe: Object.freeze({ top: 8, right: 4, bottom: 6, left: 4 }),
    plaqueTop: 12,
    plaqueSide: 6,
    lightsTop: 8,
    lightsSide: 4.5,
    defaultPlacement: Object.freeze({ x: 7, y: 10, width: 16, height: 42 })
  }),
  arch: Object.freeze({
    id: "arch",
    width: 1600,
    height: 1400,
    safe: Object.freeze({ top: 21, right: 7, bottom: 8, left: 7 }),
    plaqueTop: 20,
    plaqueSide: 8,
    lightsTop: 20,
    lightsSide: 7,
    defaultPlacement: Object.freeze({ x: 11, y: 15, width: 23, height: 36 })
  })
});

export function exhibitionSegmentTemplate(value) {
  return EXHIBITION_SEGMENT_TEMPLATES[value] || EXHIBITION_SEGMENT_TEMPLATES.horizontal;
}

function builtInFrame(asset, slice, thicknessPercent, insetPercent, matInsetPercent) {
  return Object.freeze({
    asset,
    slice,
    thicknessPercent,
    border: `clamp(calc(5px * var(--scene-export-scale, 1)), ${thicknessPercent}cqmin, calc(72px * var(--scene-export-scale, 1)))`,
    inset: `clamp(calc(3px * var(--scene-export-scale, 1)), ${insetPercent}cqmin, calc(58px * var(--scene-export-scale, 1)))`,
    matInset: `${matInsetPercent}cqmin`
  });
}

const FRAME_PRESENTATIONS = Object.freeze({
  "black-gallery": builtInFrame(VICTORIAN_CABINET_HALL.frames["black-gallery"], 72, 5.5, 4.6, 0.8),
  "dark-wood": builtInFrame(VICTORIAN_CABINET_HALL.frames["dark-wood"], 92, 7, 5.8, 0.8),
  "white-mat": builtInFrame(VICTORIAN_CABINET_HALL.frames["white-mat"], 72, 4.5, 3.7, 4.2),
  "ornate-gold": builtInFrame(VICTORIAN_CABINET_HALL.frames["ornate-gold"], 92, 8.5, 7, 0.9)
});

export function exhibitionFramePresentation(value) {
  return FRAME_PRESENTATIONS[value] || FRAME_PRESENTATIONS["black-gallery"];
}

export const EXHIBITION_DECOR_ASSETS = Object.freeze({
  "small-plant": Object.freeze({ status: "placeholder", asset: null, perspective: "front", lightDirection: "upper-left", contactShadow: false }),
  "tall-palm": Object.freeze({ status: "placeholder", asset: null, perspective: "front", lightDirection: "upper-left", contactShadow: false }),
  "plant-stand": Object.freeze({ status: "placeholder", asset: null, perspective: "front", lightDirection: "upper-left", contactShadow: false }),
  "wooden-bench": Object.freeze({ status: "placeholder", asset: null, perspective: "front", lightDirection: "upper-left", contactShadow: false }),
  "leather-bench": Object.freeze({ status: "placeholder", asset: null, perspective: "front", lightDirection: "upper-left", contactShadow: false }),
  "velvet-bench": Object.freeze({ status: "placeholder", asset: null, perspective: "front", lightDirection: "upper-left", contactShadow: false }),
  "rope-barrier": Object.freeze({ status: "placeholder", asset: null, perspective: "front", lightDirection: "upper-left", contactShadow: false }),
  "sculpture-pedestal": Object.freeze({ status: "placeholder", asset: null, perspective: "front", lightDirection: "upper-left", contactShadow: false })
});

export function exhibitionDecorPresentation(value) {
  return EXHIBITION_DECOR_ASSETS[value] || null;
}
