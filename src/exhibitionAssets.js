import manifest from "./assets/exhibition/victorian-cabinet-hall/manifest.json";
import subtlePlaster from "./assets/exhibition/victorian-cabinet-hall/walls/subtle-plaster-overlay.svg?raw";
import warmPlaster from "./assets/exhibition/victorian-cabinet-hall/walls/warm-plaster.svg?raw";
import linenCloth from "./assets/exhibition/victorian-cabinet-hall/walls/linen-cloth.svg?raw";
import victorianDamask from "./assets/exhibition/victorian-cabinet-hall/walls/victorian-damask.svg?raw";
import crownMolding from "./assets/exhibition/victorian-cabinet-hall/architecture/crown-molding.svg?raw";
import carvedWainscoting from "./assets/exhibition/victorian-cabinet-hall/architecture/carved-wainscoting.svg?raw";
import chairRail from "./assets/exhibition/victorian-cabinet-hall/architecture/chair-rail.svg?raw";
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
    chairRail: svgDataUrl(chairRail)
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

const FRAME_PRESENTATIONS = Object.freeze({
  "black-gallery": Object.freeze({ asset: VICTORIAN_CABINET_HALL.frames["black-gallery"], slice: 72, border: "1.15cqw", inset: "1.05cqw", matInset: ".48cqw" }),
  "dark-wood": Object.freeze({ asset: VICTORIAN_CABINET_HALL.frames["dark-wood"], slice: 92, border: "1.8cqw", inset: "1.48cqw", matInset: ".5cqw" }),
  "white-mat": Object.freeze({ asset: VICTORIAN_CABINET_HALL.frames["white-mat"], slice: 72, border: ".72cqw", inset: ".66cqw", matInset: "1.65cqw" }),
  "ornate-gold": Object.freeze({ asset: VICTORIAN_CABINET_HALL.frames["ornate-gold"], slice: 92, border: "1.95cqw", inset: "1.62cqw", matInset: ".52cqw" })
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
