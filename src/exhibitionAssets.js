import manifest from "./assets/exhibition/victorian-cabinet-hall/manifest.json";
import subtlePlaster from "./assets/exhibition/victorian-cabinet-hall/walls/subtle-plaster-overlay.svg?raw";
import ornateGoldFrame from "./assets/exhibition/victorian-cabinet-hall/frames/realistic/ornate-gold-9slice.webp";
import carvedWoodFrame from "./assets/exhibition/victorian-cabinet-hall/frames/realistic/carved-dark-wood-9slice.webp";
import blackGalleryFrame from "./assets/exhibition/victorian-cabinet-hall/frames/realistic/black-gallery-9slice.webp";
import warmWhiteMatFrame from "./assets/exhibition/victorian-cabinet-hall/frames/realistic/warm-white-mat-9slice.webp";
import walnutWallShelf from "./assets/exhibition/victorian-cabinet-hall/furniture/walnut-wall-shelf.webp";
import limestonePedestal from "./assets/exhibition/victorian-cabinet-hall/furniture/limestone-pedestal.webp";
import realisticPlaster from "./assets/exhibition/victorian-cabinet-hall/walls/realistic/warm-plaster.webp";
import realisticLinen from "./assets/exhibition/victorian-cabinet-hall/walls/realistic/linen-wallcovering.webp";
import realisticWallpaper from "./assets/exhibition/victorian-cabinet-hall/walls/realistic/victorian-botanical.webp";
import lowOakWainscot from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/low-oak-wainscot.webp";
import walnutSquareWainscot from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/walnut-square-wainscot.webp";
import carvedMahoganyWainscot from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/carved-mahogany-wainscot.webp";
import greenFabricWainscot from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/green-fabric-wainscot.webp";
import burgundyFabricWainscot from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/burgundy-fabric-wainscot.webp";
import whiteClassicalWainscot from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/white-classical-wainscot.webp";
import blackMuseumWainscot from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/black-museum-wainscot.webp";
import simpleWhiteUpperStrip from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/simple-white-upper-strip.webp";
import gildedUpperStrip from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/gilded-upper-strip.webp";
import darkWalnutUpperStrip from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/dark-walnut-upper-strip.webp";
import simpleWhiteRail from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/simple-white-rail.webp";
import darkWalnutRail from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/dark-walnut-rail.webp";
import carvedMahoganyRail from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/carved-mahogany-rail.webp";
import antiqueBrassRail from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/antique-brass-rail.webp";
import realisticTuscanEntablature from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/tuscan-entablature.webp";
import realisticDoricEntablature from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/doric-entablature.webp";
import realisticIonicEntablature from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/ionic-entablature.webp";
import realisticCorinthianEntablature from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/corinthian-entablature.webp";
import realisticCompositeEntablature from "./assets/exhibition/victorian-cabinet-hall/architecture/realistic/continuous/composite-entablature.webp";

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
    plaster: realisticPlaster,
    linen: realisticLinen,
    wallpaper: realisticWallpaper
  }),
  architecture: Object.freeze({
    crownMolding: simpleWhiteUpperStrip,
    upperStrips: Object.freeze({
      "simple-crown": simpleWhiteUpperStrip,
      "gilded-classical": gildedUpperStrip,
      "dark-wood": darkWalnutUpperStrip
    }),
    classicalEntablatures: Object.freeze({
      tuscan: realisticTuscanEntablature,
      doric: realisticDoricEntablature,
      ionic: realisticIonicEntablature,
      corinthian: realisticCorinthianEntablature,
      composite: realisticCompositeEntablature
    }),
    wainscoting: walnutSquareWainscot,
    wainscotings: Object.freeze({
      "low-wood": lowOakWainscot,
      "walnut-square": walnutSquareWainscot,
      "carved-mahogany": carvedMahoganyWainscot,
      "green-fabric": greenFabricWainscot,
      "burgundy-fabric": burgundyFabricWainscot,
      "white-classical": whiteClassicalWainscot,
      "black-museum": blackMuseumWainscot
    }),
    chairRail: darkWalnutRail,
    chairRails: Object.freeze({
      "simple-white": simpleWhiteRail,
      "dark-walnut": darkWalnutRail,
      "carved-mahogany": carvedMahoganyRail,
      brass: antiqueBrassRail
    })
  }),
  frames: Object.freeze({
    "ornate-gold": ornateGoldFrame,
    "dark-wood": carvedWoodFrame,
    "black-gallery": blackGalleryFrame,
    "white-mat": warmWhiteMatFrame
  }),
  furniture: Object.freeze({
    "walnut-wall-shelf": walnutWallShelf,
    "limestone-pedestal": limestonePedestal
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
  })
});

export function exhibitionSegmentTemplate(value) {
  return EXHIBITION_SEGMENT_TEMPLATES[value] || EXHIBITION_SEGMENT_TEMPLATES.horizontal;
}

function builtInFrame(asset, slice, thicknessPercent, insetPercent, matInsetPercent) {
  return Object.freeze({
    asset,
    slice,
    generation: "realistic-v2",
    thicknessPercent,
    border: `clamp(calc(5px * var(--scene-export-scale, 1)), ${thicknessPercent}cqmin, calc(72px * var(--scene-export-scale, 1)))`,
    inset: `clamp(calc(3px * var(--scene-export-scale, 1)), ${insetPercent}cqmin, calc(58px * var(--scene-export-scale, 1)))`,
    matInset: `${matInsetPercent}cqmin`
  });
}

const FRAME_PRESENTATIONS = Object.freeze({
  none: Object.freeze({
    none: true,
    asset: "",
    slice: 0,
    thicknessPercent: 0,
    border: "0px",
    inset: "0px",
    matInset: "0px"
  }),
  "black-gallery": builtInFrame(VICTORIAN_CABINET_HALL.frames["black-gallery"], 190, 5.5, 4.6, 0.8),
  "dark-wood": builtInFrame(VICTORIAN_CABINET_HALL.frames["dark-wood"], 270, 7, 5.8, 0.8),
  "white-mat": builtInFrame(VICTORIAN_CABINET_HALL.frames["white-mat"], 245, 4.5, 3.7, 4.2),
  "ornate-gold": builtInFrame(VICTORIAN_CABINET_HALL.frames["ornate-gold"], 265, 8.5, 7, 0.9)
});

export function exhibitionFramePresentation(value) {
  return FRAME_PRESENTATIONS[value] || FRAME_PRESENTATIONS["black-gallery"];
}
