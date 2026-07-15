import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const api = window.archiveAPI;
let pdfJsPromise = null;
const rendererModuleLoadedAt = performance.now();

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url")
    ]).then(([pdfjsLib, workerModule]) => {
      const workerSrc = workerModule.default || workerModule;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
      if (localStorage.getItem("archiveDebugMedia") === "1") {
        console.log("[attachments:pdf] pdfjs runtime", {
          version: pdfjsLib.version || "unknown",
          hasUint8ArrayToHex: typeof Uint8Array.prototype.toHex === "function",
          workerSrc
        });
      }
      return pdfjsLib;
    });
  }
  return pdfJsPromise;
}

function perfTraceEnabled() {
  return Boolean(window.__archivePerfTrace || localStorage.getItem("archivePerfTrace") === "1");
}

function perfTrace(event, data = {}) {
  if (!perfTraceEnabled()) return;
  console.log(`[perf-renderer] ${JSON.stringify({
    event,
    t: Math.round(performance.now() * 10) / 10,
    ...data
  })}`);
}

const LANGUAGE_STORAGE_KEY = "collectionArchive.language";
const I18nContext = React.createContext({
  language: "en",
  setLanguage: () => {},
  t: (key, fallback) => fallback || key
});

const translations = {
  en: {
    appTitle: "Collection Archive",
    language: "Language",
    navLibrary: "Library",
    navGallery: "Gallery",
    navAlbums: "Albums",
    navTrash: "Trash",
    newItem: "New item",
    bulkCreateItems: "Bulk create items",
    createMultipleItems: "Create multiple from images",
    bulkCreateHelp: "Each selected image will become one new item.",
    bulkCreateErrors: "Errors",
    manageLists: "Manage lists",
    dataFolder: "Data folder",
    storageBackup: "Storage & backup",
    archiveStorage: "Archive storage",
    storageBackupHelp: "Review archive size and create safe backups.",
    storageUsage: "Storage usage",
    refreshUsage: "Refresh usage",
    archiveDoctor: "Archive Doctor",
    dataHealth: "Data Health",
    archiveDoctorHelp: "Run read-only checks after backup, restore, or large imports. No files are deleted or changed automatically.",
    runHealthCheck: "Run health check",
    exportHealthReport: "Export health report",
    healthReportExported: "Health report exported.",
    regenerateThumbnails: "Regenerate thumbnails",
    healthCheckComplete: "Health check complete.",
    healthCheckFailed: "Health check failed.",
    okItems: "OK checks",
    warnings: "Warnings",
    missingFiles: "Missing files",
    orphanFiles: "Orphan files",
    affectedSize: "Affected size",
    healthDetails: "Health details",
    noHealthIssues: "No health issues found.",
    thumbnailHealth: "Thumbnail cache",
    canRegenerateThumbnails: "Thumbnails can be regenerated from source images.",
    cannotRegenerateAllThumbnails: "Some source images are missing, so not every thumbnail can be regenerated.",
    database: "Database",
    images: "Images",
    thumbnails: "Thumbnails",
    captures: "Captures",
    tempCache: "Temp/cache",
    total: "Total",
    metadataBackup: "Metadata-only backup",
    metadataBackupHelp: "Backs up the database, settings, albums, layouts, and item metadata. Images, thumbnails, and attachments are excluded.",
    fullBackup: "Full backup",
    fullBackupHelp: "Copies the database, images, attachments, and captures. Thumbnails and temp/cache folders are excluded.",
    fullBackupWarning: "Full backups can be very large. Choose a drive with enough free space.",
    backupCreated: "Backup created.",
    backupCanceled: "Backup canceled.",
    backupFailed: "Backup failed.",
    restoreBackup: "Restore backup...",
    loadBackup: "Load backup...",
    restoreBackupHelp: "Validate a backup folder, preview what it contains, then replace the current archive after an automatic pre-restore backup.",
    restorePreview: "Restore preview",
    backupType: "Backup type",
    createdAt: "Created",
    appVersion: "App version",
    currentDataAffected: "Current data affected",
    itemCount: "Item count",
    imageMetadataCount: "Image metadata count",
    albumCount: "Album count",
    mediaFolders: "Media folders",
    included: "Included",
    missing: "Missing",
    integrityCheck: "Integrity check",
    foreignKeyWarnings: "Foreign key warnings",
    metadataRestoreWarning: "This is a metadata-only backup. Images, attachments, and captures are not included and may appear missing after restore.",
    fullRestoreWarning: "This will replace the current database and media folders with the selected backup.",
    confirmRestoreBackup: "Restore this backup? Current data will be protected in a pre-restore folder before replacement.",
    restoreCompleted: "Backup restored. Reloading archive...",
    restoreFailed: "Restore failed.",
    preRestoreBackup: "Pre-restore backup",
    openDataFolder: "Open Data Folder",
    openingArchive: "Opening archive...",
    loadingDatabase: "Loading database...",
    loadingLibrary: "Loading library...",
    preparingInterface: "Preparing workspace...",
    ready: "Ready",
    startupFailed: "Startup failed",
    retry: "Retry",
    loadingLibraryItems: "Loading library items...",
    loadingGalleryItems: "Loading gallery...",
    loadingAlbum: "Loading album...",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    search: "Search",
    preview: "Preview",
    export: "Export",
    duplicate: "Duplicate",
    copy: "Copy",
    moveUp: "Up",
    moveDown: "Down",
    libraryTitle: "Library",
    libraryCount: "Showing {shown} of {total} matching items",
    searchPlaceholder: "Search title, description, source, condition...",
    clearSearch: "Clear search",
    favorites: "Favorites",
    allIssuingEntities: "All issuing entities",
    allEntityGroups: "All entity groups",
    allTypes: "All types",
    year: "Year",
    tagsComma: "Tags, comma-separated",
    multiTagsHint: "Use commas for multiple tags",
    clearFilters: "Clear filters",
    selectedCount: "{count} selected",
    editSelected: "Edit selected",
    addSelectedToAlbum: "Add to album",
    moveSelectedToTrash: "Move to trash",
    clearSelection: "Clear selection",
    bulkEditItems: "Bulk edit items",
    fieldModeUnchanged: "Unchanged",
    fieldModeReplace: "Replace",
    tagModeAdd: "Add tags",
    tagModeRemove: "Remove tags",
    tagModeReplace: "Replace tags",
    applyBulkEdit: "Apply bulk edit",
    bulkEditApplied: "Bulk edit applied.",
    bulkCreateSummary: "Created {created} items. Failed {failed}.",
    chooseImages: "Choose images",
    titlePrefix: "Title prefix",
    titleSuffix: "Title suffix",
    imageNote: "Image note",
    imageNotePlaceholder: "front, back, seller photo, needs rescan...",
    imageNoteSaved: "Image note saved.",
    technicalDetails: "Technical details",
    attachments: "Attachments",
    addAttachment: "Add attachment",
    localFile: "Local file",
    webpageUrl: "Webpage URL",
    addWebpageAttachment: "Add webpage attachment",
    attachmentDialogHelp: "Attach a local file or save a webpage reference.",
    localAttachmentHelp: "Add PDFs, audio, video, documents, archives, or other reference files.",
    executableBlockedHint: "Executable and script files are blocked.",
    chooseFile: "Choose file",
    sourceUrl: "Source URL",
    openUrl: "Open URL",
    capturedAt: "Captured",
    attachmentMode: "Mode",
    saveUrl: "Save URL",
    saveUrlOnly: "Save URL only",
    saveAsPdfSnapshot: "Save as PDF snapshot",
    webpageAttachmentHelp: "Save a link, or capture the current webpage as a PDF snapshot.",
    capturePdf: "Capture PDF",
    captureWebpagePdf: "Capture webpage PDF",
    openFile: "Open file",
    view: "View",
    previewAttachment: "Preview attachment",
    removeAttachment: "Remove attachment",
    note: "Note",
    fileType: "File type",
    fileSize: "File size",
    imported: "Imported",
    noAttachmentsYet: "No attachments yet",
    previewUnavailable: "Preview unavailable",
    playbackUnavailable: "Playback unavailable",
    pdfPreviewUnavailable: "PDF preview unavailable",
    loadingPdf: "Loading PDF...",
    previousPage: "Previous page",
    nextPage: "Next page",
    pageLabel: "Page",
    of: "of",
    fitWidth: "Fit width",
    pdfZoomIn: "Zoom in",
    pdfZoomOut: "Zoom out",
    pdfActualSize: "Actual size",
    reload: "Reload",
    attachmentSaved: "Attachment saved.",
    attachmentRemoved: "Attachment removed.",
    labelCards: "Label Cards",
    noLabelCardsYet: "No label cards yet",
    newLabelCard: "New card",
    saveLabelCard: "Save card",
    deleteLabelCard: "Delete card",
    exportCardPng: "Export PNG",
    exporting: "Exporting...",
    saving: "Saving...",
    exportCanceled: "Export canceled.",
    exportCardFailed: "Card export failed.",
    cardExported: "Card exported.",
    cardSaved: "Card saved.",
    cardDeleted: "Card deleted.",
    cardSubtitle: "Subtitle",
    cardMainText: "Main text",
    smallNotes: "Small notes",
    provenanceText: "Provenance/source text",
    catalogText: "Catalog/reference text",
    imagePosition: "Image position",
    topImage: "Top image",
    leftImage: "Left image",
    rightImage: "Right image",
    imageOnlyCaption: "Image only + caption",
    textOnly: "Text only",
    centeredShowcase: "Centered showcase",
    stampExhibitionCard: "Stamp Exhibition Card",
    museumSpecimenCard: "Museum Specimen Card",
    museumLabel: "Museum Label",
    classicAlbumCard: "Classic Album Card",
    auctionNote: "Auction Lot Card",
    minimalCard: "Minimal Modern Card",
    vintagePaperCard: "Vintage Paper Card",
    resetStyleToPreset: "Reset style to preset defaults",
    borderOn: "Border on",
    backgroundTone: "Background tone",
    editLabelCard: "Edit",
    labelCardEditor: "Label Card Editor",
    cardContent: "Content",
    cardLayout: "Layout",
    cardStyle: "Style",
    cardExport: "Export",
    cardPreset: "Card type",
    cardSize: "Card size",
    smallTicket: "Small ticket",
    a6Landscape: "A6 landscape",
    a6Portrait: "A6 portrait",
    squareShareCard: "Square share card",
    socialShareLandscape: "Social share landscape",
    classicStampSlip: "Classic Stamp Album Slip",
    coinCabinetTicket: "Coin Cabinet Ticket",
    exhibitionShareCard: "Exhibition Share Card",
    minimalArchiveCard: "Minimal Archive Card",
    primaryImage: "Primary image",
    reverseImage: "Reverse / second image",
    exportScale: "Export scale",
    exportHelp: "Export the card exactly as shown in the preview.",
    cardPreview: "Card preview",
    materialSurface: "Material / surface",
    creamAlbumPaper: "Cream album paper",
    archivalCardStock: "Archival card stock",
    agedPaper: "Aged paper",
    linenTexture: "Linen texture",
    whiteMuseumBoard: "White museum board",
    darkWalnutWood: "Dark walnut wood",
    mahoganyWood: "Mahogany wood",
    blackVelvet: "Black velvet",
    greenFelt: "Green felt",
    textureIntensity: "Texture intensity",
    brightness: "Brightness",
    agingLevel: "Aging level",
    presentationFrame: "Presentation frame",
    thinDoubleAlbumFrame: "Thin double-line album frame",
    blackStampMount: "Black stamp mount",
    creamMatWindow: "Cream mat window",
    transparentMount: "Transparent mount effect",
    circularCoinRecess: "Circular coin recess",
    capsuleRim: "Capsule rim",
    velvetTray: "Velvet tray",
    woodenCabinetSlot: "Wooden cabinet slot",
    obverseReverseFrame: "Obverse/reverse double frame",
    classicGoldFrame: "Classic gold frame",
    darkWoodFrame: "Dark wood frame",
    blackGalleryFrame: "Black gallery frame",
    whiteMatFrame: "White mat frame",
    cardEdge: "Card edge",
    squareEdge: "Square",
    roundedEdge: "Rounded",
    clippedCorners: "Clipped corners",
    doubleLineEdge: "Double-line edge",
    embossedEdge: "Embossed edge",
    thinGoldEdge: "Thin gold edge",
    ticketPerforation: "Ticket perforation",
    deckledEdge: "Deckled paper edge",
    centeredSingleImage: "Centered single image",
    imageTopTextBelow: "Image top, text below",
    imageLeftTextRight: "Image left, text right",
    obverseReversePair: "Obverse / reverse pair",
    mainImageDetailImage: "Main image + detail image",
    textOnlyArchivalLabel: "Text-only archival label",
    frontSide: "Front",
    backSide: "Back",
    acquisitionNotes: "Acquisition notes",
    researchNotes: "Research notes",
    trashTitle: "Trash",
    trashEmpty: "Trash is empty",
    restore: "Restore",
    permanentlyDelete: "Delete permanently",
    emptyTrash: "Empty trash",
    movedToTrash: "Moved to trash.",
    restoredFromTrash: "Restored from trash.",
    permanentlyDeleted: "Permanently deleted.",
    addAllImagesToAlbum: "Add all images to album",
    addSelectedFirstImages: "Add first image from selected",
    addSelectedAllImages: "Add all images from selected",
    albumTarget: "Target album page",
    columns: "Columns",
    spacing: "Spacing",
    useCoverImage: "Use cover image",
    useAllImages: "Use all images",
    bulkAlbumAdded: "Added {added} placements. Skipped {skipped}.",
    noIssuingEntity: "No issuing entity",
    noType: "No type",
    noYear: "No year",
    loading: "Loading...",
    loadMoreItems: "Load more items",
    noItemsMatch: "No items match these filters",
    galleryTitle: "Gallery",
    gallerySubtitle: "Visual browse mode",
    details: "Details",
    loadMoreGallery: "Load more gallery items",
    noItemImages: "No item images yet",
    back: "Back",
    selectItem: "Select an item from the library",
    openViewer: "Open viewer",
    previous: "Previous",
    next: "Next",
    closeViewer: "Close viewer",
    addImages: "Add images",
    importFromPhone: "Import from phone",
    phoneUpload: "Phone upload",
    phoneUploadTarget: "Uploads will be added to current item: {title}",
    phoneUploadHint: "Open this URL on a phone connected to the same Wi-Fi. Windows Firewall may ask for permission the first time.",
    phoneUploadUrl: "Upload URL",
    stopPhoneUpload: "Stop upload",
    uploadedPhotos: "{count} uploaded",
    waitingForPhone: "Waiting for phone...",
    noLanAddress: "No LAN address found. Check that this computer is connected to Wi-Fi.",
    phoneUploadStarted: "Phone upload started.",
    phoneUploadStopped: "Phone upload stopped.",
    lastUpload: "Last upload",
    metadata: "Metadata",
    replaceImage: "Replace image",
    removeImage: "Remove image",
    regenerateThumbnail: "Regenerate thumbnail",
    regenerateItemThumbnails: "Regenerate item thumbnails",
    thumbnailsRegenerated: "Thumbnails regenerated.",
    saveChanges: "Save changes",
    albumsTitle: "Albums",
    newAlbum: "New album",
    newShort: "New",
    pagesCount: "{count} pages",
    createAlbumPrompt: "Create an album to get started.",
    chooseAlbum: "Choose an album",
    albumName: "Album name",
    description: "Description",
    saveAlbum: "Save album",
    deleteAlbum: "Delete album",
    pageSelector: "Page selector",
    pageActions: "Page actions",
    exportActions: "Export actions",
    more: "More",
    selectedObject: "Selected object",
    textStyle: "Text style",
    frame: "Frame",
    movePageUp: "Move page up",
    movePageDown: "Move page down",
    addPage: "Add page",
    duplicatePage: "Duplicate page",
    copyPageToAlbum: "Copy page to album...",
    copyToAlbum: "Copy to album",
    noOtherAlbums: "No other albums",
    pageDuplicated: "Page duplicated.",
    pageCopied: "Page copied to album.",
    digitalAlbum: "Digital album",
    designedPage: "Designed page",
    cleanPreview: "Clean preview",
    exportPage: "Export page",
    exportPdf: "Export PDF",
    pdfQuality: "PDF quality",
    originalQuality: "Original quality",
    highQuality: "High",
    mediumQuality: "Medium",
    lowQuality: "Low",
    noPagesYet: "No pages yet",
    addItem: "Add item",
    addText: "Add text",
    zoomOut: "Zoom -",
    zoomIn: "Zoom +",
    fitPage: "Fit page",
    actualSize: "100%",
    savePage: "Save page",
    deletePage: "Delete page",
    undo: "Undo",
    redo: "Redo",
    pageSettings: "Page settings",
    page: "Page",
    pageTitle: "Page title",
    paperSize: "Paper size",
    backgroundColor: "Background color",
    setBackgroundImage: "Set background image",
    clearBackground: "Clear background",
    showBackgroundImage: "Show background image",
    opacity: "Opacity",
    backgroundFit: "Background fit",
    showGuides: "Show guides",
    snapToGrid: "Snap to grid",
    grid: "Grid",
    gridSize: "Grid size",
    template: "Template",
    applyTemplate: "Apply template",
    font: "Font",
    size: "Size",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    textColor: "Text color",
    background: "Background",
    transparent: "Transparent",
    border: "Border",
    radius: "Radius",
    padding: "Padding",
    lineHeight: "Line height",
    alignment: "Alignment",
    left: "Left",
    center: "Center",
    right: "Right",
    physicalSize: "Physical size",
    widthMm: "Width (mm)",
    heightMm: "Height (mm)",
    applySize: "Apply size",
    crop: "Crop",
    cropLeft: "Left",
    cropRight: "Right",
    cropTop: "Top",
    cropBottom: "Bottom",
    resetCrop: "Reset crop",
    cropHelp: "Manual non-destructive crop for this placement only.",
    systemFont: "System",
    serifFont: "Serif",
    sansSerifFont: "Sans Serif",
    monospaceFont: "Monospace",
    newItemTitle: "New item",
    editItemTitle: "Edit item",
    title: "Title",
    issuingEntity: "Issuing Entity",
    type: "Type",
    none: "None",
    condition: "Condition",
    purchasePrice: "Purchase price",
    source: "Source",
    customFields: "Custom fields",
    jsonStyleLines: "JSON-style lines",
    addToFavorites: "Add to favorites",
    removeFromFavorites: "Remove from favorites",
    searchIssuingEntities: "Search issuing entities...",
    clearIssuingEntity: "Clear issuing entity",
    newIssuingEntity: "New issuing entity",
    newCollectionType: "New collection type",
    name: "Name",
    albumPageImageExported: "Album page image exported.",
    albumPdfExported: "Album PDF exported ({quality}).",
    exportFailed: "Export failed: {message}"
  },
  zh: {
    appTitle: "收藏档案",
    language: "语言",
    navLibrary: "馆藏",
    navGallery: "图库",
    navAlbums: "册页",
    newItem: "新建藏品",
    manageLists: "管理列表",
    dataFolder: "数据文件夹",
    openingArchive: "正在打开档案...",
    save: "保存",
    cancel: "取消",
    close: "关闭",
    add: "添加",
    edit: "编辑",
    delete: "删除",
    search: "搜索",
    preview: "预览",
    export: "导出",
    duplicate: "复制",
    copy: "拷贝",
    moveUp: "上移",
    moveDown: "下移",
    libraryTitle: "馆藏",
    libraryCount: "显示 {shown} / {total} 件匹配藏品",
    searchPlaceholder: "搜索标题、描述、来源、品相...",
    clearSearch: "清除搜索",
    favorites: "收藏",
    allIssuingEntities: "全部发行实体",
    allEntityGroups: "全部实体组",
    allTypes: "全部类型",
    year: "年份",
    tagsComma: "标签，用逗号分隔",
    multiTagsHint: "多个标签请用逗号分隔",
    clearFilters: "清除筛选",
    noIssuingEntity: "无发行实体",
    noType: "无类型",
    noYear: "无年份",
    loading: "加载中...",
    loadMoreItems: "加载更多藏品",
    noItemsMatch: "没有符合筛选的藏品",
    galleryTitle: "图库",
    gallerySubtitle: "视觉浏览模式",
    details: "详情",
    loadMoreGallery: "加载更多图库项目",
    noItemImages: "还没有藏品图片",
    back: "返回",
    selectItem: "从馆藏中选择藏品",
    openViewer: "打开查看器",
    previous: "上一张",
    next: "下一张",
    closeViewer: "关闭查看器",
    addImages: "添加图片",
    metadata: "元数据",
    replaceImage: "替换图片",
    removeImage: "删除图片",
    saveChanges: "保存更改",
    albumsTitle: "册页",
    newAlbum: "新建册页",
    newShort: "新建",
    pagesCount: "{count} 页",
    createAlbumPrompt: "创建册页以开始使用。",
    chooseAlbum: "选择册页",
    albumName: "册页名称",
    description: "描述",
    saveAlbum: "保存册页",
    deleteAlbum: "删除册页",
    pageSelector: "页面选择",
    movePageUp: "上移页面",
    movePageDown: "下移页面",
    addPage: "添加页面",
    duplicatePage: "复制页面",
    copyPageToAlbum: "拷贝页面到册页...",
    copyToAlbum: "拷贝到册页",
    noOtherAlbums: "没有其他册页",
    pageDuplicated: "页面已复制。",
    pageCopied: "页面已拷贝到册页。",
    digitalAlbum: "数字册页",
    designedPage: "设计页面",
    cleanPreview: "简洁预览",
    exportPage: "导出页面",
    exportPdf: "导出 PDF",
    pdfQuality: "PDF 质量",
    originalQuality: "原始质量",
    highQuality: "高",
    mediumQuality: "中",
    lowQuality: "低",
    noPagesYet: "还没有页面",
    addItem: "添加藏品",
    addText: "添加文字",
    zoomOut: "缩小",
    zoomIn: "放大",
    fitPage: "适合页面",
    actualSize: "100%",
    savePage: "保存页面",
    deletePage: "删除页面",
    undo: "撤销",
    redo: "重做",
    pageSettings: "页面设置",
    page: "页面",
    pageTitle: "页面标题",
    paperSize: "纸张尺寸",
    backgroundColor: "背景颜色",
    setBackgroundImage: "设置背景图片",
    clearBackground: "清除背景",
    showBackgroundImage: "显示背景图片",
    opacity: "不透明度",
    backgroundFit: "背景适配",
    showGuides: "显示参考线",
    snapToGrid: "吸附到网格",
    gridSize: "网格大小",
    template: "模板",
    applyTemplate: "应用模板",
    font: "字体",
    size: "大小",
    bold: "粗体",
    italic: "斜体",
    underline: "下划线",
    textColor: "文字颜色",
    background: "背景",
    transparent: "透明",
    border: "边框",
    radius: "圆角",
    padding: "内边距",
    lineHeight: "行高",
    alignment: "对齐",
    left: "左",
    center: "居中",
    right: "右",
    systemFont: "系统",
    serifFont: "衬线",
    sansSerifFont: "无衬线",
    monospaceFont: "等宽",
    newItemTitle: "新建藏品",
    editItemTitle: "编辑藏品",
    title: "标题",
    issuingEntity: "发行实体",
    type: "类型",
    none: "无",
    condition: "品相",
    purchasePrice: "购买价格",
    source: "来源",
    customFields: "自定义字段",
    jsonStyleLines: "JSON 风格行",
    addToFavorites: "加入收藏",
    removeFromFavorites: "移出收藏",
    searchIssuingEntities: "搜索发行实体...",
    clearIssuingEntity: "清除发行实体",
    newIssuingEntity: "新建发行实体",
    newCollectionType: "新建收藏类型",
    name: "名称",
    albumPageImageExported: "册页页面图片已导出。",
    albumPdfExported: "册页 PDF 已导出（{quality}）。",
    exportFailed: "导出失败：{message}"
  }
};

translations.zh.pageActions = "\u9875\u9762\u64cd\u4f5c";
translations.zh.exportActions = "\u5bfc\u51fa\u64cd\u4f5c";
translations.zh.more = "\u66f4\u591a";
translations.zh.selectedObject = "\u9009\u4e2d\u5bf9\u8c61";
translations.zh.textStyle = "\u6587\u5b57\u6837\u5f0f";
translations.zh.frame = "\u8fb9\u6846";
translations.zh.grid = "\u7f51\u683c";
translations.zh.storageBackup = "\u5b58\u50a8\u4e0e\u5907\u4efd";
translations.zh.archiveStorage = "\u6863\u6848\u5b58\u50a8";
translations.zh.storageBackupHelp = "\u67e5\u770b\u6863\u6848\u5360\u7528\u7a7a\u95f4\u5e76\u521b\u5efa\u5b89\u5168\u5907\u4efd\u3002";
translations.zh.storageUsage = "\u5b58\u50a8\u5360\u7528";
translations.zh.refreshUsage = "\u5237\u65b0\u5360\u7528";
translations.zh.archiveDoctor = "\u6863\u6848\u533b\u751f";
translations.zh.dataHealth = "\u6570\u636e\u5065\u5eb7";
translations.zh.archiveDoctorHelp = "\u5728\u5907\u4efd\u3001\u6062\u590d\u6216\u5927\u6279\u91cf\u5bfc\u5165\u540e\u8fdb\u884c\u53ea\u8bfb\u68c0\u67e5\u3002\u4e0d\u4f1a\u81ea\u52a8\u5220\u9664\u6216\u66f4\u6539\u6587\u4ef6\u3002";
translations.zh.runHealthCheck = "\u8fd0\u884c\u5065\u5eb7\u68c0\u67e5";
translations.zh.exportHealthReport = "\u5bfc\u51fa\u5065\u5eb7\u62a5\u544a";
translations.zh.healthReportExported = "\u5065\u5eb7\u62a5\u544a\u5df2\u5bfc\u51fa\u3002";
translations.zh.regenerateThumbnails = "\u91cd\u5efa\u7f29\u7565\u56fe";
translations.zh.healthCheckComplete = "\u5065\u5eb7\u68c0\u67e5\u5b8c\u6210\u3002";
translations.zh.healthCheckFailed = "\u5065\u5eb7\u68c0\u67e5\u5931\u8d25\u3002";
translations.zh.okItems = "\u6b63\u5e38\u68c0\u67e5";
translations.zh.warnings = "\u8b66\u544a";
translations.zh.missingFiles = "\u7f3a\u5931\u6587\u4ef6";
translations.zh.orphanFiles = "\u672a\u5f15\u7528\u6587\u4ef6";
translations.zh.affectedSize = "\u53d7\u5f71\u54cd\u5927\u5c0f";
translations.zh.healthDetails = "\u5065\u5eb7\u8be6\u60c5";
translations.zh.noHealthIssues = "\u672a\u53d1\u73b0\u5065\u5eb7\u95ee\u9898\u3002";
translations.zh.thumbnailHealth = "\u7f29\u7565\u56fe\u7f13\u5b58";
translations.zh.canRegenerateThumbnails = "\u53ef\u4ee5\u4ece\u539f\u59cb\u56fe\u7247\u91cd\u5efa\u7f29\u7565\u56fe\u3002";
translations.zh.cannotRegenerateAllThumbnails = "\u90e8\u5206\u539f\u59cb\u56fe\u7247\u7f3a\u5931\uff0c\u56e0\u6b64\u4e0d\u80fd\u91cd\u5efa\u6240\u6709\u7f29\u7565\u56fe\u3002";
translations.zh.database = "\u6570\u636e\u5e93";
translations.zh.images = "\u56fe\u7247";
translations.zh.thumbnails = "\u7f29\u7565\u56fe";
translations.zh.captures = "\u7f51\u9875\u5feb\u7167";
translations.zh.tempCache = "\u4e34\u65f6/\u7f13\u5b58";
translations.zh.total = "\u603b\u8ba1";
translations.zh.metadataBackup = "\u4ec5\u5143\u6570\u636e\u5907\u4efd";
translations.zh.metadataBackupHelp = "\u5907\u4efd\u6570\u636e\u5e93\u3001\u8bbe\u7f6e\u3001\u518c\u9875\u3001\u5e03\u5c40\u548c\u85cf\u54c1\u5143\u6570\u636e\uff1b\u4e0d\u5305\u542b\u56fe\u7247\u3001\u7f29\u7565\u56fe\u548c\u9644\u4ef6\u3002";
translations.zh.fullBackup = "\u5b8c\u6574\u5907\u4efd";
translations.zh.fullBackupHelp = "\u590d\u5236\u6570\u636e\u5e93\u3001\u56fe\u7247\u3001\u9644\u4ef6\u548c\u7f51\u9875\u5feb\u7167\uff1b\u9ed8\u8ba4\u4e0d\u5305\u542b\u7f29\u7565\u56fe\u548c\u4e34\u65f6/\u7f13\u5b58\u6587\u4ef6\u5939\u3002";
translations.zh.fullBackupWarning = "\u5b8c\u6574\u5907\u4efd\u53ef\u80fd\u5f88\u5927\u3002\u8bf7\u9009\u62e9\u6709\u8db3\u591f\u53ef\u7528\u7a7a\u95f4\u7684\u78c1\u76d8\u3002";
translations.zh.backupCreated = "\u5907\u4efd\u5df2\u521b\u5efa\u3002";
translations.zh.backupCanceled = "\u5df2\u53d6\u6d88\u5907\u4efd\u3002";
translations.zh.backupFailed = "\u5907\u4efd\u5931\u8d25\u3002";
translations.zh.restoreBackup = "\u6062\u590d\u5907\u4efd...";
translations.zh.loadBackup = "\u52a0\u8f7d\u5907\u4efd...";
translations.zh.restoreBackupHelp = "\u9a8c\u8bc1\u5907\u4efd\u6587\u4ef6\u5939\uff0c\u9884\u89c8\u5176\u5185\u5bb9\uff0c\u7136\u540e\u5728\u81ea\u52a8\u521b\u5efa\u6062\u590d\u524d\u5907\u4efd\u540e\u66ff\u6362\u5f53\u524d\u6863\u6848\u3002";
translations.zh.restorePreview = "\u6062\u590d\u9884\u89c8";
translations.zh.backupType = "\u5907\u4efd\u7c7b\u578b";
translations.zh.createdAt = "\u521b\u5efa\u65f6\u95f4";
translations.zh.appVersion = "\u5e94\u7528\u7248\u672c";
translations.zh.currentDataAffected = "\u5c06\u53d7\u5f71\u54cd\u7684\u5f53\u524d\u6570\u636e";
translations.zh.itemCount = "\u85cf\u54c1\u6570";
translations.zh.imageMetadataCount = "\u56fe\u7247\u5143\u6570\u636e\u6570";
translations.zh.albumCount = "\u518c\u9875\u6570";
translations.zh.mediaFolders = "\u5a92\u4f53\u6587\u4ef6\u5939";
translations.zh.included = "\u5df2\u5305\u542b";
translations.zh.missing = "\u7f3a\u5931";
translations.zh.integrityCheck = "\u5b8c\u6574\u6027\u68c0\u67e5";
translations.zh.foreignKeyWarnings = "\u5916\u952e\u8b66\u544a";
translations.zh.metadataRestoreWarning = "\u8fd9\u662f\u4ec5\u5143\u6570\u636e\u5907\u4efd\u3002\u56fe\u7247\u3001\u9644\u4ef6\u548c\u7f51\u9875\u5feb\u7167\u4e0d\u5305\u542b\u5728\u5185\uff0c\u6062\u590d\u540e\u53ef\u80fd\u663e\u793a\u4e3a\u7f3a\u5931\u3002";
translations.zh.fullRestoreWarning = "\u8fd9\u5c06\u7528\u6240\u9009\u5907\u4efd\u66ff\u6362\u5f53\u524d\u6570\u636e\u5e93\u548c\u5a92\u4f53\u6587\u4ef6\u5939\u3002";
translations.zh.confirmRestoreBackup = "\u8981\u6062\u590d\u6b64\u5907\u4efd\u5417\uff1f\u5c06\u5148\u628a\u5f53\u524d\u6570\u636e\u4fdd\u62a4\u5230\u6062\u590d\u524d\u6587\u4ef6\u5939\uff0c\u7136\u540e\u66ff\u6362\u3002";
translations.zh.restoreCompleted = "\u5907\u4efd\u5df2\u6062\u590d\u3002\u6b63\u5728\u91cd\u65b0\u52a0\u8f7d\u6863\u6848...";
translations.zh.restoreFailed = "\u6062\u590d\u5931\u8d25\u3002";
translations.zh.preRestoreBackup = "\u6062\u590d\u524d\u5907\u4efd";
translations.zh.openDataFolder = "\u6253\u5f00\u6570\u636e\u6587\u4ef6\u5939";
translations.zh.loadingDatabase = "\u6b63\u5728\u52a0\u8f7d\u6570\u636e\u5e93...";
translations.zh.loadingLibrary = "\u6b63\u5728\u52a0\u8f7d\u9986\u85cf...";
translations.zh.preparingInterface = "\u6b63\u5728\u51c6\u5907\u5de5\u4f5c\u533a...";
translations.zh.ready = "\u5df2\u5c31\u7eea";
translations.zh.startupFailed = "\u542f\u52a8\u5931\u8d25";
translations.zh.retry = "\u91cd\u8bd5";
translations.zh.loadingLibraryItems = "\u6b63\u5728\u52a0\u8f7d\u9986\u85cf\u85cf\u54c1...";
translations.zh.loadingGalleryItems = "\u6b63\u5728\u52a0\u8f7d\u56fe\u5e93...";
translations.zh.loadingAlbum = "\u6b63\u5728\u52a0\u8f7d\u518c\u9875...";
translations.zh.navTrash = "\u56de\u6536\u7ad9";
translations.zh.bulkCreateItems = "\u6279\u91cf\u521b\u5efa\u85cf\u54c1";
translations.zh.createMultipleItems = "\u4ece\u56fe\u7247\u6279\u91cf\u521b\u5efa";
translations.zh.bulkCreateHelp = "\u6bcf\u5f20\u9009\u4e2d\u7684\u56fe\u7247\u90fd\u4f1a\u6210\u4e3a\u4e00\u4ef6\u65b0\u85cf\u54c1\u3002";
translations.zh.bulkCreateErrors = "\u9519\u8bef";
translations.zh.selectedCount = "\u5df2\u9009 {count} \u4ef6";
translations.zh.editSelected = "\u7f16\u8f91\u6240\u9009";
translations.zh.addSelectedToAlbum = "\u6dfb\u52a0\u5230\u518c\u9875";
translations.zh.moveSelectedToTrash = "\u79fb\u5230\u56de\u6536\u7ad9";
translations.zh.clearSelection = "\u6e05\u9664\u9009\u62e9";
translations.zh.bulkEditItems = "\u6279\u91cf\u7f16\u8f91\u85cf\u54c1";
translations.zh.fieldModeUnchanged = "\u4e0d\u66f4\u6539";
translations.zh.fieldModeReplace = "\u66ff\u6362";
translations.zh.tagModeAdd = "\u6dfb\u52a0\u6807\u7b7e";
translations.zh.tagModeRemove = "\u79fb\u9664\u6807\u7b7e";
translations.zh.tagModeReplace = "\u66ff\u6362\u6807\u7b7e";
translations.zh.applyBulkEdit = "\u5e94\u7528\u6279\u91cf\u7f16\u8f91";
translations.zh.bulkEditApplied = "\u6279\u91cf\u7f16\u8f91\u5df2\u5e94\u7528\u3002";
translations.zh.bulkCreateSummary = "\u5df2\u521b\u5efa {created} \u4ef6\uff0c\u5931\u8d25 {failed} \u4ef6\u3002";
translations.zh.chooseImages = "\u9009\u62e9\u56fe\u7247";
translations.zh.titlePrefix = "\u6807\u9898\u524d\u7f00";
translations.zh.titleSuffix = "\u6807\u9898\u540e\u7f00";
translations.zh.imageNote = "\u56fe\u7247\u5907\u6ce8";
translations.zh.imageNotePlaceholder = "\u6b63\u9762\u3001\u80cc\u9762\u3001\u5356\u5bb6\u56fe\u3001\u9700\u8981\u91cd\u626b...";
translations.zh.imageNoteSaved = "\u56fe\u7247\u5907\u6ce8\u5df2\u4fdd\u5b58\u3002";
translations.zh.technicalDetails = "\u6280\u672f\u8be6\u60c5";
translations.zh.attachments = "\u9644\u4ef6";
translations.zh.addAttachment = "\u6dfb\u52a0\u9644\u4ef6";
translations.zh.localFile = "\u672c\u5730\u6587\u4ef6";
translations.zh.webpageUrl = "\u7f51\u9875 URL";
translations.zh.addWebpageAttachment = "\u6dfb\u52a0\u7f51\u9875\u9644\u4ef6";
translations.zh.attachmentDialogHelp = "\u6dfb\u52a0\u672c\u5730\u6587\u4ef6\uff0c\u6216\u4fdd\u5b58\u7f51\u9875\u5f15\u7528\u3002";
translations.zh.localAttachmentHelp = "\u6dfb\u52a0 PDF\u3001\u97f3\u9891\u3001\u89c6\u9891\u3001\u6587\u6863\u3001\u538b\u7f29\u5305\u6216\u5176\u4ed6\u53c2\u8003\u6587\u4ef6\u3002";
translations.zh.executableBlockedHint = "\u53ef\u6267\u884c\u6587\u4ef6\u548c\u811a\u672c\u6587\u4ef6\u4f1a\u88ab\u963b\u6b62\u3002";
translations.zh.chooseFile = "\u9009\u62e9\u6587\u4ef6";
translations.zh.sourceUrl = "\u6765\u6e90 URL";
translations.zh.openUrl = "\u6253\u5f00 URL";
translations.zh.capturedAt = "\u6293\u53d6\u65f6\u95f4";
translations.zh.attachmentMode = "\u6a21\u5f0f";
translations.zh.saveUrl = "\u4fdd\u5b58 URL";
translations.zh.saveUrlOnly = "\u4ec5\u4fdd\u5b58 URL";
translations.zh.saveAsPdfSnapshot = "\u4fdd\u5b58\u4e3a PDF \u5feb\u7167";
translations.zh.webpageAttachmentHelp = "\u4fdd\u5b58\u94fe\u63a5\uff0c\u6216\u5c06\u5f53\u524d\u7f51\u9875\u6293\u53d6\u4e3a PDF \u5feb\u7167\u3002";
translations.zh.capturePdf = "\u6293\u53d6 PDF";
translations.zh.captureWebpagePdf = "\u6293\u53d6\u7f51\u9875 PDF";
translations.zh.openFile = "\u6253\u5f00\u6587\u4ef6";
translations.zh.view = "\u67e5\u770b";
translations.zh.previewAttachment = "\u9884\u89c8\u9644\u4ef6";
translations.zh.removeAttachment = "\u79fb\u9664\u9644\u4ef6";
translations.zh.note = "\u5907\u6ce8";
translations.zh.fileType = "\u6587\u4ef6\u7c7b\u578b";
translations.zh.fileSize = "\u6587\u4ef6\u5927\u5c0f";
translations.zh.imported = "\u5bfc\u5165\u65f6\u95f4";
translations.zh.noAttachmentsYet = "\u8fd8\u6ca1\u6709\u9644\u4ef6";
translations.zh.previewUnavailable = "\u9884\u89c8\u4e0d\u53ef\u7528";
translations.zh.playbackUnavailable = "\u64ad\u653e\u4e0d\u53ef\u7528";
translations.zh.pdfPreviewUnavailable = "PDF \u9884\u89c8\u4e0d\u53ef\u7528";
translations.zh.loadingPdf = "\u6b63\u5728\u52a0\u8f7d PDF...";
translations.zh.previousPage = "\u4e0a\u4e00\u9875";
translations.zh.nextPage = "\u4e0b\u4e00\u9875";
translations.zh.pageLabel = "\u9875";
translations.zh.of = "\u5171";
translations.zh.fitWidth = "\u9002\u5408\u5bbd\u5ea6";
translations.zh.pdfZoomIn = "\u653e\u5927";
translations.zh.pdfZoomOut = "\u7f29\u5c0f";
translations.zh.pdfActualSize = "\u5b9e\u9645\u5927\u5c0f";
translations.zh.reload = "\u91cd\u65b0\u52a0\u8f7d";
translations.zh.attachmentSaved = "\u9644\u4ef6\u5df2\u4fdd\u5b58\u3002";
translations.zh.attachmentRemoved = "\u9644\u4ef6\u5df2\u79fb\u9664\u3002";
translations.zh.labelCards = "\u6807\u7b7e\u5361";
translations.zh.noLabelCardsYet = "\u8fd8\u6ca1\u6709\u6807\u7b7e\u5361";
translations.zh.newLabelCard = "\u65b0\u5efa\u5361\u7247";
translations.zh.saveLabelCard = "\u4fdd\u5b58\u5361\u7247";
translations.zh.deleteLabelCard = "\u5220\u9664\u5361\u7247";
translations.zh.exportCardPng = "\u5bfc\u51fa PNG";
translations.zh.exporting = "\u6b63\u5728\u5bfc\u51fa...";
translations.zh.saving = "\u6b63\u5728\u4fdd\u5b58...";
translations.zh.exportCanceled = "\u5df2\u53d6\u6d88\u5bfc\u51fa\u3002";
translations.zh.exportCardFailed = "\u5361\u7247\u5bfc\u51fa\u5931\u8d25\u3002";
translations.zh.cardExported = "\u5361\u7247\u5df2\u5bfc\u51fa\u3002";
translations.zh.cardSaved = "\u5361\u7247\u5df2\u4fdd\u5b58\u3002";
translations.zh.cardDeleted = "\u5361\u7247\u5df2\u5220\u9664\u3002";
translations.zh.cardSubtitle = "\u526f\u6807\u9898";
translations.zh.cardMainText = "\u4e3b\u8981\u6587\u5b57";
translations.zh.smallNotes = "\u5c0f\u5907\u6ce8";
translations.zh.provenanceText = "\u6765\u6e90/\u51fa\u5904\u6587\u5b57";
translations.zh.catalogText = "\u76ee\u5f55/\u53c2\u8003\u6587\u5b57";
translations.zh.imagePosition = "\u56fe\u7247\u4f4d\u7f6e";
translations.zh.topImage = "\u9876\u90e8\u56fe\u7247";
translations.zh.leftImage = "\u5de6\u4fa7\u56fe\u7247";
translations.zh.rightImage = "\u53f3\u4fa7\u56fe\u7247";
translations.zh.imageOnlyCaption = "\u4ec5\u56fe\u7247+\u8bf4\u660e";
translations.zh.textOnly = "\u4ec5\u6587\u5b57";
translations.zh.centeredShowcase = "\u5c45\u4e2d\u5c55\u793a";
translations.zh.stampExhibitionCard = "\u90ae\u7968\u5c55\u89c8\u5361";
translations.zh.museumSpecimenCard = "\u535a\u7269\u9986\u6807\u672c\u5361";
translations.zh.museumLabel = "\u535a\u7269\u9986\u6807\u7b7e";
translations.zh.classicAlbumCard = "\u7ecf\u5178\u518c\u9875\u5361";
translations.zh.auctionNote = "\u62cd\u5356\u6279\u6b21\u5361";
translations.zh.minimalCard = "\u73b0\u4ee3\u6781\u7b80\u5361";
translations.zh.vintagePaperCard = "\u590d\u53e4\u7eb8\u5361";
translations.zh.resetStyleToPreset = "\u91cd\u7f6e\u4e3a\u9884\u8bbe\u6837\u5f0f";
translations.zh.borderOn = "\u663e\u793a\u8fb9\u6846";
translations.zh.backgroundTone = "\u80cc\u666f\u7eb8\u8272";
translations.zh.editLabelCard = "\u7f16\u8f91";
translations.zh.labelCardEditor = "\u6807\u7b7e\u5361\u7f16\u8f91\u5668";
translations.zh.cardContent = "\u5185\u5bb9";
translations.zh.cardLayout = "\u5e03\u5c40";
translations.zh.cardStyle = "\u6837\u5f0f";
translations.zh.cardExport = "\u5bfc\u51fa";
translations.zh.cardPreset = "\u5361\u7247\u7c7b\u578b";
translations.zh.cardSize = "\u5361\u7247\u5c3a\u5bf8";
translations.zh.smallTicket = "\u5c0f\u7968\u5361";
translations.zh.a6Landscape = "A6 \u6a2a\u5411";
translations.zh.a6Portrait = "A6 \u7ad6\u5411";
translations.zh.squareShareCard = "\u65b9\u5f62\u5206\u4eab\u5361";
translations.zh.socialShareLandscape = "\u793e\u4ea4\u5206\u4eab\u6a2a\u5361";
translations.zh.classicStampSlip = "\u7ecf\u5178\u90ae\u7968\u518c\u7b7e";
translations.zh.coinCabinetTicket = "\u94b1\u5e01\u67dc\u7968\u7b7e";
translations.zh.exhibitionShareCard = "\u5c55\u89c8\u5206\u4eab\u5361";
translations.zh.minimalArchiveCard = "\u6781\u7b80\u6863\u6848\u5361";
translations.zh.primaryImage = "\u4e3b\u56fe\u7247";
translations.zh.reverseImage = "\u80cc\u9762 / \u7b2c\u4e8c\u5f20\u56fe\u7247";
translations.zh.exportScale = "\u5bfc\u51fa\u500d\u7387";
translations.zh.exportHelp = "\u5bfc\u51fa\u7ed3\u679c\u4e0e\u9884\u89c8\u4e2d\u663e\u793a\u7684\u5361\u7247\u4e00\u81f4\u3002";
translations.zh.cardPreview = "\u5361\u7247\u9884\u89c8";
translations.zh.materialSurface = "\u6750\u8d28 / \u8868\u9762";
translations.zh.creamAlbumPaper = "\u4e73\u767d\u8272\u518c\u9875\u7eb8";
translations.zh.archivalCardStock = "\u6863\u6848\u5361\u7eb8";
translations.zh.agedPaper = "\u505a\u65e7\u7eb8";
translations.zh.linenTexture = "\u4e9a\u9ebb\u7eb9\u7406";
translations.zh.whiteMuseumBoard = "\u767d\u8272\u535a\u7269\u9986\u5361\u677f";
translations.zh.darkWalnutWood = "\u6df1\u8272\u80e1\u6843\u6728";
translations.zh.mahoganyWood = "\u7ea2\u6728";
translations.zh.blackVelvet = "\u9ed1\u8272\u5929\u9e45\u7ed2";
translations.zh.greenFelt = "\u7eff\u8272\u6be1\u9762";
translations.zh.textureIntensity = "\u7eb9\u7406\u5f3a\u5ea6";
translations.zh.brightness = "\u4eae\u5ea6";
translations.zh.agingLevel = "\u505a\u65e7\u7a0b\u5ea6";
translations.zh.presentationFrame = "\u5c55\u793a\u6846";
translations.zh.thinDoubleAlbumFrame = "\u7ec6\u53cc\u7ebf\u518c\u9875\u6846";
translations.zh.blackStampMount = "\u9ed1\u8272\u90ae\u7968\u62a4\u90ae\u888b";
translations.zh.creamMatWindow = "\u4e73\u767d\u8272\u5361\u7eb8\u7a97";
translations.zh.transparentMount = "\u900f\u660e\u62a4\u90ae\u6548\u679c";
translations.zh.circularCoinRecess = "\u5706\u5f62\u94b1\u5e01\u51f9\u69fd";
translations.zh.capsuleRim = "\u4fdd\u62a4\u76d2\u5706\u8fb9";
translations.zh.velvetTray = "\u5929\u9e45\u7ed2\u6258\u76d8";
translations.zh.woodenCabinetSlot = "\u6728\u5236\u67dc\u683c";
translations.zh.obverseReverseFrame = "\u6b63\u53cd\u9762\u53cc\u6846";
translations.zh.classicGoldFrame = "\u7ecf\u5178\u91d1\u8272\u753b\u6846";
translations.zh.darkWoodFrame = "\u6df1\u8272\u6728\u6846";
translations.zh.blackGalleryFrame = "\u9ed1\u8272\u753b\u5eca\u6846";
translations.zh.whiteMatFrame = "\u767d\u8272\u5361\u7eb8\u6846";
translations.zh.cardEdge = "\u5361\u7247\u8fb9\u7f18";
translations.zh.squareEdge = "\u76f4\u89d2";
translations.zh.roundedEdge = "\u5706\u89d2";
translations.zh.clippedCorners = "\u5207\u89d2";
translations.zh.doubleLineEdge = "\u53cc\u7ebf\u8fb9";
translations.zh.embossedEdge = "\u6d6e\u96d5\u8fb9";
translations.zh.thinGoldEdge = "\u7ec6\u91d1\u8fb9";
translations.zh.ticketPerforation = "\u7968\u5238\u9f7f\u5b54";
translations.zh.deckledEdge = "\u624b\u6495\u7eb8\u8fb9";
translations.zh.centeredSingleImage = "\u5355\u56fe\u5c45\u4e2d";
translations.zh.imageTopTextBelow = "\u56fe\u7247\u5728\u4e0a\uff0c\u6587\u5b57\u5728\u4e0b";
translations.zh.imageLeftTextRight = "\u56fe\u7247\u5728\u5de6\uff0c\u6587\u5b57\u5728\u53f3";
translations.zh.obverseReversePair = "\u6b63\u53cd\u9762\u5e76\u5217";
translations.zh.mainImageDetailImage = "\u4e3b\u56fe + \u7ec6\u8282\u56fe";
translations.zh.textOnlyArchivalLabel = "\u7eaf\u6587\u5b57\u6863\u6848\u6807\u7b7e";
translations.zh.frontSide = "\u6b63\u9762";
translations.zh.backSide = "\u80cc\u9762";
translations.zh.acquisitionNotes = "\u5165\u85cf\u5907\u6ce8";
translations.zh.researchNotes = "\u7814\u7a76\u5907\u6ce8";
translations.zh.trashTitle = "\u56de\u6536\u7ad9";
translations.zh.trashEmpty = "\u56de\u6536\u7ad9\u4e3a\u7a7a";
translations.zh.restore = "\u6062\u590d";
translations.zh.permanentlyDelete = "\u6c38\u4e45\u5220\u9664";
translations.zh.emptyTrash = "\u6e05\u7a7a\u56de\u6536\u7ad9";
translations.zh.movedToTrash = "\u5df2\u79fb\u5230\u56de\u6536\u7ad9\u3002";
translations.zh.restoredFromTrash = "\u5df2\u4ece\u56de\u6536\u7ad9\u6062\u590d\u3002";
translations.zh.permanentlyDeleted = "\u5df2\u6c38\u4e45\u5220\u9664\u3002";
translations.zh.addAllImagesToAlbum = "\u5c06\u5168\u90e8\u56fe\u7247\u6dfb\u52a0\u5230\u518c\u9875";
translations.zh.addSelectedFirstImages = "\u6dfb\u52a0\u6240\u9009\u7684\u9996\u5f20\u56fe";
translations.zh.addSelectedAllImages = "\u6dfb\u52a0\u6240\u9009\u7684\u5168\u90e8\u56fe";
translations.zh.albumTarget = "\u76ee\u6807\u518c\u9875";
translations.zh.columns = "\u5217\u6570";
translations.zh.spacing = "\u95f4\u8ddd";
translations.zh.useCoverImage = "\u4f7f\u7528\u5c01\u9762\u56fe";
translations.zh.useAllImages = "\u4f7f\u7528\u5168\u90e8\u56fe\u7247";
translations.zh.bulkAlbumAdded = "\u5df2\u6dfb\u52a0 {added} \u4e2a\u6446\u653e\u4f4d\uff0c\u8df3\u8fc7 {skipped} \u4e2a\u3002";
translations.zh.importFromPhone = "\u4ece\u624b\u673a\u5bfc\u5165";
translations.zh.phoneUpload = "\u624b\u673a\u4e0a\u4f20";
translations.zh.phoneUploadTarget = "\u4e0a\u4f20\u7684\u7167\u7247\u5c06\u6dfb\u52a0\u5230\u5f53\u524d\u85cf\u54c1\uff1a{title}";
translations.zh.phoneUploadHint = "\u5728\u540c\u4e00 Wi-Fi \u7684\u624b\u673a\u4e0a\u6253\u5f00\u6b64\u5730\u5740\u3002\u9996\u6b21\u4f7f\u7528\u65f6 Windows \u9632\u706b\u5899\u53ef\u80fd\u4f1a\u8be2\u95ee\u6743\u9650\u3002";
translations.zh.phoneUploadUrl = "\u4e0a\u4f20\u5730\u5740";
translations.zh.stopPhoneUpload = "\u505c\u6b62\u4e0a\u4f20";
translations.zh.uploadedPhotos = "\u5df2\u4e0a\u4f20 {count} \u5f20";
translations.zh.waitingForPhone = "\u6b63\u5728\u7b49\u5f85\u624b\u673a...";
translations.zh.noLanAddress = "\u672a\u627e\u5230\u5c40\u57df\u7f51\u5730\u5740\u3002\u8bf7\u786e\u8ba4\u7535\u8111\u5df2\u8fde\u63a5 Wi-Fi\u3002";
translations.zh.phoneUploadStarted = "\u624b\u673a\u4e0a\u4f20\u5df2\u542f\u52a8\u3002";
translations.zh.phoneUploadStopped = "\u624b\u673a\u4e0a\u4f20\u5df2\u505c\u6b62\u3002";
translations.zh.lastUpload = "\u4e0a\u6b21\u4e0a\u4f20";
translations.zh.regenerateThumbnail = "\u91cd\u5efa\u7f29\u7565\u56fe";
translations.zh.regenerateItemThumbnails = "\u91cd\u5efa\u672c\u85cf\u54c1\u7f29\u7565\u56fe";
translations.zh.thumbnailsRegenerated = "\u7f29\u7565\u56fe\u5df2\u91cd\u5efa\u3002";
translations.zh.physicalSize = "\u5b9e\u9645\u5c3a\u5bf8";
translations.zh.widthMm = "\u5bbd\u5ea6\uff08\u6beb\u7c73\uff09";
translations.zh.heightMm = "\u9ad8\u5ea6\uff08\u6beb\u7c73\uff09";
translations.zh.applySize = "\u5e94\u7528\u5c3a\u5bf8";
translations.zh.crop = "\u88c1\u5207";
translations.zh.cropLeft = "\u5de6";
translations.zh.cropRight = "\u53f3";
translations.zh.cropTop = "\u4e0a";
translations.zh.cropBottom = "\u4e0b";
translations.zh.resetCrop = "\u91cd\u7f6e\u88c1\u5207";
translations.zh.cropHelp = "\u4ec5\u5bf9\u6b64\u6446\u653e\u4f4d\u8fdb\u884c\u624b\u52a8\u975e\u7834\u574f\u88c1\u5207\u3002";

function interpolate(text, values = {}) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

function I18nProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved === "zh" ? "zh" : "en";
  });
  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);
  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (key, fallback, values) => interpolate(translations[language]?.[key] || translations.en[key] || fallback || key, values)
  }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n() {
  return React.useContext(I18nContext);
}

const emptyItem = {
  title: "",
  country_id: "",
  type_id: "",
  year: "",
  description: "",
  condition: "",
  purchase_price: "",
  source: "",
  tags: "",
  customFieldsText: "",
  favorite: false
};

function customFieldsFromText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((fields, line) => {
      const separator = line.indexOf(":");
      if (separator > -1) {
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key) fields[key] = value;
      }
      return fields;
    }, {});
}

function customFieldsToText(fields) {
  return Object.entries(fields || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function orderedRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const leftOrder = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const left = String(a.name || a.title || "");
    const right = String(b.name || b.title || "");
    return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
  });
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

const transparentPixel =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function ItemImage({ image, alt }) {
  if (!image) {
    return <div className="image-placeholder">No image</div>;
  }

  return (
    <MediaImage
      src={image.thumbnailUrl || image.url}
      alt={alt}
      context={`Library card: ${alt}`}
      defer
    />
  );
}

function MediaImage({ src, alt, context, defer = false, imageRef, ...props }) {
  const [displaySrc, setDisplaySrc] = useState(defer ? transparentPixel : src);

  useEffect(() => {
    if (localStorage.getItem("archiveDebugMedia") === "1") {
      console.log("[media] final img src used by React", { context, src });
    }
  }, [context, src]);

  useEffect(() => {
    if (!defer) {
      setDisplaySrc(src || transparentPixel);
      return undefined;
    }

    setDisplaySrc(transparentPixel);
    const timeout = window.setTimeout(() => setDisplaySrc(src || transparentPixel), 50);
    return () => window.clearTimeout(timeout);
  }, [defer, src]);

  return <img ref={imageRef} src={displaySrc || transparentPixel} data-media-src={src || ""} alt={alt} loading="lazy" decoding="async" {...props} />;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isEditableTarget(target) {
  if (!target) return false;
  const element = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
  if (!element) return false;
  const editable = element.closest?.("input, textarea, select, [contenteditable='true']");
  const tagName = editable?.tagName || element.tagName;
  return Boolean(
    ["INPUT", "TEXTAREA", "SELECT"].includes(tagName) ||
      editable?.isContentEditable ||
      element.isContentEditable
  );
}

function isEditableEvent(event) {
  if (!event) return false;
  if (event.__archiveEditableTarget) return true;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  return path.some((entry) => entry && entry.nodeType === 1 && isEditableTarget(entry)) || isEditableTarget(event.target);
}

function inputDebugEnabled() {
  try {
    return localStorage.getItem("archiveDebugInput") === "1";
  } catch {
    return false;
  }
}

function describeInputTarget(target) {
  if (!target || target.nodeType !== 1) return null;
  return {
    tagName: target.tagName,
    type: target.getAttribute?.("type") || "",
    id: target.id || "",
    className: typeof target.className === "string" ? target.className : "",
    name: target.getAttribute?.("name") || "",
    label: target.getAttribute?.("data-input-debug") || ""
  };
}

function currentInputDebugState() {
  const active = document.activeElement;
  return {
    context: window.__archiveInputContext || {},
    detailContext: window.__archiveDetailInputContext || {},
    activeElement: describeInputTarget(active),
    overlays: {
      modal: Boolean(document.querySelector(".modal-backdrop, .nested-modal")),
      picker: Boolean(document.querySelector(".picker-backdrop")),
      viewer: Boolean(document.querySelector(".viewer-backdrop, .attachment-viewer-backdrop")),
      toast: Boolean(document.querySelector(".toast"))
    }
  };
}

function logInputDebug(source, event, extra = {}) {
  if (!inputDebugEnabled()) return;
  console.log("[input-debug]", {
    source,
    type: event?.type || "",
    key: event?.key || "",
    code: event?.code || "",
    inputType: event?.inputType || "",
    target: describeInputTarget(event?.target),
    isEditableTarget: isEditableEvent(event),
    defaultPrevented: Boolean(event?.defaultPrevented),
    cancelBubble: Boolean(event?.cancelBubble),
    ...currentInputDebugState(),
    ...extra
  });
}

function shouldIgnoreAppShortcut(event, source) {
  const ignore = isEditableEvent(event);
  if (inputDebugEnabled()) {
    logInputDebug(source, event, { shortcutAction: ignore ? "skip-editable" : "handle" });
  }
  return ignore;
}

function cancelAppInteractions() {
  window.dispatchEvent(new CustomEvent("archive:cancel-interactions"));
}

function ZoomControls({ mode, zoom, onZoomIn, onZoomOut, onReset, onFit, onActualSize }) {
  const label = mode === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`;

  return (
    <div className="zoom-controls">
      <button type="button" onClick={onZoomIn}>Zoom +</button>
      <button type="button" onClick={onZoomOut}>Zoom -</button>
      <button type="button" onClick={onReset}>Reset</button>
      <button type="button" onClick={onFit}>Fit</button>
      <button type="button" onClick={onActualSize}>100%</button>
      <span>{label}</span>
    </div>
  );
}

function ZoomableImageViewer({ image, src, alt, width, height, initialMode = "fit", context, className = "" }) {
  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const fitFrameRef = useRef(null);
  const primarySrc = src || fullImageUrl(image);
  const fallbackSrc = thumbnailImageUrl(image);
  const resolvedSrc = primarySrc || fallbackSrc;
  const explicitWidth = Number(width || image?.width || 0);
  const explicitHeight = Number(height || image?.height || 0);
  const [mode, setMode] = useState(initialMode);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeSrc, setActiveSrc] = useState(resolvedSrc);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [fitReady, setFitReady] = useState(false);
  const imageWidth = Math.max(1, explicitWidth > 1 ? explicitWidth : naturalSize.width || 1);
  const imageHeight = Math.max(1, explicitHeight > 1 ? explicitHeight : naturalSize.height || 1);

  const constrainView = useCallback(
    (nextView) => {
      const container = containerRef.current;
      if (!container) return nextView;

      const rect = container.getBoundingClientRect();
      const scaledWidth = imageWidth * nextView.scale;
      const scaledHeight = imageHeight * nextView.scale;
      const x =
        scaledWidth <= rect.width
          ? (rect.width - scaledWidth) / 2
          : clamp(nextView.x, rect.width - scaledWidth, 0);
      const y =
        scaledHeight <= rect.height
          ? (rect.height - scaledHeight) / 2
          : clamp(nextView.y, rect.height - scaledHeight, 0);

      return { scale: nextView.scale, x, y };
    },
    [imageHeight, imageWidth]
  );

  const fitView = useCallback(() => {
    const container = containerRef.current;
    if (!container || imageWidth < 1 || imageHeight < 1) {
      if (localStorage.getItem("archiveDebugMedia") === "1") {
        console.log("[media] zoom viewer fit deferred", {
          context,
          reason: !container ? "missing-container" : "missing-image-size",
          imageWidth,
          imageHeight
        });
      }
      return null;
    }

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;
    if (containerWidth < 40 || containerHeight < 40) {
      if (localStorage.getItem("archiveDebugMedia") === "1") {
        console.log("[media] zoom viewer fit deferred", {
          context,
          reason: "invalid-container-size",
          containerWidth,
          containerHeight,
          imageWidth,
          imageHeight
        });
      }
      return null;
    }

    const calculatedFitZoom = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
    if (!Number.isFinite(calculatedFitZoom) || calculatedFitZoom <= 0) {
      if (localStorage.getItem("archiveDebugMedia") === "1") {
        console.warn("[media] zoom viewer invalid fit measurement", {
          context,
          containerWidth,
          containerHeight,
          imageWidth,
          imageHeight,
          calculatedFitZoom
        });
      }
      return null;
    }

    const scale = clamp(calculatedFitZoom, MIN_ZOOM, MAX_ZOOM);
    const nextView = constrainView({ scale, x: 0, y: 0 });
    if (localStorage.getItem("archiveDebugMedia") === "1") {
      console.log("[media] zoom viewer fit calculated", {
        context,
        containerWidth,
        containerHeight,
        naturalWidth: imageRef.current?.naturalWidth || naturalSize.width,
        naturalHeight: imageRef.current?.naturalHeight || naturalSize.height,
        imageWidth,
        imageHeight,
        calculatedFitZoom,
        finalZoom: nextView.scale,
        finalPanX: nextView.x,
        finalPanY: nextView.y
      });
    }
    return nextView;
  }, [constrainView, context, imageHeight, imageWidth, naturalSize.height, naturalSize.width]);

  const setFit = useCallback(() => {
    setMode("fit");
    const nextView = fitView();
    if (!nextView) return false;
    setView(nextView);
    setFitReady(true);
    return true;
  }, [fitView]);

  const scheduleFit = useCallback(
    (reason = "fit", attempt = 0) => {
      if (fitFrameRef.current) {
        window.clearTimeout(fitFrameRef.current);
      }
      fitFrameRef.current = window.setTimeout(() => {
        fitFrameRef.current = null;
        const fitted = setFit();
        if (!fitted && attempt < 6) {
          window.setTimeout(() => scheduleFit(reason, attempt + 1), 30);
        } else if (!fitted) {
          setMode("fit");
          setView({ scale: 1, x: 0, y: 0 });
          setFitReady(false);
          if (localStorage.getItem("archiveDebugMedia") === "1") {
            console.warn("[media] zoom viewer fit fallback", { context, reason, attempts: attempt + 1 });
          }
        }
      });
    },
    [context, setFit]
  );

  const setActualSize = useCallback(() => {
    setMode("zoom");
    setView(constrainView({ scale: 1, x: 0, y: 0 }));
    setFitReady(true);
  }, [constrainView]);

  const zoomAt = useCallback(
    (clientX, clientY, factor) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      setFitReady(true);
      setMode("zoom");
      setView((current) => {
        const nextScale = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM);
        const pointerX = clientX - rect.left;
        const pointerY = clientY - rect.top;
        const imageX = (pointerX - current.x) / current.scale;
        const imageY = (pointerY - current.y) / current.scale;

        return constrainView({
          scale: nextScale,
          x: pointerX - imageX * nextScale,
          y: pointerY - imageY * nextScale
        });
      });
    },
    [constrainView]
  );

  const zoomFromCenter = useCallback(
    (factor) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt]
  );

  useLayoutEffect(() => {
    setLoadFailed(false);
    setActiveSrc(resolvedSrc);
    setNaturalSize({ width: 0, height: 0 });
    setFitReady(false);
    setMode(initialMode);
    setView({ scale: 1, x: 0, y: 0 });
  }, [resolvedSrc, initialMode]);

  useLayoutEffect(() => {
    if (activeSrc && imageWidth > 1 && imageHeight > 1) {
      scheduleFit("image-ready");
    }
  }, [activeSrc, imageWidth, imageHeight, scheduleFit]);

  useEffect(() => () => {
    if (fitFrameRef.current) {
      window.clearTimeout(fitFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (localStorage.getItem("archiveDebugMedia") === "1") {
      console.log("[media] zoom viewer source", {
        context,
        image,
        primarySrc,
        fallbackSrc,
        activeSrc: resolvedSrc
      });
    }
  }, [context, fallbackSrc, image, primarySrc, resolvedSrc]);

  function logRenderedImageState(img) {
    if (localStorage.getItem("archiveDebugMedia") !== "1") return;
    const imageEl = img || imageRef.current;
    const container = containerRef.current;
    if (!imageEl || !container) {
      console.log("[media] zoom viewer render state skipped", {
        context,
        activeSrc,
        hasImageElement: Boolean(imageEl),
        hasContainerElement: Boolean(container)
      });
      return;
    }

    const imageRect = imageEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const computed = window.getComputedStyle(imageEl);
    const offscreen =
      containerRect &&
      (imageRect.right < containerRect.left ||
        imageRect.left > containerRect.right ||
        imageRect.bottom < containerRect.top ||
        imageRect.top > containerRect.bottom);
    const zeroSized = imageRect.width <= 1 || imageRect.height <= 1;
    console.log("[media] zoom viewer render state", {
      context,
      activeSrc,
      mode,
      zoom: view.scale,
      panX: view.x,
      panY: view.y,
      metadataWidth: explicitWidth,
      metadataHeight: explicitHeight,
      naturalWidth: imageEl.naturalWidth,
      naturalHeight: imageEl.naturalHeight,
      renderedClientWidth: imageEl.clientWidth,
      renderedClientHeight: imageEl.clientHeight,
      imageRect: imageRect.toJSON ? imageRect.toJSON() : {
        x: imageRect.x,
        y: imageRect.y,
        width: imageRect.width,
        height: imageRect.height
      },
      containerRect: containerRect?.toJSON ? containerRect.toJSON() : containerRect,
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      transform: computed.transform,
      zIndex: computed.zIndex,
      zeroSized,
      offscreen
    });
    if (zeroSized || offscreen) {
      console.warn("[media] zoom viewer render/layout issue", { context, zeroSized, offscreen, activeSrc });
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver(() => {
      if (mode === "fit") {
        scheduleFit("resize");
      } else {
        setView((current) => constrainView(current));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [constrainView, mode, scheduleFit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const factor = Math.exp(-event.deltaY * 0.0018);
      zoomAt(event.clientX, event.clientY, factor);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoomAt]);

  if (!activeSrc || loadFailed) {
    return <div className="large-placeholder">Image not found</div>;
  }

  const scaledWidth = fitReady ? imageWidth * view.scale : 0;
  const scaledHeight = fitReady ? imageHeight * view.scale : 0;
  const canDrag = scaledWidth > (containerRef.current?.clientWidth || 0) || scaledHeight > (containerRef.current?.clientHeight || 0);

  return (
    <div className={`zoom-view ${className}`} data-dragging={dragging ? "true" : "false"}>
      <ZoomControls
        mode={mode}
        zoom={view.scale}
        onZoomIn={() => zoomFromCenter(1.18)}
        onZoomOut={() => zoomFromCenter(1 / 1.18)}
        onReset={setFit}
        onFit={setFit}
        onActualSize={setActualSize}
      />
      <div
        ref={containerRef}
        className="zoom-canvas"
        data-mode={mode}
        data-fit-ready={fitReady ? "true" : "false"}
        data-can-drag={canDrag ? "true" : "false"}
        onPointerDown={(event) => {
          if (!canDrag || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: view.x,
            originY: view.y
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const dx = event.clientX - drag.startX;
          const dy = event.clientY - drag.startY;
          setView((current) => constrainView({ ...current, x: drag.originX + dx, y: drag.originY + dy }));
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) {
            dragRef.current = null;
            setDragging(false);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
      >
        <MediaImage
          imageRef={imageRef}
          src={activeSrc}
          alt={alt}
          context={context}
          draggable={false}
          onLoad={(event) => {
            const loadedImage = event.currentTarget;
            imageRef.current = loadedImage;
            const loadedWidth = loadedImage.naturalWidth || 0;
            const loadedHeight = loadedImage.naturalHeight || 0;
            if (loadedWidth >= 1 && loadedHeight >= 1 && (explicitWidth <= 1 || explicitHeight <= 1)) {
              setNaturalSize({ width: loadedWidth, height: loadedHeight });
            }
            if (loadedWidth >= 1 && loadedHeight >= 1) {
              scheduleFit("image-load");
            }
            if (localStorage.getItem("archiveDebugMedia") === "1") {
              console.log("[media] zoom viewer image loaded", {
                context,
                src: activeSrc,
                naturalWidth: loadedWidth,
                naturalHeight: loadedHeight
              });
            }
            window.requestAnimationFrame(() => logRenderedImageState(loadedImage));
          }}
          onError={() => {
            if (localStorage.getItem("archiveDebugMedia") === "1") {
              console.warn("[media] zoom viewer image failed", { context, src: activeSrc, fallbackSrc });
            }
            if (fallbackSrc && activeSrc !== fallbackSrc) {
              setActiveSrc(fallbackSrc);
            } else {
              setLoadFailed(true);
            }
          }}
          style={{
            width: fitReady ? `${imageWidth}px` : "auto",
            height: fitReady ? `${imageHeight}px` : "auto",
            maxWidth: fitReady ? "none" : "100%",
            maxHeight: fitReady ? "none" : "100%",
            objectFit: "contain",
            transform: fitReady ? `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` : "none",
            transformOrigin: "0 0"
          }}
        />
      </div>
    </div>
  );
}

function ImageViewer({ images, initialIndex, title, onClose }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(initialIndex || 0);
  const image = images[index];

  useEffect(() => {
    setIndex(initialIndex || 0);
  }, [initialIndex, images]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (shouldIgnoreAppShortcut(event, "ImageViewer.keydown")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!image) {
    return null;
  }

  if (localStorage.getItem("archiveDebugMedia") === "1") {
    console.log("[media] image viewer state", {
      title,
      index,
      imageCount: images.length,
      image,
      fullUrl: fullImageUrl(image),
      thumbnailUrl: thumbnailImageUrl(image)
    });
  }

  return (
    <div className="viewer-backdrop">
      <div className="viewer">
        <header className="viewer-header">
          <div>
            <h2>{title}</h2>
            <p>{index + 1} of {images.length}</p>
          </div>
          <div className="viewer-actions">
            <button type="button" disabled={index === 0} onClick={() => setIndex((current) => current - 1)}>{t("previous")}</button>
            <button type="button" disabled={index === images.length - 1} onClick={() => setIndex((current) => current + 1)}>{t("next")}</button>
            <button className="viewer-close" type="button" aria-label={t("closeViewer")} onClick={onClose}>{t("close")}</button>
          </div>
        </header>
        <ZoomableImageViewer image={image} alt={title} context={`Viewer: ${title}`} className="viewer-zoom" />
      </div>
    </div>
  );
}

function LoadingState({ title }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{title}</span>
    </div>
  );
}

function StartupScreen({ status, error, onRetry }) {
  const { t } = useI18n();
  const statusText = status ? t(status) : t("openingArchive");

  return (
    <main className="startup-screen">
      <section className={`startup-card ${error ? "error" : ""}`} role="status" aria-live="polite">
        <div className="startup-mark" aria-hidden="true" />
        <h1>{t("appTitle")}</h1>
        {error ? (
          <>
            <p className="startup-status">{t("startupFailed")}</p>
            <p className="startup-error">{error}</p>
            <button type="button" className="primary" onClick={onRetry}>{t("retry")}</button>
          </>
        ) : (
          <>
            <p className="startup-status">{statusText}</p>
            <span className="loading-spinner" aria-hidden="true" />
          </>
        )}
      </section>
    </main>
  );
}

function PhoneUploadDialog({ session, onClose, onStop }) {
  const { t } = useI18n();
  const urls = Array.isArray(session.urls) ? session.urls : [];
  const primaryUrl = urls[0] || "";

  return (
    <div className="modal-backdrop">
      <section className="modal phone-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="phone-upload-title">
        <header className="modal-header">
          <div>
            <h2 id="phone-upload-title">{t("phoneUpload")}</h2>
            <p>{t("phoneUploadTarget", "", { title: session.itemTitle || "" })}</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="danger" onClick={onStop}>{t("stopPhoneUpload")}</button>
            <button type="button" className="ghost" onClick={onClose}>{t("close")}</button>
          </div>
        </header>
        <div className="phone-upload-body">
          {session.qrCodeDataUrl ? (
            <img className="phone-upload-qr" src={session.qrCodeDataUrl} alt={t("phoneUploadUrl")} />
          ) : null}
          <div className="phone-upload-info">
            <label>
              <span>{t("phoneUploadUrl")}</span>
              <input readOnly value={primaryUrl} onFocus={(event) => event.target.select()} />
            </label>
            {urls.length > 1 && (
              <div className="phone-upload-url-list">
                {urls.slice(1).map((url) => (
                  <input key={url} readOnly value={url} onFocus={(event) => event.target.select()} />
                ))}
              </div>
            )}
            <p className="hint">{t("phoneUploadHint")}</p>
            {session.error ? <p className="form-error">{session.error.includes("No private LAN") ? t("noLanAddress") : session.error}</p> : null}
            <div className="phone-upload-status">
              <span>{session.running ? t("waitingForPhone") : t("phoneUploadStopped")}</span>
              <strong>{t("uploadedPhotos", "", { count: session.uploadedCount || 0 })}</strong>
            </div>
            {session.lastUpload ? <p className="hint">{t("lastUpload")}: {session.lastUpload}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function BulkEditDialog({ count, countries, types, onClose, onSubmit }) {
  const { t } = useI18n();
  const [countryMode, setCountryMode] = useState("unchanged");
  const [countryId, setCountryId] = useState("");
  const [typeMode, setTypeMode] = useState("unchanged");
  const [typeId, setTypeId] = useState("");
  const [yearMode, setYearMode] = useState("unchanged");
  const [year, setYear] = useState("");
  const [conditionMode, setConditionMode] = useState("unchanged");
  const [condition, setCondition] = useState("");
  const [sourceMode, setSourceMode] = useState("unchanged");
  const [source, setSource] = useState("");
  const [tagMode, setTagMode] = useState("unchanged");
  const [tags, setTags] = useState("");

  function modeSelect(value, setter) {
    return (
      <select value={value} onChange={(event) => setter(event.target.value)}>
        <option value="unchanged">{t("fieldModeUnchanged")}</option>
        <option value="replace">{t("fieldModeReplace")}</option>
      </select>
    );
  }

  function submit(event) {
    event.preventDefault();
    if (!window.confirm(`Apply changes to ${count} selected items?`)) return;
    onSubmit({
      country_id: { mode: countryMode, value: countryId },
      type_id: { mode: typeMode, value: typeId },
      year: { mode: yearMode, value: year },
      condition: { mode: conditionMode, value: condition },
      source: { mode: sourceMode, value: source },
      tags: { mode: tagMode, value: tags }
    });
  }

  return (
    <div className="modal-backdrop">
      <form className="modal bulk-dialog" onSubmit={submit}>
        <header>
          <h2>{t("bulkEditItems")}</h2>
          <button type="button" onClick={onClose}>{t("close")}</button>
        </header>
        <p>{t("selectedCount", "", { count })}</p>
        <div className="bulk-field-grid">
          <label>{t("issuingEntity")}{modeSelect(countryMode, setCountryMode)}<select disabled={countryMode === "unchanged"} value={countryId} onChange={(event) => setCountryId(event.target.value)}><option value="">{t("none")}</option>{orderedRows(countries).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>{t("type")}{modeSelect(typeMode, setTypeMode)}<select disabled={typeMode === "unchanged"} value={typeId} onChange={(event) => setTypeId(event.target.value)}><option value="">{t("none")}</option>{orderedRows(types).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>{t("year")}{modeSelect(yearMode, setYearMode)}<input disabled={yearMode === "unchanged"} value={year} onChange={(event) => setYear(event.target.value)} /></label>
          <label>{t("condition")}{modeSelect(conditionMode, setConditionMode)}<input disabled={conditionMode === "unchanged"} value={condition} onChange={(event) => setCondition(event.target.value)} /></label>
          <label>{t("source")}{modeSelect(sourceMode, setSourceMode)}<input disabled={sourceMode === "unchanged"} value={source} onChange={(event) => setSource(event.target.value)} /></label>
          <label>{t("tagsComma")}<select value={tagMode} onChange={(event) => setTagMode(event.target.value)}><option value="unchanged">{t("fieldModeUnchanged")}</option><option value="add">{t("tagModeAdd")}</option><option value="remove">{t("tagModeRemove")}</option><option value="replace">{t("tagModeReplace")}</option></select><input disabled={tagMode === "unchanged"} value={tags} onChange={(event) => setTags(event.target.value)} /></label>
        </div>
        <footer>
          <button type="button" className="secondary" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" className="primary">{t("applyBulkEdit")}</button>
        </footer>
      </form>
    </div>
  );
}

function BulkCreateDialog({ countries, types, onClose, onSubmit }) {
  const { t } = useI18n();
  const [payload, setPayload] = useState({ country_id: "", type_id: "", year: "", tags: "", source: "", condition: "", titlePrefix: "", titleSuffix: "" });
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const update = (next) => setPayload((current) => ({ ...current, ...next }));
  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      setResult(await onSubmit(payload));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <header>
          <div>
            <h2>{t("createMultipleItems")}</h2>
            <p className="hint">{t("bulkCreateHelp")}</p>
          </div>
          <button type="button" onClick={onClose}>{t("close")}</button>
        </header>
        <div className="bulk-field-grid">
          <label>{t("issuingEntity")}<select value={payload.country_id} onChange={(event) => update({ country_id: event.target.value })}><option value="">{t("none")}</option>{orderedRows(countries).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>{t("type")}<select value={payload.type_id} onChange={(event) => update({ type_id: event.target.value })}><option value="">{t("none")}</option>{orderedRows(types).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>{t("year")}<input value={payload.year} onChange={(event) => update({ year: event.target.value })} /></label>
          <label>{t("tagsComma")}<input value={payload.tags} onChange={(event) => update({ tags: event.target.value })} /></label>
          <label>{t("source")}<input value={payload.source} onChange={(event) => update({ source: event.target.value })} /></label>
          <label>{t("condition")}<input value={payload.condition} onChange={(event) => update({ condition: event.target.value })} /></label>
          <label>{t("titlePrefix")}<input value={payload.titlePrefix} onChange={(event) => update({ titlePrefix: event.target.value })} /></label>
          <label>{t("titleSuffix")}<input value={payload.titleSuffix} onChange={(event) => update({ titleSuffix: event.target.value })} /></label>
        </div>
        {result && !result.canceled && (
          <div className="bulk-result">
            <strong>{t("bulkCreateSummary", "", { created: result.created?.length || 0, failed: result.failed?.length || 0 })}</strong>
            {result.failed?.length ? (
              <details open>
                <summary>{t("bulkCreateErrors")}</summary>
                <ul>
                  {result.failed.map((entry) => <li key={entry.file}>{entry.file}: {entry.error}</li>)}
                </ul>
              </details>
            ) : null}
          </div>
        )}
        <footer>
          <button type="button" className="secondary" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" className="primary" disabled={submitting}>{submitting ? t("loading") : t("chooseImages")}</button>
        </footer>
      </form>
    </div>
  );
}

function BulkAlbumDialog({ count, album, selectedItemIds, onClose, onSubmit }) {
  const { t } = useI18n();
  const pages = album?.pages || [];
  const [pageId, setPageId] = useState(pages[0]?.id || "");
  const [mode, setMode] = useState("cover");
  const [columns, setColumns] = useState(3);
  const [spacing, setSpacing] = useState(24);
  useEffect(() => {
    if (!pageId && pages[0]?.id) setPageId(pages[0].id);
  }, [pageId, pages]);
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ page_id: pageId, item_ids: selectedItemIds, mode, columns, spacing });
      }}>
        <header>
          <h2>{t("addSelectedToAlbum")}</h2>
          <button type="button" onClick={onClose}>{t("close")}</button>
        </header>
        <p>{t("selectedCount", "", { count })}</p>
        {pages.length ? (
          <div className="bulk-field-grid">
            <label>{t("albumTarget")}<select value={pageId} onChange={(event) => setPageId(event.target.value)}>{pages.map((page) => <option key={page.id} value={page.id}>{page.title || `Page ${page.page_number}`}</option>)}</select></label>
            <label>{t("type")}<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="cover">{t("useCoverImage")}</option><option value="allImages">{t("useAllImages")}</option></select></label>
            <label>{t("columns")}<input type="number" min="1" max="8" value={columns} onChange={(event) => setColumns(event.target.value)} /></label>
            <label>{t("spacing")}<input type="number" min="8" max="120" value={spacing} onChange={(event) => setSpacing(event.target.value)} /></label>
          </div>
        ) : (
          <EmptyState title={t("chooseAlbum")} />
        )}
        <footer>
          <button type="button" className="secondary" onClick={onClose}>{t("cancel")}</button>
          <button type="submit" className="primary" disabled={!pageId}>{t("addSelectedToAlbum")}</button>
        </footer>
      </form>
    </div>
  );
}

function TrashView({ rows, onRestore, onPermanentDelete, onEmpty }) {
  const { t } = useI18n();
  return (
    <section className="workspace">
      <header className="topbar compact">
        <div>
          <h1>{t("trashTitle")}</h1>
          <p>{rows.length} records</p>
        </div>
        <button type="button" className="danger" disabled={!rows.length} onClick={onEmpty}>{t("emptyTrash")}</button>
      </header>
      <div className="trash-list">
        {rows.map((row) => (
          <article className="trash-row" key={`${row.type}:${row.id}`}>
            <div>
              <strong>{row.name}</strong>
              <span>{row.type} · {row.subtitle || ""} · {row.deleted_at}</span>
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => onRestore(row)}>{t("restore")}</button>
              <button type="button" className="danger" onClick={() => onPermanentDelete(row)}>{t("permanentlyDelete")}</button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && <EmptyState title={t("trashEmpty")} />}
    </section>
  );
}

const STORAGE_CATEGORY_KEYS = [
  ["database", "database"],
  ["images", "images"],
  ["thumbnails", "thumbnails"],
  ["attachments", "attachments"],
  ["captures", "captures"],
  ["tempCache", "tempCache"]
];

function StorageBackupDialog({ onClose, onMessage }) {
  const { t } = useI18n();
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [restorePreview, setRestorePreview] = useState(null);
  const [health, setHealth] = useState(null);

  async function loadUsage() {
    setLoading(true);
    setError("");
    try {
      setUsage(await api.getStorageUsage());
    } catch (usageError) {
      setError(usageError.message || String(usageError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsage();
  }, []);

  async function runBackup(kind) {
    if (kind === "full" && !window.confirm(`${t("fullBackupWarning")}\n\n${t("fullBackupHelp")}`)) {
      return;
    }
    setBusy(kind);
    setError("");
    try {
      const result = kind === "full" ? await api.backupFull() : await api.backupMetadata();
      if (result?.canceled) {
        onMessage(t("backupCanceled"));
      } else {
        setUsage(result.usage || await api.getStorageUsage());
        onMessage(`${t("backupCreated")} ${result.folder || ""}`.trim());
      }
    } catch (backupError) {
      setError(backupError.message || String(backupError));
      onMessage(`${t("backupFailed")} ${backupError.message || backupError}`);
    } finally {
      setBusy("");
    }
  }

  async function loadRestorePreview() {
    setBusy("restore-preview");
    setError("");
    try {
      const result = await api.previewRestoreBackup();
      if (result?.canceled) {
        onMessage(t("backupCanceled"));
        return;
      }
      setRestorePreview(result);
    } catch (restoreError) {
      setError(restoreError.message || String(restoreError));
      onMessage(`${t("restoreFailed")} ${restoreError.message || restoreError}`);
    } finally {
      setBusy("");
    }
  }

  async function applyRestore() {
    if (!restorePreview?.valid || !restorePreview.folder) return;
    if (!window.confirm(`${t("confirmRestoreBackup")}\n\n${restorePreview.manifest?.kind === "metadata-only" ? t("metadataRestoreWarning") : t("fullRestoreWarning")}`)) {
      return;
    }
    setBusy("restore");
    setError("");
    try {
      const result = await api.restoreBackup({ folder: restorePreview.folder });
      onMessage(`${t("restoreCompleted")} ${t("preRestoreBackup")}: ${result.preRestoreBackupFolder || ""}`.trim());
    } catch (restoreError) {
      setError(restoreError.message || String(restoreError));
      onMessage(`${t("restoreFailed")} ${restoreError.message || restoreError}`);
    } finally {
      setBusy("");
    }
  }

  async function runHealthCheck() {
    setBusy("health");
    setError("");
    try {
      const result = await api.checkArchiveHealth();
      setHealth(result);
      onMessage(t("healthCheckComplete"));
    } catch (healthError) {
      setError(healthError.message || String(healthError));
      onMessage(`${t("healthCheckFailed")} ${healthError.message || healthError}`);
    } finally {
      setBusy("");
    }
  }

  async function regenerateThumbnailsFromHealth() {
    setBusy("thumbnails");
    setError("");
    try {
      const result = await api.regenerateAllThumbnails();
      setHealth(result.health || await api.checkArchiveHealth());
      onMessage(`${t("thumbnailsRegenerated")} ${result.regenerated || 0}`);
    } catch (thumbnailError) {
      setError(thumbnailError.message || String(thumbnailError));
      onMessage(`${t("healthCheckFailed")} ${thumbnailError.message || thumbnailError}`);
    } finally {
      setBusy("");
    }
  }

  async function exportHealthReport() {
    setBusy("health-export");
    setError("");
    try {
      const result = await api.exportHealthReport();
      if (!result?.canceled) {
        onMessage(`${t("healthReportExported")} ${result.filePath || ""}`.trim());
      }
    } catch (reportError) {
      setError(reportError.message || String(reportError));
      onMessage(`${t("healthCheckFailed")} ${reportError.message || reportError}`);
    } finally {
      setBusy("");
    }
  }

  const categories = usage?.categories || {};
  const mediaLabels = [
    ["images", t("images")],
    ["attachments", t("attachments")],
    ["captures", t("captures")]
  ];

  return (
    <div className="modal-backdrop">
      <section className="modal storage-backup-dialog" role="dialog" aria-modal="true" aria-label={t("archiveStorage")}>
        <header>
          <div>
            <h2>{t("archiveStorage")}</h2>
            <p className="hint">{t("storageBackupHelp")}</p>
          </div>
          <button type="button" onClick={onClose}>{t("close")}</button>
        </header>

        <section className="storage-section">
          <div className="storage-section-header">
            <h3>{t("storageUsage")}</h3>
            <button type="button" className="secondary" disabled={loading || Boolean(busy)} onClick={loadUsage}>
              {t("refreshUsage")}
            </button>
          </div>
          {loading ? (
            <p className="quiet">{t("loading")}</p>
          ) : (
            <div className="storage-usage-list">
              {STORAGE_CATEGORY_KEYS.map(([key, labelKey]) => (
                <div className="storage-usage-row" key={key}>
                  <span>{t(labelKey)}</span>
                  <strong>{formatFileSize(categories[key]?.bytes || 0)}</strong>
                  <small>{categories[key]?.files || 0} files</small>
                </div>
              ))}
              <div className="storage-usage-row total">
                <span>{t("total")}</span>
                <strong>{formatFileSize(usage?.totalBytes || 0)}</strong>
                <small>{usage?.dataFolder || ""}</small>
              </div>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
        </section>

        <section className="storage-section health-section">
          <div className="storage-section-header">
            <div>
              <h3>{t("archiveDoctor")}</h3>
              <p className="hint">{t("archiveDoctorHelp")}</p>
            </div>
            <div className="row-actions">
              <button type="button" className="secondary" disabled={Boolean(busy)} onClick={runHealthCheck}>
                {busy === "health" ? t("loading") : t("runHealthCheck")}
              </button>
              <button type="button" className="secondary" disabled={Boolean(busy)} onClick={exportHealthReport}>
                {busy === "health-export" ? t("loading") : t("exportHealthReport")}
              </button>
            </div>
          </div>

          {health ? (
            <div className="health-report">
              <div className="health-summary">
                <span><strong>{health.summary?.okItems || 0}</strong>{t("okItems")}</span>
                <span className={health.summary?.warnings ? "health-warning" : ""}><strong>{health.summary?.warnings || 0}</strong>{t("warnings")}</span>
                <span className={health.summary?.missingFiles ? "health-error" : ""}><strong>{health.summary?.missingFiles || 0}</strong>{t("missingFiles")}</span>
                <span className={health.summary?.orphanFiles ? "health-warning" : ""}><strong>{health.summary?.orphanFiles || 0}</strong>{t("orphanFiles")}</span>
                <span><strong>{formatFileSize(health.summary?.affectedBytes || 0)}</strong>{t("affectedSize")}</span>
              </div>

              <div className="health-actions">
                <button type="button" className="secondary" onClick={() => api.revealDataFolder()}>{t("openDataFolder")}</button>
                <button type="button" className="secondary" disabled={Boolean(busy) || !health.thumbnail?.sourceImagesAvailable} onClick={regenerateThumbnailsFromHealth}>
                  {busy === "thumbnails" ? t("loading") : t("regenerateThumbnails")}
                </button>
              </div>

              <p className={health.thumbnail?.canRegenerate ? "hint" : "warning-text"}>
                {health.thumbnail?.canRegenerate ? t("canRegenerateThumbnails") : t("cannotRegenerateAllThumbnails")}
              </p>

              <details className="health-details" open={Boolean(health.summary?.missingFiles || health.summary?.orphanFiles || health.summary?.warnings)}>
                <summary>{t("healthDetails")}</summary>
                <div className="health-check-list">
                  {(health.checks || []).map((check) => (
                    <div className={`health-check ${check.status}`} key={check.key}>
                      <strong>{check.label}</strong>
                      <span>{check.detail}</span>
                    </div>
                  ))}
                </div>
                {health.warnings?.length > 0 && (
                  <div className="health-issue-list">
                    <h4>{t("warnings")}</h4>
                    {health.warnings.slice(0, 12).map((warning, index) => (
                      <p key={`${warning.kind}-${index}`}>{warning.message || JSON.stringify(warning)}</p>
                    ))}
                  </div>
                )}
                {health.missingFiles?.length > 0 && (
                  <div className="health-issue-list">
                    <h4>{t("missingFiles")}</h4>
                    {health.missingFiles.slice(0, 12).map((entry, index) => (
                      <p key={`${entry.kind}-${entry.id}-${index}`}>{entry.kind}: {entry.label || entry.id || ""} {entry.expectedPath}</p>
                    ))}
                  </div>
                )}
                {health.orphanFiles?.length > 0 && (
                  <div className="health-issue-list">
                    <h4>{t("orphanFiles")}</h4>
                    {health.orphanFiles.slice(0, 12).map((entry, index) => (
                      <p key={`${entry.kind}-${entry.path}-${index}`}>{entry.kind}: {entry.path} ({formatFileSize(entry.bytes || 0)})</p>
                    ))}
                  </div>
                )}
                {!health.summary?.warnings && !health.summary?.missingFiles && !health.summary?.orphanFiles && (
                  <p className="hint">{t("noHealthIssues")}</p>
                )}
              </details>
            </div>
          ) : (
            <p className="hint">{t("dataHealth")}: {t("runHealthCheck")}</p>
          )}
        </section>

        <section className="storage-section backup-options">
          <article>
            <h3>{t("metadataBackup")}</h3>
            <p className="hint">{t("metadataBackupHelp")}</p>
            <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => runBackup("metadata")}>
              {busy === "metadata" ? t("loading") : t("metadataBackup")}
            </button>
          </article>
          <article>
            <h3>{t("fullBackup")}</h3>
            <p className="hint">{t("fullBackupHelp")}</p>
            <p className="warning-text">{t("fullBackupWarning")}</p>
            <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => runBackup("full")}>
              {busy === "full" ? t("loading") : t("fullBackup")}
            </button>
          </article>
        </section>

        <section className="storage-section restore-section">
          <div className="storage-section-header">
            <div>
              <h3>{t("restoreBackup")}</h3>
              <p className="hint">{t("restoreBackupHelp")}</p>
            </div>
            <button type="button" className="secondary" disabled={Boolean(busy)} onClick={loadRestorePreview}>
              {busy === "restore-preview" ? t("loading") : t("loadBackup")}
            </button>
          </div>
          {restorePreview && (
            <div className="restore-preview">
              <h4>{t("restorePreview")}</h4>
              {restorePreview.valid ? (
                <>
                  <dl className="restore-preview-grid">
                    <div><dt>{t("backupType")}</dt><dd>{restorePreview.manifest?.kind || "-"}</dd></div>
                    <div><dt>{t("createdAt")}</dt><dd>{restorePreview.manifest?.created_at || "-"}</dd></div>
                    <div><dt>{t("appVersion")}</dt><dd>{restorePreview.manifest?.version || "-"}</dd></div>
                    <div><dt>{t("currentDataAffected")}</dt><dd>{formatFileSize(restorePreview.currentReplacement?.totalBytes || 0)}</dd></div>
                    <div><dt>{t("itemCount")}</dt><dd>{restorePreview.counts?.items ?? 0}</dd></div>
                    <div><dt>{t("imageMetadataCount")}</dt><dd>{restorePreview.counts?.images ?? 0}</dd></div>
                    <div><dt>{t("albumCount")}</dt><dd>{restorePreview.counts?.albums ?? 0}</dd></div>
                    <div><dt>{t("integrityCheck")}</dt><dd>{restorePreview.integrity?.ok ? "OK" : (restorePreview.integrity?.messages || []).join(", ") || "-"}</dd></div>
                  </dl>
                  <div className="media-status-list" aria-label={t("mediaFolders")}>
                    {mediaLabels.map(([key, label]) => (
                      <span className={restorePreview.media?.[key] ? "media-status included" : "media-status missing"} key={key}>
                        {label}: {restorePreview.media?.[key] ? t("included") : t("missing")}
                      </span>
                    ))}
                  </div>
                  {restorePreview.manifest?.kind === "metadata-only" && <p className="warning-text">{t("metadataRestoreWarning")}</p>}
                  {restorePreview.manifest?.kind === "full" && <p className="warning-text">{t("fullRestoreWarning")}</p>}
                  {restorePreview.foreignKeyWarnings?.length > 0 && (
                    <details className="restore-warnings">
                      <summary>{t("foreignKeyWarnings")}: {restorePreview.foreignKeyWarnings.length}</summary>
                      <ul>
                        {restorePreview.foreignKeyWarnings.slice(0, 20).map((warning, index) => (
                          <li key={`${warning.table}-${warning.rowid}-${index}`}>
                            {warning.table || "-"} row {warning.rowid || "-"} → {warning.parent || "-"}
                          </li>
                        ))}
                        {restorePreview.foreignKeyWarnings.length > 20 && <li>...</li>}
                      </ul>
                    </details>
                  )}
                  <button type="button" className="danger" disabled={busy === "restore"} onClick={applyRestore}>
                    {busy === "restore" ? t("loading") : t("restoreBackup")}
                  </button>
                </>
              ) : (
                <div className="restore-errors">
                  {(restorePreview.errors || []).map((message, index) => (
                    <p className="error-text" key={`${message}-${index}`}>{message}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <footer>
          <button type="button" className="secondary" onClick={() => api.revealDataFolder()}>{t("openDataFolder")}</button>
          <button type="button" onClick={onClose}>{t("close")}</button>
        </footer>
      </section>
    </div>
  );
}

function useInputDiagnostics(context) {
  const contextRef = useRef(context);

  useEffect(() => {
    contextRef.current = context;
    window.__archiveInputContext = context;
  }, [context]);

  useEffect(() => {
    let eventId = 0;
    const meta = new WeakMap();
    const lastValues = new WeakMap();
    const keyboardEvents = ["keydown", "keyup", "beforeinput", "input", "pointerdown", "click"];
    const focusEvents = ["focusin", "focusout"];

    function valueInfo(target) {
      if (!target || !("value" in target)) return {};
      const previous = lastValues.get(target);
      const current = target.value;
      const changed = previous !== undefined && previous !== current;
      lastValues.set(target, current);
      return {
        valueLength: String(current || "").length,
        valueChanged: changed
      };
    }

    function capture(event) {
      const editable = isEditableEvent(event);
      if (editable) {
        event.__archiveEditableTarget = true;
      }
      if (event.type === "focusin" && editable) {
        cancelAppInteractions();
      }
      if (!inputDebugEnabled()) return;
      const id = ++eventId;
      meta.set(event, { id, bubbled: false });
      logInputDebug("document-capture", event, {
        eventId: id,
        phase: "capture",
        editableMarked: Boolean(event.__archiveEditableTarget),
        defaultPreventedBefore: Boolean(event.defaultPrevented),
        ...valueInfo(event.target)
      });
      window.setTimeout(() => {
        const record = meta.get(event);
        if (!record || record.bubbled) return;
        logInputDebug("document-after-capture", event, {
          eventId: record.id,
          phase: "after-capture",
          propagationStoppedBeforeDocumentBubble: true,
          defaultPreventedAfter: Boolean(event.defaultPrevented)
        });
      }, 0);
    }

    function bubble(event) {
      const record = meta.get(event);
      if (record) record.bubbled = true;
      if (!inputDebugEnabled()) return;
      logInputDebug("document-bubble", event, {
        eventId: record?.id || null,
        phase: "bubble",
        defaultPreventedAfter: Boolean(event.defaultPrevented),
        ...valueInfo(event.target)
      });
    }

    function windowCapture(event) {
      const editable = isEditableEvent(event);
      if (editable) {
        event.__archiveEditableTarget = true;
      }
      if (!inputDebugEnabled()) return;
      logInputDebug("window-capture", event, {
        phase: "capture",
        editableMarked: Boolean(event.__archiveEditableTarget),
        defaultPreventedBefore: Boolean(event.defaultPrevented)
      });
    }

    function windowBubble(event) {
      if (!inputDebugEnabled()) return;
      logInputDebug("window-bubble", event, {
        phase: "bubble",
        defaultPreventedAfter: Boolean(event.defaultPrevented)
      });
    }

    [...keyboardEvents, ...focusEvents].forEach((eventName) => {
      window.addEventListener(eventName, windowCapture, true);
      window.addEventListener(eventName, windowBubble, false);
      document.addEventListener(eventName, capture, true);
      document.addEventListener(eventName, bubble, false);
    });
    return () => {
      [...keyboardEvents, ...focusEvents].forEach((eventName) => {
        window.removeEventListener(eventName, windowCapture, true);
        window.removeEventListener(eventName, windowBubble, false);
        document.removeEventListener(eventName, capture, true);
        document.removeEventListener(eventName, bubble, false);
      });
    };
  }, []);
}

function ArchiveApp() {
  const { language, setLanguage, t } = useI18n();
  const libraryPageSize = 100;
  const galleryPageSize = 100;
  const [library, setLibrary] = useState(null);
  const [activeView, setActiveView] = useState("library");
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [album, setAlbum] = useState(null);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [countryFormOpen, setCountryFormOpen] = useState(false);
  const [typeFormOpen, setTypeFormOpen] = useState(false);
  const [albumFormOpen, setAlbumFormOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [phoneUpload, setPhoneUpload] = useState(null);
  const [phoneUploadOpen, setPhoneUploadOpen] = useState(false);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);
  const [bulkAlbumOpen, setBulkAlbumOpen] = useState(false);
  const [trashRows, setTrashRows] = useState([]);
  const [itemsVersion, setItemsVersion] = useState(0);
  const [startupStatus, setStartupStatus] = useState("openingArchive");
  const [startupError, setStartupError] = useState("");
  const [libraryItems, setLibraryItems] = useState({ items: [], total: 0, limit: libraryPageSize, offset: 0, loading: false, loaded: false });
  const [galleryItems, setGalleryItems] = useState({ items: [], total: 0, limit: galleryPageSize, offset: 0, loading: false, loaded: false });
  const [filters, setFilters] = useState({
    search: "",
    country: "",
    entityGroup: "",
    type: "",
    year: "",
    tag: "",
    favorites: false
  });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const libraryRequestRef = useRef(0);
  const galleryRequestRef = useRef(0);
  const startupReadyLoggedRef = useRef(false);
  const inputDebugContext = useMemo(() => ({
    activeView,
    selectedItemId,
    selectedDetailId: detail?.id || null,
    selectedAlbumId,
    selectedLibraryIds,
    modalState: {
      itemFormOpen,
      editingItemId: editingItem?.id || null,
      countryFormOpen,
      typeFormOpen,
      albumFormOpen,
      manageOpen,
      storageOpen,
      bulkEditOpen,
      bulkCreateOpen,
      bulkAlbumOpen,
      phoneUploadOpen
    },
    detailState: detail ? {
      imageCount: detail.images?.length || 0,
      attachmentCount: detail.attachments?.length || 0
    } : null,
    trashCount: trashRows.length
  }), [
    activeView,
    albumFormOpen,
    bulkAlbumOpen,
    bulkCreateOpen,
    bulkEditOpen,
    countryFormOpen,
    detail,
    editingItem,
    itemFormOpen,
    manageOpen,
    phoneUploadOpen,
    storageOpen,
    selectedAlbumId,
    selectedItemId,
    selectedLibraryIds,
    trashRows.length,
    typeFormOpen
  ]);
  useInputDiagnostics(inputDebugContext);

  async function refresh(options = {}) {
    const started = performance.now();
    if (options.startup) setStartupStatus("loadingLibrary");
    perfTrace("library.metadata.start", { startup: Boolean(options.startup) });
    const nextLibrary = await api.getLibrary();
    perfTrace("library.metadata.end", {
      startup: Boolean(options.startup),
      ms: Math.round((performance.now() - started) * 10) / 10,
      countries: nextLibrary.countries?.length || 0,
      types: nextLibrary.types?.length || 0,
      entityGroups: nextLibrary.entityGroups?.length || 0,
      albums: nextLibrary.albums?.length || 0
    });
    setLibrary(nextLibrary);
    if (options.startup) setStartupStatus("preparingInterface");
  }

  useEffect(() => {
    perfTrace("react.app.mounted");
    refresh({ startup: true }).catch((error) => {
      console.error("[startup] renderer initialization failed", error);
      setStartupError(error.message || String(error));
    });
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [filters.search]);

  const itemQuery = useMemo(
    () => ({
      searchText: debouncedSearch,
      countryId: filters.country,
      entityGroupId: filters.entityGroup,
      typeId: filters.type,
      year: filters.year,
      tag: filters.tag,
      favorite: filters.favorites,
      sort: "updated_desc"
    }),
    [debouncedSearch, filters.country, filters.entityGroup, filters.favorites, filters.tag, filters.type, filters.year]
  );

  const reloadLibraryItems = useCallback(
    async (offset = 0, append = false) => {
      const requestId = libraryRequestRef.current + 1;
      libraryRequestRef.current = requestId;
      const traceId = perfTraceEnabled() ? `library-${requestId}-${Date.now()}` : "";
      const started = performance.now();
      perfTrace("library.query.start", { traceId, requestId, offset, append, query: itemQuery });
      setLibraryItems((current) => ({ ...current, loading: true }));
      try {
        const result = await api.queryItems({ ...itemQuery, limit: libraryPageSize, offset, _traceId: traceId, _traceSource: "library" });
        perfTrace("library.query.end", {
          traceId,
          requestId,
          ms: Math.round((performance.now() - started) * 10) / 10,
          rows: result.items.length,
          total: result.total
        });
        if (libraryRequestRef.current !== requestId) return;
        perfTrace("library.state.apply", { traceId, requestId, append, rows: result.items.length, total: result.total });
        setLibraryItems((current) => ({
          ...result,
          loading: false,
          loaded: true,
          items: append ? [...current.items, ...result.items] : result.items
        }));
      } catch (error) {
        if (libraryRequestRef.current === requestId) {
          setLibraryItems((current) => ({ ...current, loading: false, loaded: true }));
          setMessage(`Library load failed: ${error.message || error}`);
        }
        throw error;
      }
    },
    [itemQuery]
  );

  const reloadGalleryItems = useCallback(
    async (offset = 0, append = false) => {
      const requestId = galleryRequestRef.current + 1;
      galleryRequestRef.current = requestId;
      const traceId = perfTraceEnabled() ? `gallery-${requestId}-${Date.now()}` : "";
      const started = performance.now();
      perfTrace("gallery.query.start", { traceId, requestId, offset, append, query: itemQuery });
      setGalleryItems((current) => ({ ...current, loading: true }));
      try {
        const result = await api.queryGalleryItems({ ...itemQuery, limit: galleryPageSize, offset, _traceId: traceId, _traceSource: "gallery" });
        perfTrace("gallery.query.end", {
          traceId,
          requestId,
          ms: Math.round((performance.now() - started) * 10) / 10,
          rows: result.items.length,
          total: result.total
        });
        if (galleryRequestRef.current !== requestId) return;
        perfTrace("gallery.state.apply", { traceId, requestId, append, rows: result.items.length, total: result.total });
        setGalleryItems((current) => ({
          ...result,
          loading: false,
          loaded: true,
          items: append ? [...current.items, ...result.items] : result.items
        }));
      } catch (error) {
        if (galleryRequestRef.current === requestId) {
          setGalleryItems((current) => ({ ...current, loading: false, loaded: true }));
          setMessage(`Gallery load failed: ${error.message || error}`);
        }
        throw error;
      }
    },
    [itemQuery]
  );

  useEffect(() => {
    if (!library || activeView !== "library") return;
    reloadLibraryItems(0, false);
  }, [activeView, debouncedSearch, filters.country, filters.entityGroup, filters.favorites, filters.tag, filters.type, filters.year, itemsVersion, library, reloadLibraryItems]);

  useEffect(() => {
    if (!library || activeView !== "gallery") return;
    reloadGalleryItems(0, false);
  }, [activeView, debouncedSearch, filters.country, filters.entityGroup, filters.favorites, filters.tag, filters.type, filters.year, itemsVersion, library, reloadGalleryItems]);

  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(() => setMessage(""), 1800);
    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    if (!phoneUploadOpen || !phoneUpload?.running) return undefined;
    const interval = window.setInterval(() => {
      api.getPhoneUploadStatus().then((status) => {
        setPhoneUpload(status);
        if (status?.uploadedCount !== phoneUpload.uploadedCount) {
          setItemsVersion((version) => version + 1);
          if (selectedItemId === status.itemId) {
            api.getItem(status.itemId).then(setDetail).catch(() => {});
          }
        }
      }).catch((error) => {
        setMessage(`Phone upload status failed: ${error.message || error}`);
      });
    }, 1200);
    return () => window.clearInterval(interval);
  }, [phoneUpload?.running, phoneUpload?.uploadedCount, phoneUploadOpen, selectedItemId]);

  useEffect(() => {
    if (!perfTraceEnabled()) return undefined;
    const frame = requestAnimationFrame(() => {
      perfTrace("library.render.ready", {
        loading: libraryItems.loading,
        rows: libraryItems.items.length,
        total: libraryItems.total,
        cards: document.querySelectorAll(".item-card").length,
        countText: document.querySelector(".topbar p")?.textContent || ""
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [libraryItems.items, libraryItems.loading, libraryItems.total]);

  useEffect(() => {
    if (!library || startupReadyLoggedRef.current || !libraryItems.loaded || libraryItems.loading) return;
    startupReadyLoggedRef.current = true;
    setStartupStatus("ready");
    requestAnimationFrame(() => {
      perfTrace("startup.firstUsable", {
        libraryRows: libraryItems.items.length,
        libraryTotal: libraryItems.total,
        cards: document.querySelectorAll(".item-card").length
      });
      if (perfTraceEnabled() && api.getStartupTimings) {
        api.getStartupTimings().then((timings) => {
          console.log("[startup-renderer]", {
            firstUsableAt: Math.round(performance.now() * 10) / 10,
            main: timings
          });
        }).catch(() => {});
      }
    });
  }, [library, libraryItems.items.length, libraryItems.loaded, libraryItems.loading, libraryItems.total]);

  useEffect(() => {
    if (!perfTraceEnabled()) return undefined;
    const frame = requestAnimationFrame(() => {
      perfTrace("gallery.render.ready", {
        loading: galleryItems.loading,
        rows: galleryItems.items.length,
        total: galleryItems.total,
        tiles: document.querySelectorAll(".gallery-tile").length
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [galleryItems.items, galleryItems.loading, galleryItems.total]);

  useEffect(() => {
    if (!selectedItemId) {
      setDetail(null);
      return;
    }
    api.getItem(selectedItemId).then(setDetail);
  }, [selectedItemId]);

  useEffect(() => {
    if (!selectedAlbumId) {
      setAlbum(null);
      return;
    }
    api.getAlbum(selectedAlbumId).then(setAlbum);
  }, [selectedAlbumId]);

  useEffect(() => {
    if (activeView !== "trash") return;
    api.listTrash().then(setTrashRows);
  }, [activeView, itemsVersion]);

  useEffect(() => {
    cancelAppInteractions();
  }, [activeView, selectedItemId, selectedAlbumId]);

  function resetTransientInteractionState(reason, options = {}) {
    cancelAppInteractions();
    if (options.clearLibrarySelection !== false) {
      setSelectedLibraryIds([]);
    }
    setBulkEditOpen(false);
    setBulkAlbumOpen(false);
    if (options.closeBulkCreate) {
      setBulkCreateOpen(false);
    }
    const active = document.activeElement;
    if (active && active !== document.body && (!active.isConnected || !isEditableTarget(active))) {
      active.blur?.();
    }
    if (inputDebugEnabled()) {
      console.log("[input-debug]", {
        source: "resetTransientInteractionState",
        reason,
        ...currentInputDebugState()
      });
    }
  }

  async function createItem(payload) {
    const created = await api.createItem(payload);
    await refresh();
    setItemsVersion((version) => version + 1);
    setSelectedItemId(created.id);
    setActiveView("detail");
    setItemFormOpen(false);
    setMessage("Item created.");
  }

  async function editItem(itemId) {
    setEditingItem(await api.getItem(itemId));
  }

  async function updateItem(payload) {
    await api.updateItem(payload);
    await refresh();
    setItemsVersion((version) => version + 1);
    setEditingItem(null);
    setMessage("Item updated.");
    if (selectedItemId === payload.id) {
      setDetail(await api.getItem(payload.id));
    }
  }

  async function deleteItem(itemId) {
    if (!window.confirm("Move this item to Trash?")) return;
    resetTransientInteractionState("deleteItem.start");
    await api.deleteItem(itemId);
    await refresh();
    setItemsVersion((version) => version + 1);
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
      setDetail(null);
      setActiveView("library");
    }
    setSelectedLibraryIds((ids) => ids.filter((id) => id !== itemId));
    resetTransientInteractionState("deleteItem.end", { clearLibrarySelection: false });
    setMessage(t("movedToTrash"));
  }

  async function bulkMoveItemsToTrash(ids) {
    if (!ids.length) return;
    if (!window.confirm(`Move ${ids.length} selected items to Trash?`)) return;
    resetTransientInteractionState("bulkMoveItemsToTrash.start");
    for (const itemId of ids) {
      await api.deleteItem(itemId);
    }
    await refresh();
    setItemsVersion((version) => version + 1);
    setSelectedLibraryIds([]);
    setMessage(t("movedToTrash"));
  }

  async function applyBulkEdit(operations) {
    await api.bulkUpdateItems({ ids: selectedLibraryIds, operations });
    await refresh();
    setItemsVersion((version) => version + 1);
    setBulkEditOpen(false);
    setSelectedLibraryIds([]);
    setMessage(t("bulkEditApplied"));
  }

  async function bulkCreateItems(payload) {
    const result = await api.bulkCreateItemsFromImages(payload);
    if (result?.canceled) return;
    await refresh();
    setItemsVersion((version) => version + 1);
    setMessage(t("bulkCreateSummary", "", { created: result.created?.length || 0, failed: result.failed?.length || 0 }));
    return result;
  }

  async function bulkAddSelectedToAlbum(payload) {
    const result = await api.bulkAddItemsToPage(payload);
    if (result?.album && result.album.id === selectedAlbumId) {
      setAlbum(result.album);
    }
    setBulkAlbumOpen(false);
    setSelectedLibraryIds([]);
    setMessage(t("bulkAlbumAdded", "", { added: result?.added || 0, skipped: result?.skipped?.length || 0 }));
  }

  async function addImages(itemId) {
    try {
      await api.addImages(itemId);
      await refresh();
      setItemsVersion((version) => version + 1);
      setDetail(await api.getItem(itemId));
    } catch (error) {
      setMessage(`Image import failed: ${error.message || error}`);
    }
  }

  async function startPhoneUpload(itemId) {
    try {
      const status = await api.startPhoneUpload({ itemId });
      setPhoneUpload(status);
      setPhoneUploadOpen(true);
      setMessage(t("phoneUploadStarted"));
    } catch (error) {
      setMessage(`Phone upload failed: ${error.message || error}`);
    }
  }

  async function stopPhoneUpload() {
    const status = await api.stopPhoneUpload();
    setPhoneUpload(status);
    setMessage(t("phoneUploadStopped"));
    if (selectedItemId) {
      setDetail(await api.getItem(selectedItemId));
      setItemsVersion((version) => version + 1);
    }
  }

  async function removeImage(imageId, itemId) {
    await api.removeImage(imageId);
    await refresh();
    setItemsVersion((version) => version + 1);
    setDetail(await api.getItem(itemId));
  }

  async function replaceImage(imageId, itemId) {
    const replaced = await api.replaceImage(imageId);
    if (!replaced) return;
    await refresh();
    setItemsVersion((version) => version + 1);
    setDetail(await api.getItem(itemId));
  }

  async function updateImageNote(payload) {
    const updated = await api.updateImageNote(payload);
    if (updated) {
      setDetail(updated);
      setItemsVersion((version) => version + 1);
    }
    setMessage(t("imageNoteSaved"));
  }

  async function createLabelCard(item, draft = null) {
    const coverImage = item.images?.[0] || null;
    const updated = await api.createLabelCard({
      itemId: item.id,
      title: draft?.title ?? item.title,
      subtitle: draft?.subtitle ?? [item.country_name, item.type_name, item.year].filter(Boolean).join(" / "),
      main_text: draft?.main_text ?? item.description ?? "",
      small_notes: draft?.small_notes || "",
      provenance_text: draft?.provenance_text || "",
      catalog_text: draft?.catalog_text || "",
      image_id: draft?.image_id ?? coverImage?.id ?? "",
      image_position: draft?.image_position || (coverImage ? "center-showcase" : "text-only"),
      preset: draft?.preset || "stamp-exhibition",
      style: draft?.style || defaultLabelCardStyle("stamp-exhibition")
    });
    setDetail(updated || await api.getItem(item.id));
    setMessage(t("cardSaved"));
  }

  async function updateLabelCard(payload) {
    const updated = await api.updateLabelCard(payload);
    setDetail(updated || await api.getItem(payload.itemId || selectedItemId));
    setMessage(t("cardSaved"));
  }

  async function deleteLabelCard(cardId) {
    if (!window.confirm(t("deleteLabelCard"))) return;
    const updated = await api.deleteLabelCard(cardId);
    setDetail(updated || (selectedItemId ? await api.getItem(selectedItemId) : null));
    setMessage(t("cardDeleted"));
  }

  async function exportLabelCard(card, images) {
    try {
      const dimensions = labelCardDimensions(card);
      const exportScale = Math.max(1, Math.min(2, Number(card.style?.exportScale || 1)));
      const html = labelCardExportHtml(card, images, exportScale, {
        back: t("backSide"),
        provenance: t("provenanceText"),
        catalog: t("catalogText"),
        acquisition: t("acquisitionNotes"),
        research: t("researchNotes")
      });
      const result = await api.exportLabelCardPng({
        html,
        width: dimensions.width * exportScale,
        height: dimensions.height * exportScale,
        defaultFilename: `${safeExportFilename(card.title || "label-card", "label-card")}.png`
      });
      window.dispatchEvent(new CustomEvent("archive:label-card-exported", { detail: result }));
      if (result?.canceled) {
        setMessage(t("exportCanceled"));
      } else {
        setMessage(result?.filePath ? `${t("cardExported")} ${result.filePath}` : t("cardExported"));
      }
      return result;
    } catch (error) {
      setMessage(`${t("exportCardFailed")} ${error?.message || error}`);
      throw error;
    }
  }

  async function addAttachment(itemId) {
    try {
      const updated = await api.addAttachment(itemId);
      if (updated) {
        setDetail(updated);
        setItemsVersion((version) => version + 1);
      }
    } catch (error) {
      setMessage(`Attachment import failed: ${error.message || error}`);
    }
  }

  async function addWebpageAttachment(payload) {
    try {
      const updated = await api.addWebpageAttachment(payload);
      if (updated) {
        setDetail(updated);
        setItemsVersion((version) => version + 1);
      }
      setMessage(t("attachmentSaved"));
    } catch (error) {
      setMessage(`Webpage attachment failed: ${error.message || error}`);
      throw error;
    }
  }

  async function updateAttachment(payload) {
    const updated = await api.updateAttachment(payload);
    if (updated) {
      setDetail(updated);
      setItemsVersion((version) => version + 1);
    }
    setMessage(t("attachmentSaved"));
  }

  async function openAttachment(attachmentId) {
    try {
      await api.openAttachment(attachmentId);
    } catch (error) {
      setMessage(`Open file failed: ${error.message || error}`);
    }
  }

  async function openAttachmentSource(attachmentId) {
    try {
      await api.openAttachmentSource(attachmentId);
    } catch (error) {
      setMessage(`Open URL failed: ${error.message || error}`);
    }
  }

  async function removeAttachment(attachmentId) {
    const updated = await api.removeAttachment(attachmentId);
    if (updated) {
      setDetail(updated);
      setItemsVersion((version) => version + 1);
    }
    setMessage(t("attachmentRemoved"));
  }

  async function refreshTrash() {
    setTrashRows(await api.listTrash());
  }

  async function restoreTrash(row) {
    await api.restoreTrash(row);
    await refresh();
    await refreshTrash();
    setItemsVersion((version) => version + 1);
    resetTransientInteractionState("restoreTrash.end");
    if (row?.type === "item" && selectedItemId === row.id) {
      setDetail(await api.getItem(row.id).catch(() => null));
    }
    setMessage(t("restoredFromTrash"));
  }

  async function permanentlyDeleteTrash(row) {
    if (!window.confirm("Permanently delete this record? This cannot be undone.")) return;
    resetTransientInteractionState("permanentlyDeleteTrash.start");
    await api.permanentlyDeleteTrash(row);
    await refresh();
    await refreshTrash();
    setItemsVersion((version) => version + 1);
    setMessage(t("permanentlyDeleted"));
  }

  async function emptyTrash() {
    if (!window.confirm("Permanently delete everything in Trash? This cannot be undone.")) return;
    resetTransientInteractionState("emptyTrash.start");
    await api.emptyTrash();
    await refresh();
    await refreshTrash();
    setItemsVersion((version) => version + 1);
    setMessage(t("permanentlyDeleted"));
  }

  async function regenerateThumbnail(imageId, itemId) {
    await api.regenerateThumbnail(imageId);
    await refresh();
    setItemsVersion((version) => version + 1);
    setDetail(await api.getItem(itemId));
    setMessage(t("thumbnailsRegenerated"));
  }

  async function regenerateItemThumbnails(itemId) {
    const updated = await api.regenerateItemThumbnails(itemId);
    await refresh();
    setItemsVersion((version) => version + 1);
    setDetail(updated || await api.getItem(itemId));
    setMessage(t("thumbnailsRegenerated"));
  }

  async function reorderImages(itemId, ids) {
    const updated = await api.reorderImages({ itemId, ids });
    await refresh();
    setItemsVersion((version) => version + 1);
    setDetail(updated || await api.getItem(itemId));
    return updated;
  }

  async function createCountry(payload) {
    await api.createCountry(payload);
    await refresh();
    setCountryFormOpen(false);
    setMessage("Issuing entity created.");
  }

  async function createType(payload) {
    await api.createType(payload);
    await refresh();
    setTypeFormOpen(false);
    setMessage("Collection type created.");
  }

  async function createAlbum(payload) {
    await api.createAlbum(payload);
    await refresh();
    setAlbumFormOpen(false);
    setMessage("Album created.");
  }

  if (!library) {
    return <StartupScreen status={startupStatus} error={startupError} onRetry={() => {
      setStartupError("");
      setStartupStatus("loadingLibrary");
      refresh({ startup: true }).catch((error) => {
        console.error("[startup] renderer retry failed", error);
        setStartupError(error.message || String(error));
      });
    }} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div>
          <div className="brand">{t("appTitle")}</div>
          <nav>
            <button className={activeView === "library" ? "active" : ""} onClick={() => setActiveView("library")}>
              {t("navLibrary")}
            </button>
            <button className={activeView === "gallery" ? "active" : ""} onClick={() => setActiveView("gallery")}>
              {t("navGallery")}
            </button>
            <button className={activeView === "albums" ? "active" : ""} onClick={() => setActiveView("albums")}>
              {t("navAlbums")}
            </button>
            <button className={activeView === "trash" ? "active" : ""} onClick={() => setActiveView("trash")}>
              {t("navTrash")}
            </button>
          </nav>
        </div>
        <div className="sidebar-actions">
          <label className="language-select">
            <span>{t("language")}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </label>
          <button onClick={() => setItemFormOpen(true)}>{t("newItem")}</button>
          <button onClick={() => setManageOpen(true)}>{t("manageLists")}</button>
          <button className="ghost" onClick={() => setStorageOpen(true)}>
            {t("dataFolder")}
          </button>
        </div>
      </aside>

      <main>
        {activeView === "library" && (
          <LibraryView
            library={library}
            items={libraryItems.items}
            total={libraryItems.total}
            loading={libraryItems.loading}
            filters={filters}
            setFilters={setFilters}
            onLoadMore={() => reloadLibraryItems(libraryItems.items.length, true)}
            onOpenItem={(itemId) => {
              setSelectedItemId(itemId);
              setActiveView("detail");
            }}
            onToggleFavorite={async (itemId) => {
              await api.toggleFavorite(itemId);
              setItemsVersion((version) => version + 1);
            }}
            onEditItem={editItem}
            onDeleteItem={deleteItem}
            selectedIds={selectedLibraryIds}
            setSelectedIds={setSelectedLibraryIds}
            onBulkEdit={() => setBulkEditOpen(true)}
            onBulkTrash={() => bulkMoveItemsToTrash(selectedLibraryIds)}
            onBulkAlbum={() => setBulkAlbumOpen(true)}
          />
        )}

        {activeView === "gallery" && (
          <GalleryView
            items={galleryItems.items}
            total={galleryItems.total}
            loading={galleryItems.loading}
            onLoadMore={() => reloadGalleryItems(galleryItems.items.length, true)}
            onToggleFavorite={async (itemId) => {
              await api.toggleFavorite(itemId);
              setItemsVersion((version) => version + 1);
            }}
            onOpenItem={(itemId) => {
              setSelectedItemId(itemId);
              setActiveView("detail");
            }}
          />
        )}

        {activeView === "detail" && (
          <DetailView
            detail={detail}
            countries={library.countries}
            types={library.types}
            onBack={() => setActiveView("library")}
            onAddImages={addImages}
            onStartPhoneUpload={startPhoneUpload}
            onRemoveImage={removeImage}
            onReplaceImage={replaceImage}
            onReorderImages={reorderImages}
            onUpdateImageNote={updateImageNote}
            onCreateLabelCard={createLabelCard}
            onUpdateLabelCard={updateLabelCard}
            onDeleteLabelCard={deleteLabelCard}
            onExportLabelCard={exportLabelCard}
            onAddAttachment={addAttachment}
            onAddWebpageAttachment={addWebpageAttachment}
            onUpdateAttachment={updateAttachment}
            onOpenAttachment={openAttachment}
            onOpenAttachmentSource={openAttachmentSource}
            onRemoveAttachment={removeAttachment}
            onUpdate={async (payload) => {
              await updateItem(payload);
            }}
            onToggleFavorite={async (itemId) => {
              await api.toggleFavorite(itemId);
              setItemsVersion((version) => version + 1);
              if (selectedItemId === itemId) {
                setDetail(await api.getItem(itemId));
              }
            }}
            onDeleteItem={deleteItem}
          />
        )}

        {activeView === "albums" && (
          <AlbumsView
            library={library}
            selectedAlbumId={selectedAlbumId}
            setSelectedAlbumId={setSelectedAlbumId}
            album={album}
            onNewAlbum={() => setAlbumFormOpen(true)}
            onCreatePage={async (payload) => {
              const updated = await api.createAlbumPage(payload);
              setAlbum(updated);
              await refresh();
            }}
            onAddItemToPage={async (payload) => {
              const updated = await api.addItemToPage(payload);
              setAlbum(updated);
              setItemsVersion((version) => version + 1);
              return updated;
            }}
            onBulkAddItemsToPage={async (payload) => {
              const result = await api.bulkAddItemsToPage(payload);
              if (result?.album) {
                setAlbum(result.album);
              }
              setMessage(t("bulkAlbumAdded", "", { added: result?.added || 0, skipped: result?.skipped?.length || 0 }));
              return result;
            }}
            onAddTextToPage={async (payload) => {
              const updated = await api.addTextToPage(payload);
              setAlbum(updated);
              return updated;
            }}
            onRemoveItemFromPage={async (id) => {
              const updated = await api.removeItemFromPage(id);
              setAlbum(updated);
            }}
            onUpdateAlbum={async (payload) => {
              const updated = await api.updateAlbum(payload);
              setAlbum(updated);
              await refresh();
              setMessage("Album updated.");
            }}
            onDeleteAlbum={async (id) => {
              if (!window.confirm("Delete this album? Collectible items will not be deleted.")) return;
              await api.deleteAlbum(id);
              setSelectedAlbumId(null);
              setAlbum(null);
              await refresh();
              setMessage("Album deleted.");
            }}
            onUpdatePage={async (payload) => {
              const updated = await api.updateAlbumPage(payload);
              setAlbum(updated);
              setMessage("Page updated.");
              return updated;
            }}
            onReorderPages={async (payload) => {
              const updated = await api.reorderAlbumPages(payload);
              setAlbum(updated);
              await refresh();
              setMessage("Page order saved.");
              return updated;
            }}
            onDeletePage={async (id) => {
              if (!window.confirm("Delete this album page and its placements?")) return;
              const updated = await api.deleteAlbumPage(id);
              setAlbum(updated);
              setMessage("Page deleted.");
              return updated;
            }}
            onCopyPage={async (payload) => {
              const result = await api.copyAlbumPage(payload);
              if (result?.album && result.album.id === selectedAlbumId) {
                setAlbum(result.album);
              }
              await refresh();
              return result;
            }}
            onUpdatePageItem={async (payload) => {
              const updated = await api.updateAlbumPageItem(payload);
              setAlbum(updated);
              return updated;
            }}
            onMessage={setMessage}
          />
        )}

        {activeView === "trash" && (
          <TrashView
            rows={trashRows}
            onRestore={restoreTrash}
            onPermanentDelete={permanentlyDeleteTrash}
            onEmpty={emptyTrash}
          />
        )}
      </main>
      {message && (
        <button type="button" className="toast" onClick={() => setMessage("")}>
          {message}
        </button>
      )}

      {phoneUploadOpen && phoneUpload && (
        <PhoneUploadDialog
          session={phoneUpload}
          onClose={() => setPhoneUploadOpen(false)}
          onStop={stopPhoneUpload}
        />
      )}

      {itemFormOpen && (
        <ItemForm
          title={t("newItemTitle")}
          countries={library.countries}
          types={library.types}
          onClose={() => setItemFormOpen(false)}
          onBulkCreate={() => {
            setItemFormOpen(false);
            setBulkCreateOpen(true);
          }}
          onSubmit={createItem}
        />
      )}
      {editingItem && (
        <ItemForm
          title={t("editItemTitle")}
          item={editingItem}
          countries={library.countries}
          types={library.types}
          onClose={() => setEditingItem(null)}
          onSubmit={(payload) => updateItem({ ...payload, id: editingItem.id })}
        />
      )}
      {countryFormOpen && <NameForm title={t("newIssuingEntity")} label={t("name")} onClose={() => setCountryFormOpen(false)} onSubmit={createCountry} />}
      {typeFormOpen && <NameForm title={t("newCollectionType")} label={t("name")} onClose={() => setTypeFormOpen(false)} onSubmit={createType} />}
      {albumFormOpen && <NameForm title={t("newAlbum")} label={t("title")} extraLabel={t("description")} onClose={() => setAlbumFormOpen(false)} onSubmit={createAlbum} />}
      {manageOpen && (
        <ManageLists
          library={library}
          onClose={() => setManageOpen(false)}
          onRefresh={refresh}
          onMessage={setMessage}
        />
      )}
      {storageOpen && (
        <StorageBackupDialog
          onClose={() => setStorageOpen(false)}
          onMessage={setMessage}
        />
      )}
      {bulkEditOpen && (
        <BulkEditDialog
          count={selectedLibraryIds.length}
          countries={library.countries}
          types={library.types}
          onClose={() => setBulkEditOpen(false)}
          onSubmit={applyBulkEdit}
        />
      )}
      {bulkCreateOpen && (
        <BulkCreateDialog
          countries={library.countries}
          types={library.types}
          onClose={() => setBulkCreateOpen(false)}
          onSubmit={bulkCreateItems}
        />
      )}
      {bulkAlbumOpen && (
        <BulkAlbumDialog
          count={selectedLibraryIds.length}
          albums={library.albums}
          album={album}
          selectedAlbumId={selectedAlbumId}
          selectedItemIds={selectedLibraryIds}
          onClose={() => setBulkAlbumOpen(false)}
          onSubmit={bulkAddSelectedToAlbum}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <I18nProvider>
      <ArchiveApp />
    </I18nProvider>
  );
}

function LibraryView({ library, items, total, loading, filters, setFilters, onLoadMore, onOpenItem, onToggleFavorite, onEditItem, onDeleteItem, selectedIds = [], setSelectedIds, onBulkEdit, onBulkTrash, onBulkAlbum }) {
  const { t } = useI18n();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  function toggleSelected(itemId, checked) {
    setSelectedIds((current) => checked ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId));
  }
  return (
    <section className="workspace">
      <header className="topbar library-header">
        <div className="library-title-row">
          <h1>{t("libraryTitle")}</h1>
          <p>{t("libraryCount", "", { shown: items.length, total })}</p>
        </div>
        <FilterBar library={library} filters={filters} setFilters={setFilters} />
      </header>
      {selectedIds.length > 0 && (
        <div className="bulk-action-bar">
          <strong>{t("selectedCount", "", { count: selectedIds.length })}</strong>
          <button type="button" onClick={onBulkEdit}>{t("editSelected")}</button>
          <button type="button" onClick={onBulkAlbum}>{t("addSelectedToAlbum")}</button>
          <button type="button" className="danger" onClick={onBulkTrash}>{t("moveSelectedToTrash")}</button>
          <button type="button" className="ghost" onClick={() => setSelectedIds([])}>{t("clearSelection")}</button>
        </div>
      )}
      <div className="item-grid">
        {items.map((item) => (
          <article className={`item-card ${selectedSet.has(item.id) ? "selected" : ""}`} key={item.id}>
            <label className="item-select-check" aria-label={`Select ${item.title}`}>
              <input
                type="checkbox"
                checked={selectedSet.has(item.id)}
                onChange={(event) => toggleSelected(item.id, event.target.checked)}
              />
            </label>
            <button
              className={`favorite ${item.favorite ? "active" : ""}`}
              onClick={() => onToggleFavorite(item.id)}
              aria-label={item.favorite ? t("removeFromFavorites") : t("addToFavorites")}
              title={item.favorite ? t("removeFromFavorites") : t("addToFavorites")}
            >
              {item.favorite ? "\u2605" : "\u2606"}
            </button>
            <button className="image-button" onClick={() => onOpenItem(item.id)}>
              <ItemImage image={item.cover} alt={item.title} />
            </button>
            <div className="item-card-body">
              <button className="title-button" onClick={() => onOpenItem(item.id)}>
                {item.title}
              </button>
              <div className="muted-row">
                <span>{item.country_name || t("noIssuingEntity")}</span>
                <span>{item.type_name || t("noType")}</span>
                <span>{item.year || t("noYear")}</span>
              </div>
              <div className="tag-row">
                {item.tags.slice(0, 4).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className="card-actions">
                <button type="button" onClick={() => onEditItem(item.id)}>{t("edit")}</button>
                <button type="button" className="danger" onClick={() => onDeleteItem(item.id)}>{t("delete")}</button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {items.length === 0 && loading && <LoadingState title={t("loadingLibraryItems")} />}
      {items.length < total && (
        <div className="load-more">
          <button type="button" disabled={loading} onClick={onLoadMore}>
            {loading ? t("loading") : t("loadMoreItems")}
          </button>
          <span>{items.length} of {total}</span>
        </div>
      )}
      {items.length === 0 && !loading && <EmptyState title={t("noItemsMatch")} />}
    </section>
  );
}

function FilterBar({ library, filters, setFilters }) {
  const { t } = useI18n();
  function update(next) {
    setFilters({ ...filters, ...next });
  }

  const hasFilters = Boolean(filters.search || filters.country || filters.entityGroup || filters.type || filters.year || filters.tag || filters.favorites);

  function clearFilters() {
    setFilters({
      search: "",
      country: "",
      entityGroup: "",
      type: "",
      year: "",
      tag: "",
      favorites: false
    });
  }

  return (
    <div className="filters">
      <div className="filter-search-row">
        <div className="search-filter">
          <input
            data-input-debug="Library search"
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
          />
          {filters.search && <button type="button" aria-label={t("clearSearch")} onClick={() => update({ search: "" })}>X</button>}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={filters.favorites}
            onChange={(event) => update({ favorites: event.target.checked })}
          />
          {t("favorites")}
        </label>
      </div>
      <div className="filter-control-row">
        <SearchableCombobox
          rows={library.countries}
          value={filters.country}
          onChange={(value) => update({ country: value })}
          allLabel={t("allIssuingEntities")}
          searchPlaceholder={t("searchIssuingEntities")}
          searchLabel={t("searchIssuingEntities")}
          clearLabel={t("clearIssuingEntity")}
          className="filter-combobox"
        />
        <SearchableCombobox
          rows={library.entityGroups || []}
          value={filters.entityGroup}
          onChange={(value) => update({ entityGroup: value })}
          allLabel={t("allEntityGroups")}
          searchPlaceholder="Search entity groups..."
          searchLabel="Search entity groups"
          clearLabel="Clear entity group filter"
          className="filter-combobox"
        />
        <select value={filters.type} onChange={(event) => update({ type: event.target.value })}>
          <option value="">{t("allTypes")}</option>
          {orderedRows(library.types).map((type) => (
            <option value={type.id} key={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <input data-input-debug="Library year filter" value={filters.year} onChange={(event) => update({ year: event.target.value })} placeholder={t("year")} />
        <label className="filter-tag-field">
          <input data-input-debug="Library tag filter" value={filters.tag} onChange={(event) => update({ tag: event.target.value })} placeholder={t("tagsComma")} aria-label={t("tagsComma")} />
          <span>{t("multiTagsHint")}</span>
        </label>
        <button type="button" className="secondary clear-filters" disabled={!hasFilters} onClick={clearFilters}>{t("clearFilters")}</button>
      </div>
    </div>
  );
}

function GalleryView({ items, total, loading, onLoadMore, onOpenItem, onToggleFavorite }) {
  const { t } = useI18n();
  const [viewerIndex, setViewerIndex] = useState(null);
  const viewerImages = useMemo(() => items.map((item) => ({
    ...item.cover,
    itemId: item.id,
    title: item.title
  })), [items]);

  useEffect(() => {
    setViewerIndex(null);
  }, [items]);

  return (
    <section className="workspace">
      <header className="topbar compact">
        <div>
          <h1>{t("galleryTitle")}</h1>
          <p>{t("gallerySubtitle")}</p>
        </div>
      </header>
      <div className="gallery-grid">
        {items.map((item, index) => (
          <article className="gallery-tile" key={item.id} style={{ "--ratio": item.cover.aspect_ratio || 1 }}>
            <button
              className={`favorite gallery-favorite ${item.favorite ? "active" : ""}`}
              type="button"
              onClick={() => onToggleFavorite(item.id)}
              aria-label={item.favorite ? t("removeFromFavorites") : t("addToFavorites")}
              title={item.favorite ? t("removeFromFavorites") : t("addToFavorites")}
            >
              {item.favorite ? "\u2605" : "\u2606"}
            </button>
            <button className="gallery-image-trigger" type="button" onClick={() => setViewerIndex(index)}>
              <MediaImage src={item.cover.thumbnailUrl} alt={item.title} context={`Gallery: ${item.title}`} />
            </button>
            <div className="gallery-caption">
              <span>{item.title}</span>
              <button type="button" onClick={() => onOpenItem(item.id)}>{t("details")}</button>
            </div>
          </article>
        ))}
      </div>
      {items.length === 0 && loading && <LoadingState title={t("loadingGalleryItems")} />}
      {items.length < total && (
        <div className="load-more">
          <button type="button" disabled={loading} onClick={onLoadMore}>
            {loading ? t("loading") : t("loadMoreGallery")}
          </button>
          <span>{items.length} of {total}</span>
        </div>
      )}
      {items.length === 0 && !loading && <EmptyState title={t("noItemImages")} />}
      {viewerIndex !== null && (
        <ImageViewer
          images={viewerImages}
          initialIndex={viewerIndex}
          title={viewerImages[viewerIndex]?.title || "Gallery image"}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </section>
  );
}

function DetailView({ detail, countries, types, onBack, onAddImages, onStartPhoneUpload, onRemoveImage, onReplaceImage, onReorderImages, onUpdateImageNote, onCreateLabelCard, onUpdateLabelCard, onDeleteLabelCard, onExportLabelCard, onAddAttachment, onAddWebpageAttachment, onUpdateAttachment, onOpenAttachment, onOpenAttachmentSource, onRemoveAttachment, onUpdate, onToggleFavorite, onDeleteItem }) {
  const { t } = useI18n();
  const [activeImage, setActiveImage] = useState(0);
  const [editing, setEditing] = useState(false);
  const [dragImageId, setDragImageId] = useState("");
  const [imageNoteDraft, setImageNoteDraft] = useState("");

  useEffect(() => {
    setActiveImage(0);
    setEditing(false);
  }, [detail?.id]);

  useEffect(() => {
    if (detail && activeImage >= detail.images.length) {
      setActiveImage(Math.max(0, detail.images.length - 1));
    }
  }, [detail, activeImage]);

  const image = detail?.images?.[activeImage] || null;

  useEffect(() => {
    setImageNoteDraft(image?.note || "");
  }, [image?.id, image?.note]);

  useEffect(() => {
    window.__archiveDetailInputContext = {
      detailId: detail?.id || null,
      activeImageId: image?.id || null,
      activeImageIndex: activeImage,
      attachmentIds: (detail?.attachments || []).map((attachment) => attachment.id)
    };
    return () => {
      if (window.__archiveDetailInputContext?.detailId === detail?.id) {
        window.__archiveDetailInputContext = {};
      }
    };
  }, [activeImage, detail?.attachments, detail?.id, image?.id]);

  const viewerImages = useMemo(
    () => (detail?.images || []).map((entry) => ({ ...entry, title: entry.original_filename })),
    [detail?.images]
  );

  if (!detail) {
    return (
      <section className="workspace">
        <button className="back" onClick={onBack}>{t("back")}</button>
        <EmptyState title={t("selectItem")} />
      </section>
    );
  }

  async function saveImageNote(targetImage = image, note = imageNoteDraft) {
    if (!targetImage || String(note || "") === String(targetImage.note || "")) return;
    await onUpdateImageNote({ imageId: targetImage.id, note });
  }

  async function reorderImageDrop(targetImageId) {
    if (!dragImageId || dragImageId === targetImageId) {
      setDragImageId("");
      return;
    }
    const ids = detail.images.map((entry) => entry.id);
    const from = ids.indexOf(dragImageId);
    const to = ids.indexOf(targetImageId);
    if (from < 0 || to < 0) {
      setDragImageId("");
      return;
    }
    const nextIds = [...ids];
    const [moved] = nextIds.splice(from, 1);
    nextIds.splice(to, 0, moved);
    const activeImageId = image?.id;
    const updated = await onReorderImages(detail.id, nextIds);
    const nextImages = updated?.images || detail.images;
    const nextActiveIndex = nextImages.findIndex((entry) => entry.id === activeImageId);
    setActiveImage(Math.max(0, nextActiveIndex));
    setDragImageId("");
  }

  return (
    <section className="detail-view">
      <header className="detail-header">
        <button className="back" onClick={onBack}>{t("back")}</button>
        <div>
          <h1>{detail.title}</h1>
          <p>{[detail.country_name, detail.type_name, detail.year].filter(Boolean).join(" / ") || "Unclassified"}</p>
        </div>
        <div className="header-actions">
          <button
            className={`favorite detail-favorite ${detail.favorite ? "active" : ""}`}
            type="button"
            onClick={() => onToggleFavorite(detail.id)}
            aria-label={detail.favorite ? t("removeFromFavorites") : t("addToFavorites")}
            title={detail.favorite ? t("removeFromFavorites") : t("addToFavorites")}
          >
            {detail.favorite ? "\u2605" : "\u2606"}
          </button>
          <button onClick={() => setEditing(true)}>{t("edit")}</button>
          <button className="danger" onClick={() => onDeleteItem(detail.id)}>{t("delete")}</button>
          <button onClick={() => onAddImages(detail.id)}>{t("addImages")}</button>
          <button className="secondary" onClick={() => onStartPhoneUpload(detail.id)}>{t("importFromPhone")}</button>
        </div>
      </header>
      <div className="detail-layout">
        <ZoomableImageViewer image={image} alt={detail.title} context={`Detail preview: ${detail.title}`} className="preview-panel" />
        <aside className="metadata-panel">
          <h2>{t("metadata")}</h2>
          <dl>
            <div><dt>{t("issuingEntity")}</dt><dd>{detail.country_name || "-"}</dd></div>
            <div><dt>Entity Groups</dt><dd>{detail.entity_group_names || "-"}</dd></div>
            <div><dt>{t("condition")}</dt><dd>{detail.condition || "-"}</dd></div>
            <div><dt>{t("purchasePrice")}</dt><dd>{detail.purchase_price || "-"}</dd></div>
            <div><dt>{t("source")}</dt><dd>{detail.source || "-"}</dd></div>
            <div><dt>Images</dt><dd>{detail.images.length}</dd></div>
          </dl>
          <p className="description">{detail.description || "No description."}</p>
          <div className="tag-row">
            {detail.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <div className="custom-fields">
            {Object.entries(detail.customFields || {}).map(([key, value]) => (
              <div key={key}><strong>{key}</strong><span>{value}</span></div>
            ))}
          </div>
          {image && (
            <div className="image-note-panel">
              <label>
                {t("imageNote")}
                <textarea
                  data-input-debug="Image note"
                  value={imageNoteDraft}
                  placeholder={t("imageNotePlaceholder")}
                  onChange={(event) => setImageNoteDraft(event.target.value)}
                  onBlur={() => saveImageNote()}
                />
              </label>
              <details className="technical-details">
                <summary>{t("technicalDetails")}</summary>
                <div className="image-meta">
                  <span>{image.original_filename}</span>
                  <span>{image.width} x {image.height}</span>
                  <span>Aspect {Number(image.aspect_ratio).toFixed(3)}</span>
                </div>
              </details>
            </div>
          )}
          {image && (
            <div className="image-actions">
              <button type="button" onClick={() => onReplaceImage(image.id, detail.id)}>{t("replaceImage")}</button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  if (!window.confirm(`Remove "${image.original_filename}" from this item?`)) return;
                  await onRemoveImage(image.id, detail.id);
                  setActiveImage((current) => Math.max(0, current - 1));
                }}
              >
                {t("removeImage")}
              </button>
            </div>
          )}
          <div className="thumb-strip">
            {detail.images.map((thumb, index) => (
              <button
                className={`${index === activeImage ? "active" : ""} ${dragImageId === thumb.id ? "dragging" : ""}`}
                key={thumb.id}
                draggable
                title="Drag to reorder item images"
                onClick={async () => {
                  await saveImageNote();
                  setActiveImage(index);
                }}
                onDragStart={(event) => {
                  setDragImageId(thumb.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", thumb.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDragEnd={() => setDragImageId("")}
                onDrop={(event) => {
                  event.preventDefault();
                  reorderImageDrop(thumb.id);
                }}
              >
                <MediaImage src={thumb.thumbnailUrl} alt={thumb.original_filename} context={`Detail thumbnail: ${thumb.original_filename}`} />
              </button>
            ))}
          </div>
          {viewerImages.length > 0 && (
            <ImageViewerButton images={viewerImages} activeImage={activeImage} title={detail.title} />
          )}
          <LabelCardsSection
            item={detail}
            cards={detail.labelCards || []}
            images={detail.images || []}
            onCreate={onCreateLabelCard}
            onUpdate={onUpdateLabelCard}
            onDelete={onDeleteLabelCard}
            onExport={onExportLabelCard}
          />
          <AttachmentsSection
            itemId={detail.id}
            attachments={detail.attachments || []}
            onAdd={onAddAttachment}
            onAddWebpage={onAddWebpageAttachment}
            onUpdate={onUpdateAttachment}
            onOpen={onOpenAttachment}
            onOpenSource={onOpenAttachmentSource}
            onRemove={onRemoveAttachment}
          />
        </aside>
      </div>
      {editing && (
        <ItemForm
          title={t("editItemTitle")}
          item={detail}
          countries={countries}
          types={types}
          onClose={() => {
            setEditing(false);
          }}
          onSubmit={async (payload) => {
            await onUpdate({ ...payload, id: detail.id });
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}

function ImageViewerButton({ images, activeImage, title }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>{t("openViewer")}</button>
      {open && <ImageViewer images={images} initialIndex={activeImage} title={title} onClose={() => {
        setOpen(false);
      }} />}
    </>
  );
}

function normalizeLabelCardPreset(preset) {
  const aliases = { museum: "museum-specimen", classic: "stamp-exhibition", vintage: "museum-specimen" };
  const normalized = aliases[preset] || preset;
  return LABEL_CARD_PRESETS.some((option) => option.value === normalized) ? normalized : "museum-specimen";
}

function labelCardPresetDefaults(preset) {
  return LABEL_CARD_PRESETS.find((option) => option.value === normalizeLabelCardPreset(preset))?.defaults || LABEL_CARD_PRESETS[1].defaults;
}

function labelCardPresetOption(preset) {
  return LABEL_CARD_PRESETS.find((option) => option.value === normalizeLabelCardPreset(preset)) || LABEL_CARD_PRESETS[1];
}

function labelCardSizeOption(value) {
  return LABEL_CARD_SIZES.find((option) => option.value === value) || LABEL_CARD_SIZES[1];
}

function labelCardMaterialOption(value) {
  return LABEL_CARD_MATERIALS.find((option) => option.value === value) || LABEL_CARD_MATERIALS[0];
}

function labelCardDimensions(card) {
  return labelCardSizeOption(card?.style?.cardSize || labelCardPresetDefaults(card?.preset).cardSize);
}

function normalizeLabelCardLayout(value) {
  if (value === "right") return "left";
  if (value === "image-only") return "center-showcase";
  return LABEL_CARD_IMAGE_POSITIONS.some((option) => option.value === value) ? value : "center-showcase";
}

function defaultLabelCardStyle(preset = "museum-specimen") {
  return { ...labelCardPresetDefaults(preset) };
}

function normalizeLabelCardPresentation(card) {
  const preset = normalizeLabelCardPreset(card?.preset || "museum-specimen");
  const style = { ...defaultLabelCardStyle(preset), ...(card?.style || {}) };
  const imagePosition = normalizeLabelCardLayout(card?.image_position);
  const dimensions = labelCardSizeOption(style.cardSize || labelCardPresetDefaults(preset).cardSize);
  const material = LABEL_CARD_MATERIALS.some((option) => option.value === style.material) ? style.material : "cream-paper";
  const frame = LABEL_CARD_FRAMES.some((option) => option.value === style.frame) ? style.frame : "thin-double";
  const edge = LABEL_CARD_EDGES.some((option) => option.value === style.edge) ? style.edge : "square";
  const side = style.side === "back" ? "back" : "front";
  const normalizedCard = { ...card, preset, image_position: imagePosition, style: { ...style, material, frame, edge, side } };
  return { card: normalizedCard, preset, style: normalizedCard.style, imagePosition, dimensions, material, frame, edge, side };
}

function labelCardDraftFrom(card, item) {
  const preset = normalizeLabelCardPreset(card?.preset || "stamp-exhibition");
  return {
    id: card?.id || "",
    itemId: item.id,
    title: card?.title || item.title || "",
    subtitle: card?.subtitle || "",
    main_text: card?.main_text || "",
    small_notes: card?.small_notes || "",
    provenance_text: card?.provenance_text || "",
    catalog_text: card?.catalog_text || "",
    image_id: card?.image_id || "",
    image_position: normalizeLabelCardLayout(card?.image_position || labelCardPresetOption(preset).defaultImagePosition),
    preset,
    style: { ...defaultLabelCardStyle(preset), ...(card?.style || {}) }
  };
}

function labelCardImage(card, images) {
  const imageId = card?.image_id || card?.imageId;
  return images.find((image) => image.id === imageId) || card?.image || null;
}

function labelCardSecondaryImage(card, images) {
  const imageId = card?.style?.secondaryImageId;
  return imageId ? images.find((image) => image.id === imageId) || null : null;
}

function labelCardClass(card) {
  const presentation = normalizeLabelCardPresentation(card);
  return `label-card-preview preset-${presentation.preset} image-${presentation.imagePosition} size-${presentation.dimensions.value} material-${presentation.material} frame-${presentation.frame} edge-${presentation.edge} side-${presentation.side} ${presentation.style.border === false ? "no-border" : ""}`;
}

function labelCardStyle(card) {
  const { style, dimensions } = normalizeLabelCardPresentation(card);
  return {
    "--card-font-size": `${Math.max(10, Number(style.fontSize || 16))}px`,
    "--card-align": style.alignment || "left",
    "--card-bg": style.backgroundColor || "#f7f1e4",
    "--card-text": style.textColor || "#283331",
    "--card-aspect": `${dimensions.width} / ${dimensions.height}`,
    "--texture-intensity": `${Math.max(0, Math.min(100, Number(style.textureIntensity ?? 40))) / 100}`,
    "--surface-brightness": `${Math.max(70, Math.min(130, Number(style.brightness ?? 100)))}%`,
    "--surface-aging": `${Math.max(0, Math.min(100, Number(style.aging ?? 0))) / 100}`
  };
}

function LabelCardPreview({ card, images }) {
  const { t } = useI18n();
  const presentation = normalizeLabelCardPresentation(card);
  const { card: normalizedCard, style, side, imagePosition } = presentation;
  const image = labelCardImage(normalizedCard, images);
  const secondaryImage = labelCardSecondaryImage(normalizedCard, images);
  const showImage = side === "front" && imagePosition !== "text-only" && image?.url;
  const showSecondary = showImage && ["pair", "main-detail"].includes(imagePosition) && secondaryImage?.url;
  return (
    <article className={`${labelCardClass(normalizedCard)} ${showImage ? "" : "no-image"}`} style={labelCardStyle(normalizedCard)}>
      <div className="label-card-surface" aria-hidden="true" />
      <div className="label-card-ornament" aria-hidden="true" />
      {side === "front" ? <>
        {showImage && (
        <div className={`label-card-media ${showSecondary ? "has-secondary" : ""}`}>
          {[image, showSecondary ? secondaryImage : null].filter(Boolean).map((cardImage, index) => (
            <figure className="label-card-image" key={cardImage.id || index}>
              <span className="label-card-image-frame">
                <MediaImage src={cardImage.thumbnailUrl || cardImage.url} alt={card.title || cardImage.original_filename || ""} context={`Label card: ${card.title || ""}`} />
              </span>
            </figure>
          ))}
        </div>
        )}
        <div className="label-card-text">
          {card.title && <h3>{card.title}</h3>}
          {card.subtitle && <p className="label-card-subtitle">{card.subtitle}</p>}
          {card.main_text && <p className="label-card-main">{card.main_text}</p>}
          {card.small_notes && <p className="label-card-small">{card.small_notes}</p>}
          {(card.provenance_text || card.catalog_text) && (
            <div className="label-card-refbar">
              {card.provenance_text && <p className="label-card-meta">{card.provenance_text}</p>}
              {card.catalog_text && <p className="label-card-meta">{card.catalog_text}</p>}
            </div>
          )}
        </div>
      </> : (
        <div className="label-card-back">
          <header><span>{t("backSide")}</span>{card.title && <h3>{card.title}</h3>}</header>
          <div className="label-card-back-fields">
            {card.provenance_text && <div><strong>{t("provenanceText")}</strong><p>{card.provenance_text}</p></div>}
            {card.catalog_text && <div><strong>{t("catalogText")}</strong><p>{card.catalog_text}</p></div>}
            {style.backAcquisitionNotes && <div><strong>{t("acquisitionNotes")}</strong><p>{style.backAcquisitionNotes}</p></div>}
            {style.backResearchNotes && <div><strong>{t("researchNotes")}</strong><p>{style.backResearchNotes}</p></div>}
          </div>
        </div>
      )}
    </article>
  );
}

let cachedLabelCardStylesheet = "";

function labelCardStylesheetText() {
  if (cachedLabelCardStylesheet) return cachedLabelCardStylesheet;
  const css = Array.from(document.styleSheets).flatMap((sheet) => {
    try {
      return Array.from(sheet.cssRules || [], (rule) => rule.cssText);
    } catch {
      return [];
    }
  }).join("\n");
  if (!css.includes(".label-card-preview") || !css.includes(".frame-wood-slot") || !css.includes(".edge-embossed")) {
    throw new Error("Label Card stylesheet is unavailable for export");
  }
  cachedLabelCardStylesheet = css.replace(/<\/style/gi, "<\\/style");
  return cachedLabelCardStylesheet;
}

function labelCardExportHtml(card, images, exportScale = 1, labels = {}) {
  const presentation = normalizeLabelCardPresentation(card);
  const { card: normalizedCard, style, side, imagePosition, dimensions } = presentation;
  const image = labelCardImage(normalizedCard, images);
  const secondaryImage = labelCardSecondaryImage(normalizedCard, images);
  const showImage = side === "front" && imagePosition !== "text-only" && image?.url;
  const showSecondary = showImage && ["pair", "main-detail"].includes(imagePosition) && secondaryImage?.url;
  const safeText = (value) => escapeHtml(value || "").replace(/\n/g, "<br>");
  const scale = Math.max(1, Math.min(2, Number(exportScale || 1)));
  const mediaImages = showImage ? [image, showSecondary ? secondaryImage : null].filter(Boolean) : [];
  const img = mediaImages.length ? `<div class="label-card-media ${mediaImages.length > 1 ? "has-secondary" : ""}">${mediaImages.map((cardImage) => `<figure class="label-card-image"><span class="label-card-image-frame"><img src="${escapeHtml(cardImage.url || cardImage.thumbnailUrl || "")}" alt=""></span></figure>`).join("")}</div>` : "";
  const refbar = normalizedCard.provenance_text || normalizedCard.catalog_text ? `
      <div class="label-card-refbar">
        ${normalizedCard.provenance_text ? `<p class="label-card-meta">${safeText(normalizedCard.provenance_text)}</p>` : ""}
        ${normalizedCard.catalog_text ? `<p class="label-card-meta">${safeText(normalizedCard.catalog_text)}</p>` : ""}
      </div>` : "";
  const text = `
    <div class="label-card-text">
      ${normalizedCard.title ? `<h3>${safeText(normalizedCard.title)}</h3>` : ""}
      ${normalizedCard.subtitle ? `<p class="label-card-subtitle">${safeText(normalizedCard.subtitle)}</p>` : ""}
      ${normalizedCard.main_text ? `<p class="label-card-main">${safeText(normalizedCard.main_text)}</p>` : ""}
      ${normalizedCard.small_notes ? `<p class="label-card-small">${safeText(normalizedCard.small_notes)}</p>` : ""}
      ${refbar}
    </div>`;
  const back = `
    <div class="label-card-back">
      <header><span>${safeText(labels.back || "Back")}</span>${normalizedCard.title ? `<h3>${safeText(normalizedCard.title)}</h3>` : ""}</header>
      <div class="label-card-back-fields">
        ${normalizedCard.provenance_text ? `<div><strong>${safeText(labels.provenance || "Provenance")}</strong><p>${safeText(normalizedCard.provenance_text)}</p></div>` : ""}
        ${normalizedCard.catalog_text ? `<div><strong>${safeText(labels.catalog || "Catalog / reference")}</strong><p>${safeText(normalizedCard.catalog_text)}</p></div>` : ""}
        ${style.backAcquisitionNotes ? `<div><strong>${safeText(labels.acquisition || "Acquisition notes")}</strong><p>${safeText(style.backAcquisitionNotes)}</p></div>` : ""}
        ${style.backResearchNotes ? `<div><strong>${safeText(labels.research || "Research notes")}</strong><p>${safeText(style.backResearchNotes)}</p></div>` : ""}
      </div>
    </div>`;
  return `<!doctype html>
<html class="png-export">
<head>
<meta charset="utf-8">
<style>
${labelCardStylesheetText()}
html.png-export,html.png-export body{margin:0;width:${dimensions.width * scale}px;height:${dimensions.height * scale}px;overflow:hidden;background:transparent}
html.png-export body{display:block;min-width:0;min-height:0;font-family:Inter,"Segoe UI","Microsoft YaHei",Arial,sans-serif}
html.png-export .export-scale{width:${dimensions.width}px;height:${dimensions.height}px;transform:scale(${scale});transform-origin:top left}
html.png-export [data-export-page].label-card-preview{width:100%;height:100%;max-width:none;aspect-ratio:auto}
</style>
</head>
<body><div class="export-scale"><article data-export-page class="${labelCardClass(normalizedCard)} ${showImage ? "" : "no-image"}" style="${Object.entries(labelCardStyle(normalizedCard)).map(([key, value]) => `${key}:${escapeHtml(value)}`).join(";")}"><div class="label-card-surface"></div><div class="label-card-ornament"></div>${side === "back" ? back : `${img}${text}`}</article></div></body>
</html>`;
}

function LabelCardEditorModal({ item, card, images, onCreate, onUpdate, onExport, onClose }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => labelCardDraftFrom(card, item));
  const [activeTab, setActiveTab] = useState("content");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewMode, setPreviewMode] = useState("fit");
  const previewCanvasRef = useRef(null);
  const previewDimensions = labelCardDimensions(draft);

  const fitPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const availableWidth = Math.max(1, rect.width - 40);
    const availableHeight = Math.max(1, rect.height - 40);
    const nextZoom = Math.max(0.2, Math.min(2, availableWidth / previewDimensions.width, availableHeight / previewDimensions.height));
    setPreviewZoom((current) => Math.abs(current - nextZoom) < 0.005 ? current : nextZoom);
  }, [previewDimensions.width, previewDimensions.height]);

  useLayoutEffect(() => {
    if (previewMode !== "fit") return undefined;
    const canvas = previewCanvasRef.current;
    if (!canvas) return undefined;
    const frame = window.requestAnimationFrame(fitPreview);
    const observer = new ResizeObserver(() => fitPreview());
    observer.observe(canvas);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitPreview, previewMode]);

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateStyle(patch) {
    setDraft((current) => ({ ...current, style: { ...current.style, ...patch } }));
  }

  async function saveDraft() {
    setSaving(true);
    try {
      if (draft.id) await onUpdate(draft);
      else await onCreate(item, draft);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function exportDraft() {
    setExportError("");
    setExporting(true);
    try {
      await onExport(draft, images);
    } catch (error) {
      setExportError(`${t("exportCardFailed")} ${error?.message || error}`);
    } finally {
      setExporting(false);
    }
  }

  function resetStyleToPreset() {
    setDraft((current) => ({
      ...current,
      style: {
        ...defaultLabelCardStyle(current.preset),
        secondaryImageId: current.style.secondaryImageId || "",
        backAcquisitionNotes: current.style.backAcquisitionNotes || "",
        backResearchNotes: current.style.backResearchNotes || "",
        side: current.style.side === "back" ? "back" : "front",
        exportScale: current.style.exportScale || 1
      }
    }));
  }

  function changePreviewZoom(multiplier) {
    setPreviewMode("manual");
    setPreviewZoom((current) => Math.max(0.2, Math.min(3, current * multiplier)));
  }

  const tabs = [
    ["content", "cardContent"],
    ["layout", "cardLayout"],
    ["style", "cardStyle"],
    ["export", "cardExport"]
  ];

  return (
    <div className="modal-backdrop label-card-modal-backdrop">
      <section className="modal label-card-modal" role="dialog" aria-modal="true" aria-label={t("labelCardEditor")}>
        <header>
          <div>
            <h2>{t("labelCardEditor")}</h2>
            <p>{item.title}</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>{t("close")}</button>
        </header>
        <div className="label-card-modal-body">
          <div className="label-card-preview-stage" aria-label={t("cardPreview")}>
            <div className="label-card-preview-toolbar">
              <span>{t("cardPreview")}</span>
              <div>
                <div className="label-card-side-toggle" aria-label={t("cardPreview")}>
                  <button type="button" className={draft.style.side !== "back" ? "active" : ""} onClick={() => updateStyle({ side: "front" })}>{t("frontSide")}</button>
                  <button type="button" className={draft.style.side === "back" ? "active" : ""} onClick={() => updateStyle({ side: "back" })}>{t("backSide")}</button>
                </div>
                <button type="button" className="ghost compact" onClick={() => changePreviewZoom(1 / 1.15)} aria-label={t("zoomOut")}>{t("zoomOut")}</button>
                <button type="button" className="ghost compact" onClick={() => changePreviewZoom(1.15)} aria-label={t("zoomIn")}>{t("zoomIn")}</button>
                <button type="button" className="ghost compact" onClick={() => { setPreviewMode("fit"); window.requestAnimationFrame(fitPreview); }}>{t("fitPage")}</button>
                <button type="button" className="ghost compact" onClick={() => { setPreviewMode("manual"); setPreviewZoom(1); }}>{t("actualSize")}</button>
                <output>{Math.round(previewZoom * 100)}%</output>
              </div>
            </div>
            <div className="label-card-preview-canvas" ref={previewCanvasRef}>
              <div className="label-card-preview-space" style={{ width: previewDimensions.width * previewZoom, height: previewDimensions.height * previewZoom }}>
                <div className="label-card-preview-transform" style={{ width: previewDimensions.width, height: previewDimensions.height, transform: `scale(${previewZoom})` }}>
                  <LabelCardPreview card={draft} images={images} />
                </div>
              </div>
            </div>
          </div>
          <aside className="label-card-controls">
            <div className="label-card-tabs" role="tablist" aria-label={t("labelCardEditor")}>
              {tabs.map(([value, labelKey]) => (
                <button type="button" role="tab" aria-selected={activeTab === value} className={activeTab === value ? "active" : ""} key={value} onClick={() => setActiveTab(value)}>{t(labelKey)}</button>
              ))}
            </div>
            <div className="label-card-form">
              {activeTab === "content" && (
                <div className="label-card-control-section">
                  <label>{t("title")}<input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} /></label>
                  <label>{t("cardSubtitle")}<input value={draft.subtitle} onChange={(event) => updateDraft({ subtitle: event.target.value })} /></label>
                  <label>{t("cardMainText")}<textarea value={draft.main_text} onChange={(event) => updateDraft({ main_text: event.target.value })} /></label>
                  <label>{t("smallNotes")}<textarea value={draft.small_notes} onChange={(event) => updateDraft({ small_notes: event.target.value })} /></label>
                  <label>{t("provenanceText")}<input value={draft.provenance_text} onChange={(event) => updateDraft({ provenance_text: event.target.value })} /></label>
                  <label>{t("catalogText")}<input value={draft.catalog_text} onChange={(event) => updateDraft({ catalog_text: event.target.value })} /></label>
                  <label>{t("acquisitionNotes")}<textarea value={draft.style.backAcquisitionNotes || ""} onChange={(event) => updateStyle({ backAcquisitionNotes: event.target.value })} /></label>
                  <label>{t("researchNotes")}<textarea value={draft.style.backResearchNotes || ""} onChange={(event) => updateStyle({ backResearchNotes: event.target.value })} /></label>
                </div>
              )}
              {activeTab === "layout" && (
                <div className="label-card-control-section">
                  <label>{t("cardPreset")}<select value={draft.preset} onChange={(event) => {
                    const preset = event.target.value;
                    const option = labelCardPresetOption(preset);
                    setDraft((current) => ({
                      ...current,
                      preset,
                      image_position: option.defaultImagePosition,
                      style: {
                        ...defaultLabelCardStyle(preset),
                        secondaryImageId: current.style.secondaryImageId || "",
                        backAcquisitionNotes: current.style.backAcquisitionNotes || "",
                        backResearchNotes: current.style.backResearchNotes || "",
                        side: current.style.side === "back" ? "back" : "front",
                        exportScale: current.style.exportScale || 1
                      }
                    }));
                  }}>{LABEL_CARD_PRESETS.map((option) => <option value={option.value} key={option.value}>{t(option.labelKey)}</option>)}</select></label>
                  <label>{t("cardSize")}<select value={draft.style.cardSize} onChange={(event) => updateStyle({ cardSize: event.target.value })}>{LABEL_CARD_SIZES.map((option) => <option value={option.value} key={option.value}>{t(option.labelKey)}</option>)}</select></label>
                  <label>{t("imagePosition")}<select value={draft.image_position} onChange={(event) => updateDraft({ image_position: event.target.value })}>{LABEL_CARD_IMAGE_POSITIONS.map((option) => <option value={option.value} key={option.value}>{t(option.labelKey)}</option>)}</select></label>
                  <label>{t("primaryImage")}<select value={draft.image_id} onChange={(event) => updateDraft({ image_id: event.target.value })}><option value="">{t("none")}</option>{images.map((image, index) => <option value={image.id} key={image.id}>{image.original_filename || `${t("addImages")} ${index + 1}`}</option>)}</select></label>
                  {["pair", "main-detail"].includes(draft.image_position) && <label>{t("reverseImage")}<select value={draft.style.secondaryImageId || ""} onChange={(event) => updateStyle({ secondaryImageId: event.target.value })}><option value="">{t("none")}</option>{images.filter((image) => image.id !== draft.image_id).map((image, index) => <option value={image.id} key={image.id}>{image.original_filename || `${t("addImages")} ${index + 1}`}</option>)}</select></label>}
                </div>
              )}
              {activeTab === "style" && (
                <div className="label-card-control-section">
                  <label>{t("materialSurface")}<select value={draft.style.material || "cream-paper"} onChange={(event) => {
                    const material = labelCardMaterialOption(event.target.value);
                    updateStyle({ material: material.value, backgroundColor: material.backgroundColor, textColor: material.textColor });
                  }}>{LABEL_CARD_MATERIALS.map((option) => <option value={option.value} key={option.value}>{t(option.labelKey)}</option>)}</select></label>
                  <label>{t("presentationFrame")}<select value={draft.style.frame || "thin-double"} onChange={(event) => updateStyle({ frame: event.target.value })}>{LABEL_CARD_FRAMES.map((option) => <option value={option.value} key={option.value}>{t(option.labelKey)}</option>)}</select></label>
                  <label>{t("cardEdge")}<select value={draft.style.edge || "square"} onChange={(event) => updateStyle({ edge: event.target.value })}>{LABEL_CARD_EDGES.map((option) => <option value={option.value} key={option.value}>{t(option.labelKey)}</option>)}</select></label>
                  <div className="label-card-finish-grid">
                    <label>{t("textureIntensity")}<input type="range" min="0" max="100" value={draft.style.textureIntensity ?? 40} onChange={(event) => updateStyle({ textureIntensity: Number(event.target.value) })} /><output>{draft.style.textureIntensity ?? 40}%</output></label>
                    <label>{t("brightness")}<input type="range" min="70" max="130" value={draft.style.brightness ?? 100} onChange={(event) => updateStyle({ brightness: Number(event.target.value) })} /><output>{draft.style.brightness ?? 100}%</output></label>
                    <label>{t("agingLevel")}<input type="range" min="0" max="100" value={draft.style.aging ?? 0} onChange={(event) => updateStyle({ aging: Number(event.target.value) })} /><output>{draft.style.aging ?? 0}%</output></label>
                  </div>
                  <div className="label-card-grid">
                    <label>{t("size")}<input type="number" min="10" max="36" value={draft.style.fontSize} onChange={(event) => updateStyle({ fontSize: Number(event.target.value) })} /></label>
                    <label>{t("alignment")}<select value={draft.style.alignment} onChange={(event) => updateStyle({ alignment: event.target.value })}><option value="left">{t("left")}</option><option value="center">{t("center")}</option><option value="right">{t("right")}</option></select></label>
                    <label>{t("backgroundTone")}<input type="color" value={draft.style.backgroundColor} onChange={(event) => updateStyle({ backgroundColor: event.target.value })} /></label>
                    <label>{t("textColor")}<input type="color" value={draft.style.textColor} onChange={(event) => updateStyle({ textColor: event.target.value })} /></label>
                    <label className="check"><input type="checkbox" checked={draft.style.border !== false} onChange={(event) => updateStyle({ border: event.target.checked })} />{t("borderOn")}</label>
                  </div>
                  <button type="button" className="ghost" onClick={resetStyleToPreset}>{t("resetStyleToPreset")}</button>
                </div>
              )}
              {activeTab === "export" && (
                <div className="label-card-control-section label-card-export-panel">
                  <p>{t("exportHelp")}</p>
                  <label>{t("exportScale")}<select value={draft.style.exportScale || 1} onChange={(event) => updateStyle({ exportScale: Number(event.target.value) })}><option value="1">1x</option><option value="2">2x</option></select></label>
                  <button type="button" className="primary" onClick={exportDraft} disabled={exporting}>{exporting ? t("exporting") : t("exportCardPng")}</button>
                  {exportError && <p className="form-error">{exportError}</p>}
                </div>
              )}
            </div>
          </aside>
        </div>
        <footer>
          <button type="button" className="secondary" onClick={onClose}>{t("cancel")}</button>
          <button type="button" className="primary" onClick={saveDraft} disabled={saving}>{saving ? t("saving") : t("saveLabelCard")}</button>
        </footer>
      </section>
    </div>
  );
}

function LabelCardsSection({ item, cards, images, onCreate, onUpdate, onDelete, onExport }) {
  const { t } = useI18n();
  const [editingCard, setEditingCard] = useState(null);
  const [exportingId, setExportingId] = useState("");
  const [exportError, setExportError] = useState("");

  async function exportCard(card) {
    setExportError("");
    setExportingId(card.id);
    try {
      await onExport(card, images);
    } catch (error) {
      setExportError(`${t("exportCardFailed")} ${error?.message || error}`);
    } finally {
      setExportingId("");
    }
  }

  return (
    <section className="label-cards-section">
      <header>
        <div>
          <h2>{t("labelCards")}</h2>
          <p>{cards.length ? `${cards.length}` : t("noLabelCardsYet")}</p>
        </div>
        <button type="button" className="secondary" onClick={() => setEditingCard({})}>{t("newLabelCard")}</button>
      </header>
      {cards.length ? <div className="label-card-shelf">{cards.map((card) => (
        <article className="label-card-shelf-item" key={card.id}>
          <div className="label-card-thumbnail"><LabelCardPreview card={card} images={images} /></div>
          <div className="label-card-shelf-meta"><strong>{card.title || t("labelCards")}</strong><span>{t(labelCardPresetOption(card.preset).labelKey)}</span></div>
          <div className="label-card-actions">
            <button type="button" className="secondary compact" onClick={() => setEditingCard(card)}>{t("editLabelCard")}</button>
            <button type="button" className="ghost compact" onClick={() => exportCard(card)} disabled={exportingId === card.id}>{exportingId === card.id ? t("exporting") : t("exportCardPng")}</button>
            <button type="button" className="danger compact" onClick={() => onDelete(card.id)}>{t("delete")}</button>
          </div>
        </article>
      ))}</div> : <p className="quiet">{t("noLabelCardsYet")}</p>}
      {exportError && <p className="form-error">{exportError}</p>}
      {editingCard && <LabelCardEditorModal item={item} card={editingCard.id ? editingCard : null} images={images} onCreate={onCreate} onUpdate={onUpdate} onExport={onExport} onClose={() => setEditingCard(null)} />}
    </section>
  );
}

function AttachmentsSection({ itemId, attachments, onAdd, onAddWebpage, onUpdate, onOpen, onOpenSource, onRemove }) {
  const { t } = useI18n();
  const [viewerAttachment, setViewerAttachment] = useState(null);
  const [adding, setAdding] = useState(false);
  function closeAddAttachment() {
    setAdding(false);
  }
  function closeAttachmentViewer() {
    setViewerAttachment(null);
  }
  return (
    <section className="attachments-section">
      <header>
        <div>
          <h2>{t("attachments")}</h2>
          <p>{attachments.length ? `${attachments.length}` : t("noAttachmentsYet")}</p>
        </div>
        <button type="button" className="secondary" onClick={() => setAdding(true)}>{t("addAttachment")}</button>
      </header>
      {adding && (
        <AddAttachmentDialog
          itemId={itemId}
          onAddLocal={async () => {
            await onAdd(itemId);
            closeAddAttachment();
          }}
          onAddWebpage={async (payload) => {
            await onAddWebpage(payload);
            closeAddAttachment();
          }}
          onClose={closeAddAttachment}
        />
      )}
      <div className="attachments-list">
        {attachments.map((attachment) => (
          <AttachmentRow
            key={attachment.id}
            attachment={attachment}
            onUpdate={onUpdate}
            onOpen={onOpen}
            onOpenSource={onOpenSource}
            onView={setViewerAttachment}
            onRemove={onRemove}
          />
        ))}
      </div>
      {attachments.length === 0 && <p className="quiet">{t("noAttachmentsYet")}</p>}
      {viewerAttachment && (
        <AttachmentViewer
          attachment={viewerAttachment}
          onOpen={onOpen}
          onClose={closeAttachmentViewer}
        />
      )}
    </section>
  );
}

function AddAttachmentDialog({ itemId, onAddLocal, onAddWebpage, onClose }) {
  const { t } = useI18n();
  const [method, setMethod] = useState("local");
  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState("url");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    cancelAppInteractions();
  }, []);

  async function addLocalFile() {
    setBusy(true);
    setError("");
    try {
      await onAddLocal();
    } catch (localError) {
      setError(localError.message || String(localError));
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (method === "local") {
      await addLocalFile();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAddWebpage({
        itemId,
        sourceUrl,
        title,
        note,
        mode: mode === "pdf" ? "pdf" : "url"
      });
    } catch (submitError) {
      setError(submitError.message || String(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal attachment-add-dialog" onSubmit={submit}>
        <header>
          <div>
            <h2>{t("addAttachment")}</h2>
            <p>{t("attachmentDialogHelp")}</p>
          </div>
          <button type="button" onClick={onClose}>{t("close")}</button>
        </header>
        <div className="attachment-method-tabs" role="tablist" aria-label={t("addAttachment")}>
          <button type="button" className={method === "local" ? "active" : ""} onClick={() => setMethod("local")} disabled={busy}>
            {t("localFile")}
          </button>
          <button type="button" className={method === "webpage" ? "active" : ""} onClick={() => setMethod("webpage")} disabled={busy}>
            {t("webpageUrl")}
          </button>
        </div>
        {method === "local" ? (
          <div className="attachment-method-panel">
            <p>{t("localAttachmentHelp")}</p>
            <p className="quiet">{t("executableBlockedHint")}</p>
          </div>
        ) : (
          <div className="attachment-method-panel">
            <p>{t("webpageAttachmentHelp")}</p>
            <label>
              {t("sourceUrl")}
              <input data-input-debug="Add attachment source URL" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com" required />
            </label>
            <label>
              {t("title")}
              <input data-input-debug="Add attachment title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              {t("note")}
              <textarea data-input-debug="Add attachment note" value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <label>
              {t("attachmentMode")}
              <select value={mode} onChange={(event) => setMode(event.target.value)}>
                <option value="url">{t("saveUrlOnly")}</option>
                <option value="pdf">{t("saveAsPdfSnapshot")}</option>
              </select>
            </label>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>{t("cancel")}</button>
          <button type="submit" className="primary" disabled={busy || (method === "webpage" && !sourceUrl.trim())}>
            {method === "local" ? t("chooseFile") : mode === "pdf" ? t("capturePdf") : t("saveUrl")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function canPreviewAttachment(attachment) {
  return ["pdf", "video", "audio"].includes(attachment?.file_type) && Boolean(attachment?.url);
}

function AttachmentRow({ attachment, onUpdate, onOpen, onOpenSource, onView, onRemove }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(attachment.title || "");
  const [note, setNote] = useState(attachment.note || "");

  useEffect(() => {
    setTitle(attachment.title || "");
    setNote(attachment.note || "");
  }, [attachment.id, attachment.note, attachment.title]);

  function save() {
    if (title === (attachment.title || "") && note === (attachment.note || "")) return;
    onUpdate({ id: attachment.id, title, note });
  }

  const displayTitle = title.trim() || attachment.original_filename || attachment.source_url || t("webpageUrl");
  const imported = attachment.created_at ? new Date(attachment.created_at).toLocaleString() : "-";
  const captured = attachment.captured_at ? new Date(attachment.captured_at).toLocaleString() : "";
  const typeLabel = attachment.attachment_kind && attachment.attachment_kind !== "file"
    ? attachment.attachment_kind
    : attachment.file_type || "other";

  return (
    <article className="attachment-card">
      <div className="attachment-main">
        <label>
          {t("title")}
          <input data-input-debug="Attachment title" value={title} placeholder={attachment.original_filename || attachment.source_url || t("title")} onChange={(event) => setTitle(event.target.value)} onBlur={save} />
        </label>
        <div className="attachment-meta">
          <span>{t("fileType")}: {typeLabel}</span>
          {attachment.file_size > 0 && <span>{t("fileSize")}: {formatFileSize(attachment.file_size)}</span>}
          <span>{t("imported")}: {imported}</span>
          {captured && <span>{t("capturedAt")}: {captured}</span>}
          {attachment.source_url && (
            <span className="attachment-source">
              {t("sourceUrl")}: <span title={attachment.source_url}>{attachment.source_url}</span>
            </span>
          )}
        </div>
        <label>
          {t("note")}
          <textarea data-input-debug="Attachment note" value={note} onChange={(event) => setNote(event.target.value)} onBlur={save} />
        </label>
      </div>
      <AttachmentPreview attachment={attachment} title={displayTitle} />
      <div className="attachment-actions">
        {canPreviewAttachment(attachment) && (
          <button type="button" className="secondary" onClick={() => onView(attachment)}>{t("view")}</button>
        )}
        {attachment.attachment_kind !== "url" && <button type="button" onClick={() => onOpen(attachment.id)}>{t("openFile")}</button>}
        {attachment.source_url && <button type="button" onClick={() => onOpenSource(attachment.id)}>{t("openUrl")}</button>}
        {attachment.attachment_kind === "url" && !attachment.source_url && <button type="button" onClick={() => onOpen(attachment.id)}>{t("openUrl")}</button>}
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (!window.confirm(`${t("removeAttachment")}?`)) return;
            onRemove(attachment.id);
          }}
        >
          {t("removeAttachment")}
        </button>
      </div>
    </article>
  );
}

function AttachmentPreview({ attachment, title }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [attachment.id, attachment.url]);
  if (!attachment.url) {
    return <div className="attachment-preview unavailable">{t("previewUnavailable")}</div>;
  }
  if (failed) {
    return <div className="attachment-preview unavailable">{t("playbackUnavailable")}</div>;
  }
  if (attachment.file_type === "pdf") {
    return <PdfAttachmentCanvas attachment={attachment} title={title} compact />;
  }
  if (attachment.file_type === "video") {
    return <video className="attachment-preview" controls preload="metadata" src={attachment.url} onError={() => setFailed(true)} />;
  }
  if (attachment.file_type === "audio") {
    return <audio className="attachment-audio-preview" controls preload="metadata" src={attachment.url} onError={() => setFailed(true)} />;
  }
  return <div className="attachment-preview unavailable">{t("previewUnavailable")}</div>;
}

function AttachmentViewer({ attachment, onOpen, onClose }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const title = attachment.title || attachment.original_filename || t("previewAttachment");

  useEffect(() => {
    function handleKeyDown(event) {
      if (shouldIgnoreAppShortcut(event, "AttachmentViewer.keydown")) return;
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="viewer-backdrop attachment-viewer-backdrop">
      <section className="attachment-viewer" role="dialog" aria-modal="true" aria-label={t("previewAttachment")}>
        <header>
          <div>
            <h2>{title}</h2>
            <p>{attachment.file_type || "other"} · {formatFileSize(attachment.file_size)}</p>
          </div>
          <div className="viewer-actions">
            <button type="button" className="secondary" onClick={() => onOpen(attachment.id)}>{t("openFile")}</button>
            <button type="button" onClick={onClose}>{t("closeViewer")}</button>
          </div>
        </header>
        <div className="attachment-viewer-body">
          {!attachment.url || failed ? (
            <div className="attachment-viewer-unavailable">{failed ? t("playbackUnavailable") : t("previewUnavailable")}</div>
          ) : attachment.file_type === "pdf" ? (
            <PdfAttachmentCanvas attachment={attachment} title={title} />
          ) : attachment.file_type === "video" ? (
            <video controls autoPlay={false} preload="metadata" src={attachment.url} onError={() => setFailed(true)} />
          ) : attachment.file_type === "audio" ? (
            <div className="attachment-audio-viewer">
              <strong>{title}</strong>
              <audio controls preload="metadata" src={attachment.url} onError={() => setFailed(true)} />
            </div>
          ) : (
            <div className="attachment-viewer-unavailable">{t("previewUnavailable")}</div>
          )}
        </div>
      </section>
    </div>
  );
}

function pdfAttachmentDebugEnabled() {
  try {
    return localStorage.getItem("archiveDebugMedia") === "1";
  } catch {
    return false;
  }
}

function pdfByteDebugShape(value) {
  if (value == null) return { type: String(value) };
  const constructorName = value?.constructor?.name || typeof value;
  const length = Number(value?.byteLength || value?.length || value?.data?.length || 0);
  return {
    constructorName,
    type: value?.type,
    isArray: Array.isArray(value),
    isArrayBuffer: value instanceof ArrayBuffer,
    isUint8Array: value instanceof Uint8Array,
    hasBuffer: Boolean(value?.buffer),
    hasDataArray: Array.isArray(value?.data),
    length
  };
}

function toPdfByteArray(value) {
  let bytes = null;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (value instanceof Uint8Array) {
    bytes = new Uint8Array(value);
  } else if (Array.isArray(value)) {
    bytes = new Uint8Array(value);
  } else if (Array.isArray(value?.data)) {
    bytes = new Uint8Array(value.data);
  } else if (value?.buffer instanceof ArrayBuffer) {
    const byteOffset = Number(value.byteOffset || 0);
    const byteLength = Number(value.byteLength || value.buffer.byteLength || 0);
    bytes = new Uint8Array(value.buffer, byteOffset, byteLength);
  } else if (typeof value === "object" && Number.isFinite(Number(value?.length))) {
    const length = Number(value.length);
    const list = new Array(length);
    for (let index = 0; index < length; index += 1) {
      list[index] = Number(value[index] || 0);
    }
    bytes = new Uint8Array(list);
  }

  if (!bytes || bytes.byteLength === 0) return null;
  return new Uint8Array(bytes);
}

function describePdfError(error, stage) {
  const rawMessage = error?.message || String(error || "");
  const message = rawMessage.replace(/\s+/g, " ").trim();
  if (/missing/i.test(message) && /url/i.test(message)) return "Missing PDF URL";
  if (/missing/i.test(message) && /file/i.test(message)) return "Missing attachment file";
  if (/not found/i.test(message)) return "Missing attachment file";
  if (/not a pdf/i.test(message)) return "Attachment is not a PDF";
  if (/worker/i.test(message)) return "PDF.js worker failed";
  if (/invalid pdf|invalidpdf|invalid pdf structure/i.test(message)) return "Invalid PDF structure";
  if (/password/i.test(message)) return "Password-protected PDF";
  if (/decode|decoded/i.test(message)) return "PDF byte data could not be decoded";
  if (/bytes|arraybuffer|uint8array|read/i.test(message) || stage === "read-bytes") {
    return `Failed to read PDF bytes${message ? `: ${message}` : ""}`;
  }
  if (stage === "load-pdf") return `PDF.js failed to load PDF${message ? `: ${message}` : ""}`;
  if (stage === "render-page") return `PDF.js failed to render page${message ? `: ${message}` : ""}`;
  return message || "PDF preview unavailable";
}

function PdfAttachmentCanvas({ attachment, title, compact = false }) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const renderSeqRef = useRef(0);
  const pdfRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState("fit-width");
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    function measure() {
      setContainerSize({
        width: Math.max(160, node.clientWidth || 0),
        height: Math.max(120, node.clientHeight || 0)
      });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadingTaskRef = { current: null };
    setLoading(true);
    setError("");
    setPdf(null);
    setPageCount(0);
    setPageNumber(1);

    async function loadPdf() {
      let stage = "read-bytes";
      let pdfjsRuntime = null;
      try {
        if (!attachment.id) throw new Error("Missing attachment id");
        if (!api?.readAttachmentBytes) throw new Error("Attachment byte reader is unavailable");
        const result = await api.readAttachmentBytes(attachment.id);
        if (pdfAttachmentDebugEnabled()) {
          console.log("[attachments:pdf] byte payload", {
            attachmentId: attachment.id,
            originalFilename: attachment.original_filename,
            resultKeys: result ? Object.keys(result) : [],
            byteShape: pdfByteDebugShape(result?.bytes)
          });
        }
        const bytes = toPdfByteArray(result?.bytes);
        if (!bytes || bytes.byteLength === 0) throw new Error("PDF byte data could not be decoded");
        if (pdfAttachmentDebugEnabled()) {
          console.log("[attachments:pdf] byte array decoded", {
            attachmentId: attachment.id,
            constructorName: bytes.constructor?.name,
            length: bytes.byteLength,
            header: Array.from(bytes.slice(0, 8))
          });
        }
        if (cancelled) return;
        stage = "load-pdf";
        pdfjsRuntime = await loadPdfJs();
        if (cancelled) return;
        const task = pdfjsRuntime.getDocument({ data: bytes });
        loadingTaskRef.current = task;
        const loadedPdf = await task.promise;
        if (cancelled) {
          await loadedPdf.destroy();
          return;
        }
        pdfRef.current = loadedPdf;
        setPdf(loadedPdf);
        setPageCount(loadedPdf.numPages || 0);
      } catch (loadError) {
        if (!cancelled) {
          const detail = describePdfError(loadError, stage);
          if (pdfAttachmentDebugEnabled()) {
            console.error("[attachments:pdf] preview failed", {
              attachmentId: attachment.id,
              originalFilename: attachment.original_filename,
              stage,
              workerSrc: pdfjsRuntime?.GlobalWorkerOptions?.workerSrc || "not-loaded",
              message: loadError?.message || String(loadError),
              name: loadError?.name,
              stack: loadError?.stack
            });
          }
          setError(detail);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
      renderSeqRef.current += 1;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (loadingTaskRef.current?.destroy) {
        loadingTaskRef.current.destroy();
      }
      if (pdfRef.current) {
        pdfRef.current.destroy();
        pdfRef.current = null;
      }
    };
  }, [attachment.id, attachment.original_filename, reloadKey]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !containerSize.width) return undefined;
    let cancelled = false;
    const sequence = renderSeqRef.current + 1;
    renderSeqRef.current = sequence;

    async function renderPage() {
      setRendering(true);
      setError("");
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || renderSeqRef.current !== sequence) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const padding = compact ? 18 : 34;
        const fitWidthScale = (containerSize.width - padding) / baseViewport.width;
        const fitHeightScale = (containerSize.height - padding) / baseViewport.height;
        const fitScale = Math.max(0.1, compact ? Math.min(fitWidthScale, fitHeightScale) : fitWidthScale);
        const cssScale = mode === "fit-width" ? fitScale : zoom;
        const pixelRatio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: cssScale * pixelRatio });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${Math.max(1, Math.floor(baseViewport.width * cssScale))}px`;
        canvas.style.height = `${Math.max(1, Math.floor(baseViewport.height * cssScale))}px`;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        const task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (renderError) {
        if (renderError?.name !== "RenderingCancelledException" && !cancelled) {
          const detail = describePdfError(renderError, "render-page");
          if (pdfAttachmentDebugEnabled()) {
            console.error("[attachments:pdf] render failed", {
              attachmentId: attachment.id,
              originalFilename: attachment.original_filename,
              pageNumber,
              message: renderError?.message || String(renderError),
              name: renderError?.name,
              stack: renderError?.stack
            });
          }
          setError(detail);
        }
      } finally {
        if (!cancelled && renderSeqRef.current === sequence) {
          renderTaskRef.current = null;
          setRendering(false);
        }
      }
    }

    renderPage();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [compact, containerSize.height, containerSize.width, mode, pageNumber, pdf, zoom]);

  function reload() {
    setReloadKey((current) => current + 1);
  }

  function zoomBy(delta) {
    setMode("custom");
    setZoom((current) => Math.max(0.25, Math.min(4, Math.round((current + delta) * 100) / 100)));
  }

  return (
    <div className={`pdf-attachment ${compact ? "compact" : "large"}`} ref={containerRef}>
      {!compact && (
        <div className="pdf-toolbar">
          <button type="button" disabled={pageNumber <= 1 || loading} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}>{t("previousPage")}</button>
          {!error && pageCount > 0 ? <span>{t("pageLabel")} {pageNumber} {t("of")} {pageCount}</span> : <span>{t("pageLabel")} -</span>}
          <button type="button" disabled={pageNumber >= pageCount || loading} onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}>{t("nextPage")}</button>
          <button type="button" disabled={loading} onClick={() => zoomBy(-0.15)}>{t("pdfZoomOut")}</button>
          <button type="button" disabled={loading} onClick={() => zoomBy(0.15)}>{t("pdfZoomIn")}</button>
          <button type="button" disabled={loading} onClick={() => setMode("fit-width")}>{t("fitWidth")}</button>
          <button type="button" disabled={loading} onClick={() => { setMode("custom"); setZoom(1); }}>{t("pdfActualSize")}</button>
          <button type="button" onClick={reload}>{t("reload")}</button>
        </div>
      )}
      <div className="pdf-canvas-wrap" aria-label={title}>
        {(loading || rendering) && <div className="pdf-status">{loading ? t("loadingPdf") : t("loading")}</div>}
        {error ? (
          <div className="pdf-error">
            <strong>{t("pdfPreviewUnavailable")}</strong>
            <span>{error}</span>
            <button type="button" onClick={reload}>{t("reload")}</button>
          </div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
      {compact && pageCount > 1 && !error && <span className="pdf-compact-count">{t("pageLabel")} 1 {t("of")} {pageCount}</span>}
    </div>
  );
}

function AlbumsView({
  library,
  selectedAlbumId,
  setSelectedAlbumId,
  album,
  onNewAlbum,
  onCreatePage,
  onAddItemToPage,
  onRemoveItemFromPage,
  onUpdateAlbum,
  onDeleteAlbum,
  onUpdatePage,
  onReorderPages,
  onDeletePage,
  onCopyPage,
  onUpdatePageItem,
  onBulkAddItemsToPage,
  onAddTextToPage,
  onMessage
}) {
  const { t } = useI18n();
  const [selectedPage, setSelectedPage] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copyTargetAlbumId, setCopyTargetAlbumId] = useState("");
  const [mode, setMode] = useState("preview");
  const [previewStyle, setPreviewStyle] = useState(() => {
    const saved = sessionStorage.getItem("albumPreviewStyle");
    return saved === "image-only" ? "clean" : saved || "clean";
  });
  const [albumTitle, setAlbumTitle] = useState("");
  const [albumDescription, setAlbumDescription] = useState("");
  const [pdfQuality, setPdfQuality] = useState(() => sessionStorage.getItem("albumPdfQuality") || "medium");

  useEffect(() => {
    setSelectedPage(album?.pages?.[0]?.id || "");
  }, [album?.id]);

  useEffect(() => {
    setAlbumTitle(album?.title || "");
    setAlbumDescription(album?.description || "");
  }, [album?.id, album?.title, album?.description]);

  useEffect(() => {
    sessionStorage.setItem("albumPreviewStyle", previewStyle);
  }, [previewStyle]);

  useEffect(() => {
    sessionStorage.setItem("albumPdfQuality", pdfQuality);
  }, [pdfQuality]);

  const albumPages = album?.pages || [];
  const activePageId = albumPages.some((page) => page.id === selectedPage) ? selectedPage : (albumPages[0]?.id || "");
  const activePage = albumPages.find((page) => page.id === activePageId) || null;
  const visiblePages = activePageId ? albumPages.filter((page) => page.id === activePageId) : [];

  async function exportPageImage(page = activePage) {
    if (!page) return;
    try {
      const { width, height } = logicalPageSize(page);
      const result = await api.exportAlbumPagePng({
        html: buildAlbumExportHtml([page], album.title),
        width,
        height,
        defaultFilename: `${safeExportFilename(album.title || "album")}_page-${page.page_number || 1}.png`
      });
      if (!result?.canceled) onMessage?.(t("albumPageImageExported"));
    } catch (error) {
      console.error("[album-export] page PNG failed", error);
      onMessage?.(t("exportFailed", "", { message: error.message }));
    }
  }

  async function exportAlbumPdf() {
    if (!albumPages.length) return;
    try {
      const pageSizes = albumPages.map(logicalPageSize);
      const pdfWidth = Math.max(...pageSizes.map((size) => size.width));
      const pdfHeight = Math.max(...pageSizes.map((size) => size.height));
      const result = await api.exportAlbumPdf({
        html: buildAlbumExportHtml(albumPages, album.title, { pdf: true }),
        width: pdfWidth,
        height: pdfHeight,
        quality: pdfQuality,
        defaultFilename: `${safeExportFilename(album.title || "album")}.pdf`
      });
      if (!result?.canceled) {
        const label = PDF_QUALITY_OPTIONS.find((entry) => entry.value === pdfQuality)?.label || "Medium";
        onMessage?.(t("albumPdfExported", "", { quality: label }));
      }
    } catch (error) {
      console.error("[album-export] PDF failed", error);
      onMessage?.(t("exportFailed", "", { message: error.message }));
    }
  }

  async function moveActivePage(delta) {
    if (!activePageId || albumPages.length < 2) return;
    const currentIndex = albumPages.findIndex((page) => page.id === activePageId);
    const nextIndex = currentIndex + delta;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= albumPages.length) return;
    const nextPages = [...albumPages];
    const [moved] = nextPages.splice(currentIndex, 1);
    nextPages.splice(nextIndex, 0, moved);
    const updated = await onReorderPages({ albumId: album.id, ids: nextPages.map((page) => page.id) });
    if (updated?.pages?.some((page) => page.id === activePageId)) {
      setSelectedPage(activePageId);
    }
  }

  async function duplicateActivePage() {
    if (!album || !activePageId) return;
    const result = await onCopyPage({
      pageId: activePageId,
      targetAlbumId: album.id,
      insertAfterPageId: activePageId
    });
    if (result?.album) {
      setSelectedPage(result.copiedPageId || "");
    }
    onMessage?.(t("pageDuplicated"));
  }

  async function copyActivePageToAlbum() {
    if (!activePageId || !copyTargetAlbumId) return;
    const result = await onCopyPage({
      pageId: activePageId,
      targetAlbumId: copyTargetAlbumId
    });
    setCopyTargetAlbumId("");
    if (copyTargetAlbumId === album.id && result?.copiedPageId) {
      setSelectedPage(result.copiedPageId);
    }
    onMessage?.(t("pageCopied"));
  }

  const copyTargetAlbums = library.albums.filter((entry) => entry.id !== album?.id);
  const pageOrderControls = activePage ? (
    <div className="page-order-controls">
      <button type="button" aria-label={t("movePageUp")} title={t("movePageUp")} disabled={!activePage || albumPages.findIndex((page) => page.id === activePageId) <= 0} onClick={() => moveActivePage(-1)}>{t("moveUp")}</button>
      <button type="button" aria-label={t("movePageDown")} title={t("movePageDown")} disabled={!activePage || albumPages.findIndex((page) => page.id === activePageId) >= albumPages.length - 1} onClick={() => moveActivePage(1)}>{t("moveDown")}</button>
    </div>
  ) : null;
  const pageCopyControls = activePage ? (
    <div className="page-copy-controls">
      <button type="button" className="secondary" onClick={duplicateActivePage}>{t("duplicatePage")}</button>
      <select
        value={copyTargetAlbumId}
        onChange={(event) => setCopyTargetAlbumId(event.target.value)}
        aria-label={t("copyToAlbum")}
        disabled={copyTargetAlbums.length === 0}
      >
        <option value="">{copyTargetAlbums.length ? t("copyPageToAlbum") : t("noOtherAlbums")}</option>
        {copyTargetAlbums.map((entry) => (
          <option value={entry.id} key={entry.id}>{entry.title}</option>
        ))}
      </select>
      <button type="button" className="secondary" disabled={!copyTargetAlbumId} onClick={copyActivePageToAlbum}>{t("copy")}</button>
    </div>
  ) : null;
  const pageActionsMenu = activePage ? (
    <details className="toolbar-menu page-actions-menu">
      <summary>{t("pageActions")}</summary>
      <div className="toolbar-menu-content">
        {pageCopyControls}
      </div>
    </details>
  ) : null;
  const modeToggle = (
    <div className="segmented mode-toggle">
      <button className={mode === "preview" ? "active" : ""} type="button" onClick={() => setMode("preview")}>{t("preview")}</button>
      <button className={mode === "edit" ? "active" : ""} type="button" onClick={() => setMode("edit")}>{t("edit")}</button>
    </div>
  );

  return (
    <section className={`albums-view ${mode === "edit" ? "edit-layout" : "preview-layout"}`}>
      <aside className="album-list">
        <div className="album-list-header">
          <h1>{t("albumsTitle")}</h1>
          <button type="button" onClick={onNewAlbum}>
            <span className="album-new-full">{t("newAlbum")}</span>
            <span className="album-new-short">{t("newShort")}</span>
          </button>
        </div>
        {library.albums.map((entry) => (
          <button className={entry.id === selectedAlbumId ? "active" : ""} key={entry.id} onClick={() => setSelectedAlbumId(entry.id)}>
            <strong>{entry.title}</strong>
            <span>{t("pagesCount", "", { count: entry.page_count })}</span>
          </button>
        ))}
        {library.albums.length === 0 && <p className="quiet">{t("createAlbumPrompt")}</p>}
      </aside>

      <div className="album-stage">
        {!album && (selectedAlbumId ? <LoadingState title={t("loadingAlbum")} /> : <EmptyState title={t("chooseAlbum")} />)}
        {album && (
          <>
            <header className="album-toolbar">
              {mode === "edit" ? (
                <>
                  <div className="album-header-row album-header-main">
                    <input value={albumTitle} onChange={(event) => setAlbumTitle(event.target.value)} placeholder={t("albumName")} />
                    <input value={albumDescription} onChange={(event) => setAlbumDescription(event.target.value)} placeholder={t("description")} />
                    <button type="button" className="primary compact" onClick={() => onUpdateAlbum({ id: album.id, title: albumTitle, description: albumDescription })}>{t("saveAlbum")}</button>
                    <button type="button" className="danger" onClick={() => onDeleteAlbum(album.id)}>{t("deleteAlbum")}</button>
                    {modeToggle}
                  </div>
                  <form
                    className="album-header-row album-page-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onCreatePage({ album_id: album.id });
                    }}
                  >
                    {album.pages.length > 0 && (
                      <select className="album-page-select" value={activePageId} aria-label={t("pageSelector")} onChange={(event) => setSelectedPage(event.target.value)}>
                        {album.pages.map((page) => (
                          <option value={page.id} key={page.id}>{page.title}</option>
                        ))}
                      </select>
                    )}
                    {pageOrderControls}
                    <button className="primary compact">{t("addPage")}</button>
                    {pageActionsMenu}
                  </form>
                </>
              ) : (
                <>
                  <div className="album-title-block">
                    <h1>{album.title}</h1>
                    <p>{album.description || t("digitalAlbum")}</p>
                  </div>
                  <div className="album-toolbar-actions">
                    {modeToggle}
                    <div className="segmented preview-style-toggle">
                      <button className={previewStyle === "standard" ? "active" : ""} type="button" onClick={() => setPreviewStyle("standard")}>{t("designedPage")}</button>
                      <button className={previewStyle === "clean" ? "active" : ""} type="button" onClick={() => setPreviewStyle("clean")}>{t("cleanPreview")}</button>
                    </div>
                    <div className="album-pdf-export-actions">
                      <PdfQualitySelect value={pdfQuality} onChange={setPdfQuality} />
                      <button type="button" className="secondary" onClick={exportAlbumPdf}>{t("exportPdf")}</button>
                    </div>
                  </div>
                </>
              )}
            </header>

            {mode === "preview" && album.pages.length > 0 && (
              <div className="album-controls album-page-selector">
                <select className="album-page-select" value={activePageId} aria-label={t("pageSelector")} onChange={(event) => setSelectedPage(event.target.value)}>
                  {album.pages.map((page) => (
                    <option value={page.id} key={page.id}>{page.title}</option>
                  ))}
                </select>
                {pageOrderControls}
                {pageActionsMenu}
                <button type="button" className="secondary" onClick={() => exportPageImage()}>{t("exportPage")}</button>
              </div>
            )}

            <div className="album-pages">
              {visiblePages.map((page) => (
                <AlbumPage
                  page={page}
                  key={page.id}
                  mode={mode}
                  previewStyle={previewStyle}
                  onRemoveItemFromPage={onRemoveItemFromPage}
                  onUpdatePage={onUpdatePage}
                  onDeletePage={onDeletePage}
                  onUpdatePageItem={onUpdatePageItem}
                  onAddItemToPage={onAddItemToPage}
                  onAddTextToPage={onAddTextToPage}
                  onOpenItemPicker={(pageId) => {
                    setSelectedPage(pageId);
                    setPickerOpen(true);
                  }}
                  onPickBackground={(pageId) => {
                    setSelectedPage(pageId);
                    setPickerOpen("background");
                  }}
                />
              ))}
            </div>
            {album.pages.length === 0 && <EmptyState title={t("noPagesYet")} />}
          </>
        )}
      </div>
      {pickerOpen && (
        <AlbumItemPicker
          countries={library.countries}
          entityGroups={library.entityGroups || []}
          types={library.types}
          pageId={activePageId}
          title={pickerOpen === "background" ? "Choose background image" : t("addItem")}
          onAdd={async (payload) => {
            if (pickerOpen === "background") {
              const page = album.pages.find((entry) => entry.id === activePageId);
              await onUpdatePage({
                ...page,
                background_image_id: payload.image_id,
                background_image_enabled: true,
                background_opacity: 0.45,
                background_fit: page.background_fit || "contain"
              });
            } else {
              await onAddItemToPage(payload);
            }
          }}
          onBulkAdd={pickerOpen === "background" ? null : onBulkAddItemsToPage}
          onClose={() => {
            setPickerOpen(null);
          }}
        />
      )}
    </section>
  );
}

const PAGE_BACKGROUNDS = {
  white: "#ffffff",
  cream: "#f7f0dd",
  "light gray": "#edf0ee",
  black: "#141414"
};

const PAPER_PRESETS = {
  "a4-portrait": { label: "A4 portrait", width: 1000, height: 1414, widthMm: 210, heightMm: 297, orientation: "portrait" },
  "a4-landscape": { label: "A4 landscape", width: 1414, height: 1000, widthMm: 297, heightMm: 210, orientation: "landscape" },
  "letter-portrait": { label: "Letter portrait", width: 1000, height: 1294, widthMm: 215.9, heightMm: 279.4, orientation: "portrait" },
  "letter-landscape": { label: "Letter landscape", width: 1294, height: 1000, widthMm: 279.4, heightMm: 215.9, orientation: "landscape" },
  square: { label: "Square", width: 1000, height: 1000, widthMm: 210, heightMm: 210, orientation: "portrait" },
  custom: { label: "Custom", width: null, height: null, orientation: "portrait" }
};

const MIN_EDITOR_ZOOM = 0.1;
const MAX_EDITOR_ZOOM = 5;
const PDF_QUALITY_OPTIONS = [
  { value: "original", label: "Original quality" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" }
];

const TEXT_FONT_OPTIONS = [
  { value: "system", labelKey: "systemFont", css: "Inter, Segoe UI, Arial, sans-serif" },
  { value: "serif", labelKey: "serifFont", css: "Georgia, Times New Roman, serif" },
  { value: "sans", labelKey: "sansSerifFont", css: "Inter, Segoe UI, Arial, sans-serif" },
  { value: "mono", labelKey: "monospaceFont", css: "Consolas, Menlo, monospace" },
  { value: "georgia", label: "Georgia", css: "Georgia, serif" },
  { value: "times", label: "Times New Roman", css: "Times New Roman, Times, serif" },
  { value: "arial", label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { value: "verdana", label: "Verdana", css: "Verdana, Geneva, sans-serif" }
];

const LABEL_CARD_PRESETS = [
  { value: "stamp-exhibition", labelKey: "classicStampSlip", defaultImagePosition: "center-showcase", defaults: { fontSize: 17, alignment: "center", border: true, backgroundColor: "#f4ecd8", textColor: "#203832", cardSize: "a6-landscape", exportScale: 1, material: "cream-paper", frame: "thin-double", edge: "double-line", side: "front", textureIntensity: 45, brightness: 100, aging: 12 } },
  { value: "museum-specimen", labelKey: "museumSpecimenCard", defaultImagePosition: "left", defaults: { fontSize: 15, alignment: "left", border: true, backgroundColor: "#eee6d2", textColor: "#29322f", cardSize: "small-ticket", exportScale: 1, material: "archival-stock", frame: "cream-mat", edge: "square", side: "front", textureIntensity: 38, brightness: 100, aging: 18 } },
  { value: "auction", labelKey: "auctionNote", defaultImagePosition: "top", defaults: { fontSize: 15, alignment: "left", border: true, backgroundColor: "#fffaf0", textColor: "#272b2d", cardSize: "a6-landscape", exportScale: 1, material: "white-board", frame: "black-gallery", edge: "ticket", side: "front", textureIntensity: 22, brightness: 102, aging: 4 } },
  { value: "coin-cabinet", labelKey: "coinCabinetTicket", defaultImagePosition: "pair", defaults: { fontSize: 14, alignment: "left", border: true, backgroundColor: "#e8dfc8", textColor: "#282a27", cardSize: "small-ticket", exportScale: 1, material: "green-felt", frame: "coin-double", edge: "rounded", side: "front", textureIntensity: 62, brightness: 92, aging: 8, secondaryImageId: "" } },
  { value: "exhibition-share", labelKey: "exhibitionShareCard", defaultImagePosition: "center-showcase", defaults: { fontSize: 18, alignment: "center", border: true, backgroundColor: "#f7f2e8", textColor: "#183c36", cardSize: "social-landscape", exportScale: 1, material: "linen", frame: "white-mat", edge: "thin-gold", side: "front", textureIntensity: 35, brightness: 103, aging: 0 } },
  { value: "minimal", labelKey: "minimalArchiveCard", defaultImagePosition: "left", defaults: { fontSize: 16, alignment: "left", border: false, backgroundColor: "#ffffff", textColor: "#20282a", cardSize: "a6-landscape", exportScale: 1, material: "white-board", frame: "transparent", edge: "square", side: "front", textureIntensity: 10, brightness: 100, aging: 0 } }
];

const LABEL_CARD_SIZES = [
  { value: "small-ticket", labelKey: "smallTicket", width: 600, height: 360 },
  { value: "a6-landscape", labelKey: "a6Landscape", width: 740, height: 525 },
  { value: "a6-portrait", labelKey: "a6Portrait", width: 525, height: 740 },
  { value: "square-share", labelKey: "squareShareCard", width: 720, height: 720 },
  { value: "social-landscape", labelKey: "socialShareLandscape", width: 900, height: 506 }
];

const LABEL_CARD_IMAGE_POSITIONS = [
  { value: "center-showcase", labelKey: "centeredSingleImage" },
  { value: "top", labelKey: "imageTopTextBelow" },
  { value: "left", labelKey: "imageLeftTextRight" },
  { value: "pair", labelKey: "obverseReversePair" },
  { value: "main-detail", labelKey: "mainImageDetailImage" },
  { value: "text-only", labelKey: "textOnlyArchivalLabel" }
];

const LABEL_CARD_MATERIALS = [
  { value: "cream-paper", labelKey: "creamAlbumPaper", backgroundColor: "#f4ecd8", textColor: "#203832" },
  { value: "archival-stock", labelKey: "archivalCardStock", backgroundColor: "#e8dec8", textColor: "#29322f" },
  { value: "aged-paper", labelKey: "agedPaper", backgroundColor: "#d8bd82", textColor: "#3a2a19" },
  { value: "linen", labelKey: "linenTexture", backgroundColor: "#eee7d7", textColor: "#253430" },
  { value: "white-board", labelKey: "whiteMuseumBoard", backgroundColor: "#ffffff", textColor: "#20282a" },
  { value: "dark-walnut", labelKey: "darkWalnutWood", backgroundColor: "#2f1d13", textColor: "#f5ead7" },
  { value: "mahogany", labelKey: "mahoganyWood", backgroundColor: "#4b1f1c", textColor: "#f8ead8" },
  { value: "black-velvet", labelKey: "blackVelvet", backgroundColor: "#151716", textColor: "#f4efe4" },
  { value: "green-felt", labelKey: "greenFelt", backgroundColor: "#274c3a", textColor: "#f7f0dc" }
];

const LABEL_CARD_FRAMES = [
  { value: "thin-double", labelKey: "thinDoubleAlbumFrame" },
  { value: "black-mount", labelKey: "blackStampMount" },
  { value: "cream-mat", labelKey: "creamMatWindow" },
  { value: "transparent", labelKey: "transparentMount" },
  { value: "coin-recess", labelKey: "circularCoinRecess" },
  { value: "capsule", labelKey: "capsuleRim" },
  { value: "velvet-tray", labelKey: "velvetTray" },
  { value: "wood-slot", labelKey: "woodenCabinetSlot" },
  { value: "coin-double", labelKey: "obverseReverseFrame" },
  { value: "gold", labelKey: "classicGoldFrame" },
  { value: "dark-wood", labelKey: "darkWoodFrame" },
  { value: "black-gallery", labelKey: "blackGalleryFrame" },
  { value: "white-mat", labelKey: "whiteMatFrame" }
];

const LABEL_CARD_EDGES = [
  { value: "square", labelKey: "squareEdge" },
  { value: "rounded", labelKey: "roundedEdge" },
  { value: "clipped", labelKey: "clippedCorners" },
  { value: "double-line", labelKey: "doubleLineEdge" },
  { value: "embossed", labelKey: "embossedEdge" },
  { value: "thin-gold", labelKey: "thinGoldEdge" },
  { value: "ticket", labelKey: "ticketPerforation" },
  { value: "deckled", labelKey: "deckledEdge" }
];

function textFontCss(value) {
  return TEXT_FONT_OPTIONS.find((option) => option.value === value)?.css || TEXT_FONT_OPTIONS[0].css;
}

function snapshotItems(items) {
  return items.map((item) => ({
    ...item,
    cover: item.cover ? { ...item.cover } : null,
    images: item.images || []
  }));
}

function pageBackground(page) {
  return page.background === "custom" ? page.custom_background || "#ffffff" : PAGE_BACKGROUNDS[page.background] || "#ffffff";
}

function PageBackgroundImage({ page }) {
  const image = page.background_image;
  if (!image?.url) return null;
  const fit = page.background_fit || "contain";
  const opacity = clamp(Number(page.background_opacity ?? 1), 0, 1);
  return (
    <div
      className="page-background-image"
      style={{
        backgroundImage: `url("${image.url}")`,
        backgroundSize: fit === "stretch" ? "100% 100%" : fit === "tile" ? "auto" : fit,
        backgroundRepeat: fit === "tile" ? "repeat" : "no-repeat",
        backgroundPosition: "center",
        opacity
      }}
    />
  );
}

function logicalPageSize(page) {
  return {
    width: Number(page.page_width || (page.orientation === "landscape" ? 1400 : 1000)),
    height: Number(page.page_height || (page.orientation === "landscape" ? 1000 : 1400))
  };
}

function pagePaperPreset(page) {
  const { width, height } = logicalPageSize(page);
  const preset = PAPER_PRESETS[page.paper_preset];
  if (preset?.width === width && preset?.height === height) return page.paper_preset;
  const matched = Object.entries(PAPER_PRESETS).find(([, entry]) => entry.width === width && entry.height === height);
  return matched?.[0] || "custom";
}

function pagePhysicalSizeMm(page) {
  const preset = PAPER_PRESETS[pagePaperPreset(page)];
  if (preset?.widthMm && preset?.heightMm) {
    return { widthMm: preset.widthMm, heightMm: preset.heightMm };
  }
  const { width, height } = logicalPageSize(page);
  const fallbackMmPerUnit = 210 / 1000;
  return {
    widthMm: width * fallbackMmPerUnit,
    heightMm: height * fallbackMmPerUnit
  };
}

function pageMmToPx(page, value, axis = "x") {
  const { width, height } = logicalPageSize(page);
  const { widthMm, heightMm } = pagePhysicalSizeMm(page);
  const pageUnits = axis === "y" ? height : width;
  const physicalMm = axis === "y" ? heightMm : widthMm;
  return Number(value || 0) * pageUnits / Math.max(1, physicalMm);
}

function pagePxToMm(page, value, axis = "x") {
  const { width, height } = logicalPageSize(page);
  const { widthMm, heightMm } = pagePhysicalSizeMm(page);
  const pageUnits = axis === "y" ? height : width;
  const physicalMm = axis === "y" ? heightMm : widthMm;
  return Number(value || 0) * physicalMm / Math.max(1, pageUnits);
}

function placementPxToMm(page, entry) {
  return {
    widthMm: pagePxToMm(page, Number(entry?.width || 0), "x"),
    heightMm: pagePxToMm(page, Number(entry?.height || 0), "y")
  };
}

function placementMmToPx(page, widthMm, heightMm) {
  return {
    width: pageMmToPx(page, widthMm, "x"),
    height: pageMmToPx(page, heightMm, "y")
  };
}

function cropValue(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return clamp(numeric, 0, 0.5);
}

function cropValues(entry) {
  let left = cropValue(entry?.crop_left);
  let right = cropValue(entry?.crop_right);
  let top = cropValue(entry?.crop_top);
  let bottom = cropValue(entry?.crop_bottom);
  if (left + right > 0.9) {
    const scale = 0.9 / (left + right);
    left *= scale;
    right *= scale;
  }
  if (top + bottom > 0.9) {
    const scale = 0.9 / (top + bottom);
    top *= scale;
    bottom *= scale;
  }
  return { left, right, top, bottom };
}

function cropPayload(entry) {
  const crop = cropValues(entry);
  return {
    crop_left: crop.left,
    crop_right: crop.right,
    crop_top: crop.top,
    crop_bottom: crop.bottom
  };
}

function cropViewBox(entry) {
  const width = Math.max(1, Number(entry?.cover?.width || entry?.cover_width || 0));
  const height = Math.max(1, Number(entry?.cover?.height || entry?.cover_height || 0));
  const crop = cropValues(entry);
  const x = crop.left * width;
  const y = crop.top * height;
  const visibleWidth = Math.max(1, width * (1 - crop.left - crop.right));
  const visibleHeight = Math.max(1, height * (1 - crop.top - crop.bottom));
  return { x, y, width: visibleWidth, height: visibleHeight, imageWidth: width, imageHeight: height };
}

function visibleCropAspectRatio(entry) {
  const viewBox = cropViewBox(entry);
  return viewBox.width / Math.max(1, viewBox.height);
}

function normalizedFrameStyle(entry) {
  return ["none", "thin", "light", "shadow"].includes(entry?.frame_style) ? entry.frame_style : "none";
}

function rgbaFromHex(value, opacity) {
  const clean = String(value || "#ffffff").trim();
  const match = clean.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return clean;
  const alpha = clamp(Number(opacity ?? 1), 0, 1);
  return `rgba(${Number.parseInt(match[1], 16)}, ${Number.parseInt(match[2], 16)}, ${Number.parseInt(match[3], 16)}, ${alpha})`;
}

function placementFrameStyle(entry) {
  if (entry?.element_type === "text") return {};
  const frame = normalizedFrameStyle(entry);
  const borderColor = entry.border_color || "#b8c8c4";
  const backgroundColor = entry.background_color || "#ffffff";
  const opacity = Number(entry.background_opacity ?? (frame === "light" || frame === "shadow" ? 0.72 : 0));
  const padding = Math.max(0, Number(entry.padding ?? 4));
  const radius = Math.max(0, Number(entry.border_radius ?? 2));
  const border = frame === "none" ? "1px solid transparent" : `1px solid ${borderColor}`;
  return {
    padding,
    border,
    borderRadius: radius,
    background: frame === "none" ? "transparent" : rgbaFromHex(backgroundColor, opacity),
    boxShadow: frame === "shadow" ? "0 10px 24px rgba(22, 29, 31, 0.18)" : "none"
  };
}

function copyFrameFields(entry) {
  return {
    frame_style: normalizedFrameStyle(entry),
    border_color: entry.border_color || "#b8c8c4",
    background_color: entry.background_color || "#ffffff",
    background_opacity: Number(entry.background_opacity ?? 0),
    padding: Number(entry.padding ?? 4),
    border_radius: Number(entry.border_radius ?? 2),
    ...cropPayload(entry)
  };
}

function copyTextStyleFields(entry) {
  return {
    font_family: entry.font_family || "system",
    font_size: Number(entry.font_size || 24),
    bold: Boolean(entry.bold),
    italic: Boolean(entry.italic),
    underline: Boolean(entry.underline),
    text_align: entry.text_align || "center",
    line_height: Number(entry.line_height || 1.25),
    text_color: entry.text_color || "#202629",
    background: entry.background || "transparent",
    background_color: entry.background_color || "#ffffff",
    background_opacity: Number(entry.background_opacity ?? (entry.background === "white" ? 1 : 0)),
    border_color: entry.border_color || "#202629",
    border_width: Number(entry.border_width || 0),
    border_radius: Number(entry.border_radius || 0),
    padding: Number(entry.padding ?? 8)
  };
}

function textBoxStyle(entry) {
  const backgroundOpacity = Number(entry.background_opacity ?? (entry.background === "white" ? 1 : 0));
  const backgroundColor = entry.background === "transparent"
    ? "transparent"
    : rgbaFromHex(entry.background_color || "#ffffff", backgroundOpacity);
  return {
    fontFamily: textFontCss(entry.font_family || "system"),
    fontSize: Number(entry.font_size || 24),
    fontWeight: entry.bold ? 800 : 500,
    fontStyle: entry.italic ? "italic" : "normal",
    textDecoration: entry.underline ? "underline" : "none",
    textAlign: entry.text_align || "center",
    lineHeight: Number(entry.line_height || 1.25),
    color: entry.text_color || "#202629",
    background: backgroundColor,
    borderColor: entry.border_color || "#202629",
    borderWidth: Number(entry.border_width || 0),
    borderStyle: Number(entry.border_width || 0) > 0 ? "solid" : "none",
    borderRadius: Number(entry.border_radius || 0),
    padding: Number(entry.padding ?? 8)
  };
}

function localMediaUrl(kind, value) {
  if (!value) return "";
  const raw = String(value);
  if (/^(archive|https?|data|blob):/i.test(raw)) return raw;
  const clean = raw.split(/[?#]/)[0];
  const filename = clean.split(/[\\/]/).filter(Boolean).pop();
  return filename ? `archive://local/${kind}/${encodeURIComponent(filename)}` : "";
}

function fullImageUrl(image) {
  return (
    image?.url ||
    image?.fullUrl ||
    image?.full_url ||
    image?.imageUrl ||
    image?.image_url ||
    localMediaUrl("images", image?.image_path || image?.imagePath || image?.file_path || image?.filePath || image?.path || image?.stored_filename || image?.storedFilename)
  );
}

function thumbnailImageUrl(image) {
  return (
    image?.thumbnailUrl ||
    image?.thumbnail_url ||
    image?.thumbUrl ||
    image?.thumb_url ||
    localMediaUrl("thumbnails", image?.thumbnail_path || image?.thumbnailPath || image?.thumb_path || image?.thumbPath)
  );
}

function resolvePlacementExportImage(entry) {
  if (!entry || entry.element_type === "text") return null;
  const images = Array.isArray(entry.images) ? entry.images : [];
  const placementImageId = entry.image_id || entry.imageId || entry.selected_image_id || entry.selectedImageId || entry.image?.id || null;
  const selectedImage = placementImageId ? images.find((image) => image.id === placementImageId) : null;
  const coverImage = entry.cover?.id ? images.find((image) => image.id === entry.cover.id) : null;
  const directImage = entry.image || entry.display_image || entry.selected_image || null;
  const image = selectedImage || directImage || coverImage || entry.cover || images[0] || null;
  const imageLike = image || entry;
  const fullUrl = fullImageUrl(imageLike) || fullImageUrl(entry);
  const thumbUrl = thumbnailImageUrl(imageLike) || thumbnailImageUrl(entry);
  if (!fullUrl && !thumbUrl) return null;
  return {
    ...imageLike,
    id: imageLike.id || placementImageId || entry.cover?.id || entry.image_id || entry.id,
    url: fullUrl || thumbUrl,
    thumbnailUrl: thumbUrl || fullUrl
  };
}

function PlacementImage({ entry, src, alt, context }) {
  const viewBox = cropViewBox(entry);
  const hasImageSize = Number(entry?.cover?.width || 0) > 0 && Number(entry?.cover?.height || 0) > 0;
  if (!src || !hasImageSize) {
    return src ? <MediaImage src={src} alt={alt} context={context} /> : <div className="image-placeholder">No image</div>;
  }
  return (
    <svg
      className="placement-crop-svg"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={alt}
    >
      <image href={src} width={viewBox.imageWidth} height={viewBox.imageHeight} preserveAspectRatio="none" />
    </svg>
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cssUrl(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cssValue(key, value) {
  if (typeof value === "number") return `${value}px`;
  return String(value);
}

function styleToCss(style) {
  const unitless = new Set(["opacity", "zIndex", "fontWeight", "lineHeight", "flexGrow", "flexShrink"]);
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:${unitless.has(key) ? String(value) : cssValue(key, value)}`)
    .join(";");
}

function safeExportFilename(name, fallback = "album") {
  const cleaned = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function exportFrameCss(entry) {
  return styleToCss({
    boxSizing: "border-box",
    ...placementFrameStyle(entry)
  });
}

function renderExportCroppedImage(entry, image) {
  if (!image?.url) return `<div class="export-placeholder">No image</div>`;
  const width = Number(image.width || entry.cover?.width || 0);
  const height = Number(image.height || entry.cover?.height || 0);
  if (width <= 0 || height <= 0) {
    return `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(entry.title || image.original_filename || "Album image")}" />`;
  }
  const viewBox = cropViewBox({
    ...entry,
    cover: {
      ...(entry.cover || {}),
      width,
      height
    }
  });
  return `
    <svg class="export-crop-svg" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(entry.title || image.original_filename || "Album image")}">
      <image href="${escapeHtml(image.url)}" width="${viewBox.imageWidth}" height="${viewBox.imageHeight}" preserveAspectRatio="none"></image>
    </svg>
  `;
}

function renderExportPlacement(entry) {
  const baseStyle = {
    left: Number(entry.x || 0),
    top: Number(entry.y || 0),
    width: Number(entry.width || 100),
    height: Number(entry.height || 100),
    zIndex: Number(entry.z_index || 0),
    transform: `rotate(${Number(entry.rotation || 0)}deg)`
  };

  if (entry.element_type === "text") {
    return `
      <div class="export-placement export-text-placement" style="${styleToCss(baseStyle)}">
        <div class="export-text-content" style="${styleToCss({
          ...textBoxStyle(entry)
        })}">${escapeHtml(entry.text_content || "")}</div>
      </div>
    `;
  }

  const image = resolvePlacementExportImage(entry);
  const imageHtml = renderExportCroppedImage(entry, image);
  const textParts = [];
  if (entry.show_title) textParts.push(`<strong>${escapeHtml(entry.title || "")}</strong>`);
  if (entry.show_caption && entry.caption) textParts.push(`<span>${escapeHtml(entry.caption)}</span>`);
  if (entry.show_metadata) {
    const metadata = [entry.country_name, entry.type_name, entry.year].filter(Boolean).join(" / ");
    if (metadata) textParts.push(`<span>${escapeHtml(metadata)}</span>`);
  }

  return `
    <div class="export-placement export-image-placement" style="${styleToCss(baseStyle)};${exportFrameCss(entry)}">
      <div class="export-image-box">${imageHtml}</div>
      ${textParts.length ? `<div class="export-placement-text">${textParts.join("")}</div>` : ""}
    </div>
  `;
}

function renderExportBackgroundImage(page) {
  if (!page.background_image_enabled || !page.background_image?.url) return "";
  const fit = page.background_fit || "contain";
  if (fit === "tile") {
    return `
      <img class="export-preload-image" src="${escapeHtml(page.background_image.url)}" alt="" />
      <div class="export-page-background-tile" style="${styleToCss({
        backgroundImage: `url("${cssUrl(page.background_image.url)}")`,
        opacity: clamp(Number(page.background_opacity ?? 1), 0, 1)
      })}"></div>
    `;
  }
  return `
    <div class="export-page-background-image" style="${styleToCss({ opacity: clamp(Number(page.background_opacity ?? 1), 0, 1) })}">
      <img src="${escapeHtml(page.background_image.url)}" alt="" style="${styleToCss({
        objectFit: fit === "stretch" ? "fill" : fit
      })}" />
    </div>
  `;
}

function renderExportPage(page) {
  const { width, height } = logicalPageSize(page);
  const items = [...(page.items || [])].sort((a, b) => Number(a.z_index || 0) - Number(b.z_index || 0));
  return `
    <section class="export-page" data-export-page style="${styleToCss({ width, height, background: pageBackground(page) })}">
      ${renderExportBackgroundImage(page)}
      ${items.map(renderExportPlacement).join("")}
    </section>
  `;
}

function buildAlbumExportHtml(pages, albumTitle, options = {}) {
  const exportPages = pages.length ? pages : [{ page_width: 1000, page_height: 1400, items: [] }];
  const pageSizes = exportPages.map(logicalPageSize);
  const firstSize = pageSizes[0];
  const exportWidth = options.pdf ? Math.max(...pageSizes.map((size) => size.width)) : firstSize.width;
  const exportHeight = options.pdf ? Math.max(...pageSizes.map((size) => size.height)) : firstSize.height;
  const pdfClass = options.pdf ? "pdf-export" : "png-export";
  const pageMarkup = options.pdf
    ? exportPages.map((page) => `<div class="export-page-frame" style="${styleToCss({ width: exportWidth, height: exportHeight })}">${renderExportPage(page)}</div>`).join("")
    : exportPages.map(renderExportPage).join("");
  return `<!doctype html>
<html class="${pdfClass}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(albumTitle || "Album export")}</title>
  <style>
    @page { size: ${exportWidth}px ${exportHeight}px; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; font-family: Inter, Segoe UI, Arial, sans-serif; }
    html.png-export, body.png-export { width: ${exportWidth}px; height: ${exportHeight}px; overflow: hidden; }
    html.pdf-export { width: ${exportWidth}px; overflow: hidden; }
    body.pdf-export { width: ${exportWidth}px; overflow: hidden; }
    .export-page-frame { display: grid; place-items: center; overflow: hidden; break-after: page; page-break-after: always; }
    .export-page-frame:last-child { break-after: auto; page-break-after: auto; }
    .export-page { position: relative; overflow: hidden; break-after: page; page-break-after: always; }
    .export-page:last-child { break-after: auto; page-break-after: auto; }
    body.pdf-export .export-page { break-after: auto; page-break-after: auto; }
    .export-page-background-image, .export-page-background-tile { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
    .export-page-background-image img { display: block; width: 100%; height: 100%; object-position: center; }
    .export-page-background-tile { background-repeat: repeat; background-position: top left; background-size: auto; }
    .export-preload-image { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .export-placement { position: absolute; display: grid; transform-origin: center; overflow: hidden; min-width: 0; min-height: 0; }
    .export-image-placement { grid-template-rows: minmax(0, 1fr) auto; gap: 8px; }
    .export-image-box { display: grid; min-width: 0; min-height: 0; width: 100%; height: 100%; place-items: center; overflow: hidden; }
    .export-image-box img, .export-crop-svg { display: block; width: 100%; height: 100%; object-fit: contain; }
    .export-placeholder { display: grid; width: 100%; height: 100%; place-items: center; color: #667477; background: #eef3f2; }
    .export-placement-text { display: grid; gap: 2px; max-height: 72px; overflow: hidden; color: #263234; font-size: 14px; line-height: 1.25; }
    .export-placement-text strong, .export-placement-text span { min-width: 0; overflow-wrap: anywhere; }
    .export-text-content { display: grid; width: 100%; height: 100%; align-items: center; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
  </style>
</head>
<body class="${pdfClass}">
  ${pageMarkup}
</body>
</html>`;
}

function templateLayout(templateName, items, page) {
  const { width: pageWidth, height: pageHeight } = logicalPageSize(page);
  const margin = 70;
  const gap = 28;
  const usableWidth = pageWidth - margin * 2;
  const rows = [];

  function grid(columns, slotHeight) {
    const slotWidth = (usableWidth - gap * (columns - 1)) / columns;
    return items.map((item, index) => ({
      ...item,
      x: margin + (index % columns) * (slotWidth + gap),
      y: 120 + Math.floor(index / columns) * (slotHeight + 72),
      width: slotWidth,
      height: slotHeight,
      z_index: index,
      sort_order: index
    }));
  }

  if (templateName === "2-column") return grid(2, 300);
  if (templateName === "3-column") return grid(3, 255);
  if (templateName === "4-column") return grid(4, 220);
  if (templateName === "coin-tray") return grid(5, 150);
  if (templateName === "banknote-rows") {
    return items.map((item, index) => ({
      ...item,
      x: margin,
      y: 110 + index * 185,
      width: usableWidth,
      height: 145,
      z_index: index,
      sort_order: index
    }));
  }

  items.forEach((item, index) => {
    const width = Math.min(260, usableWidth);
    rows.push({
      ...item,
      x: margin + (index % 3) * (width + gap),
      y: Math.min(pageHeight - 260, 120 + Math.floor(index / 3) * 300),
      width,
      height: 230,
      z_index: index,
      sort_order: index
    });
  });
  return rows;
}

function AlbumItemPicker({ countries, entityGroups = [], types, pageId, title = "Add item", onAdd, onBulkAdd, onClose }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [countryId, setCountryId] = useState("");
  const [entityGroupId, setEntityGroupId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [year, setYear] = useState("");
  const [tag, setTag] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [results, setResults] = useState({ items: [], total: 0, loading: false });
  const [highlighted, setHighlighted] = useState(0);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemDetail, setSelectedItemDetail] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const searchRef = useRef(null);
  const pageSize = 24;

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    setPage(0);
    setHighlighted(0);
  }, [countryId, entityGroupId, favoritesOnly, query, tag, typeId, year]);

  useEffect(() => {
    let cancelled = false;
    setResults((current) => ({ ...current, loading: true }));
    api.queryItems({
      search: query,
      countryId,
      entityGroupId,
      typeId,
      year,
      tag,
      favorite: favoritesOnly,
      limit: pageSize,
      offset: page * pageSize,
      sort: "updated_desc"
    }).then((result) => {
      if (!cancelled) {
        setResults({ items: result.items, total: result.total, loading: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [countryId, entityGroupId, favoritesOnly, page, query, tag, typeId, year]);

  useEffect(() => {
    if (!selectedItem) {
      setSelectedItemDetail(null);
      setSelectedImageId("");
      return;
    }
    api.getItem(selectedItem.id).then((detail) => {
      setSelectedItemDetail(detail);
      setSelectedImageId("");
    });
  }, [selectedItem]);

  const pageCount = Math.max(1, Math.ceil(results.total / pageSize));
  const visibleItems = results.items;
  const activeItem = visibleItems[highlighted] || visibleItems[0] || null;
  const images = selectedItemDetail?.images || [];
  const canBulkAdd = Boolean(onBulkAdd);
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);

  function selectItem(item) {
    setSelectedItem(item);
  }

  function togglePickerItem(itemId, checked) {
    setSelectedItemIds((current) => checked ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId));
  }

  async function add(closeAfter) {
    const item = selectedItem || activeItem;
    if (!item || !pageId) return;
    const fallbackImageId = selectedItemDetail?.images?.[0]?.id || item.cover?.id || null;
    await onAdd({
      page_id: pageId,
      item_id: item.id,
      image_id: selectedImageId || fallbackImageId
    });
    if (closeAfter) {
      onClose();
    } else {
      setSelectedItem(null);
      setSelectedItemDetail(null);
      setSelectedImageId("");
      searchRef.current?.focus();
    }
  }

  async function addBulk(mode, closeAfter) {
    if (!pageId || !onBulkAdd) return;
    const itemIds = selectedItemIds.length
      ? selectedItemIds
      : [(selectedItem || activeItem)?.id].filter(Boolean);
    if (!itemIds.length) return;
    await onBulkAdd({ page_id: pageId, item_ids: itemIds, mode });
    if (closeAfter) {
      onClose();
    } else {
      setSelectedItemIds([]);
      setSelectedItem(null);
      setSelectedItemDetail(null);
      setSelectedImageId("");
      searchRef.current?.focus();
    }
  }

  function handleKeyDown(event) {
    if (shouldIgnoreAppShortcut(event, "AlbumItemPicker.keydown")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((current) => Math.min(visibleItems.length - 1, current + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) => Math.max(0, current - 1));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeItem) selectItem(activeItem);
    }
  }

  return (
    <div className="picker-backdrop" onKeyDown={handleKeyDown}>
      <section className="item-picker" role="dialog" aria-modal="true" aria-label="Add item to album page">
        <header>
          <div>
            <h2>{title}</h2>
            <p>{results.total} matches</p>
            {canBulkAdd && selectedItemIds.length > 0 ? <p className="hint">{t("selectedCount", "", { count: selectedItemIds.length })}</p> : null}
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="picker-filters">
          <input data-input-debug="Album item picker search" ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title" />
          <select value={countryId} onChange={(event) => setCountryId(event.target.value)}>
            <option value="">All issuing entities</option>
            {orderedRows(countries).map((country) => <option value={country.id} key={country.id}>{country.name}</option>)}
          </select>
          <select value={entityGroupId} onChange={(event) => setEntityGroupId(event.target.value)}>
            <option value="">All entity groups</option>
            {orderedRows(entityGroups).map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
          </select>
          <select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
            <option value="">All types</option>
            {orderedRows(types).map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}
          </select>
          <input data-input-debug="Album item picker year" value={year} onChange={(event) => setYear(event.target.value)} placeholder="Year" />
          <input data-input-debug="Album item picker tags" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Tags" />
          <label><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /> Favorites</label>
        </div>
        <div className="picker-body">
          <div className="picker-results">
            {visibleItems.map((item, index) => (
              <button
                className={`picker-result ${selectedItem?.id === item.id ? "selected" : ""} ${highlighted === index ? "highlighted" : ""}`}
                type="button"
                key={item.id}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => selectItem(item)}
              >
                {canBulkAdd && (
                  <span className="picker-result-check" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedItemIdSet.has(item.id)}
                      aria-label={`Select ${item.title}`}
                      onChange={(event) => togglePickerItem(item.id, event.target.checked)}
                    />
                  </span>
                )}
                <div className="picker-thumb">
                  <ItemImage image={item.cover} alt={item.title} />
                </div>
                <div>
                  <strong>{item.title}</strong>
                  <span>{[item.country_name, item.year, item.type_name].filter(Boolean).join(" / ") || "No metadata"}</span>
                  <small>{item.imageCount} image{item.imageCount === 1 ? "" : "s"}</small>
                </div>
              </button>
            ))}
            {results.loading && <p className="quiet">Loading items...</p>}
            {visibleItems.length === 0 && !results.loading && <p className="quiet">No matching items.</p>}
          </div>
          <aside className="picker-selection">
            {selectedItem ? (
              <>
                <h3>{selectedItem.title}</h3>
                <p>{[selectedItem.country_name, selectedItem.year, selectedItem.type_name].filter(Boolean).join(" / ")}</p>
                <div className="picker-image-grid">
                  {(images.length ? images : [selectedItem.cover]).filter(Boolean).map((image, index) => (
                    <button
                      className={(selectedImageId || images[0]?.id || "") === (image.id || "") ? "active" : ""}
                      type="button"
                      key={image.id || "cover"}
                      onClick={() => setSelectedImageId(image.id || "")}
                    >
                      <MediaImage src={image.thumbnailUrl || image.url} alt={`${selectedItem.title} image ${index + 1}`} context={`Album picker: ${selectedItem.title}`} />
                      <span>Image {index + 1}</span>
                    </button>
                  ))}
                </div>
                <div className="picker-actions">
                  <button type="button" onClick={() => add(false)}>Add and keep open</button>
                  <button type="button" onClick={() => add(true)}>Add and close</button>
                  {canBulkAdd && (
                    <button type="button" className="secondary" disabled={selectedItemDetail && images.length === 0} onClick={() => addBulk("allImages", false)}>{t("useAllImages")}</button>
                  )}
                </div>
              </>
            ) : (
              <p className="quiet">Select an item to choose its image.</p>
            )}
            {canBulkAdd && selectedItemIds.length > 0 && (
              <div className="picker-bulk-actions">
                <button type="button" className="secondary" onClick={() => addBulk("cover", false)}>{t("addSelectedFirstImages")}</button>
                <button type="button" className="secondary" onClick={() => addBulk("allImages", false)}>{t("addSelectedAllImages")}</button>
                <button type="button" className="primary" onClick={() => addBulk("cover", true)}>{t("addSelectedFirstImages")} / {t("close")}</button>
              </div>
            )}
          </aside>
        </div>
        <footer className="picker-pagination">
          <button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span>Page {page + 1} of {pageCount}</span>
          <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((current) => current + 1)}>Next</button>
        </footer>
      </section>
    </div>
  );
}

function AlbumPage({ page, mode, previewStyle, onRemoveItemFromPage, onUpdatePage, onDeletePage, onUpdatePageItem, onAddItemToPage, onAddTextToPage, onOpenItemPicker, onPickBackground }) {
  const [viewerIndex, setViewerIndex] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [draftItems, setDraftItems] = useState(page.items || []);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [editorZoom, setEditorZoom] = useState(1);
  const [saveStatus, setSaveStatus] = useState("Saved");
  const [selectionRect, setSelectionRect] = useState(null);
  const [editingTextId, setEditingTextId] = useState("");
  const canvasViewportRef = useRef(null);
  const clipboardRef = useRef([]);
  const draftItemsRef = useRef([]);
  const selectedIdsRef = useRef([]);
  const pageSettingsSaveRef = useRef(null);
  const interactionCleanupRef = useRef(null);
  const textEditRefs = useRef(new Map());
  const textCommitTimersRef = useRef(new Map());
  const { language, t } = useI18n();
  const [previewScale, setPreviewScale] = useState(1);
  const { width: pageWidth, height: pageHeight } = logicalPageSize(page);
  const scale = mode === "edit" ? editorZoom : previewScale;
  const cleanPreview = mode === "preview" && previewStyle === "clean";
  const sortedItems = [...draftItems].sort((a, b) => Number(a.z_index || 0) - Number(b.z_index || 0));
  const selectedEntries = draftItems.filter((entry) => selectedIds.includes(entry.id));
  const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
  function resolveAlbumPlacementImage(entry) {
    if (!entry || entry.element_type === "text") return null;
    const images = Array.isArray(entry.images) ? entry.images : [];
    const placementImageId = entry.image_id || entry.imageId || entry.selected_image_id || entry.selectedImageId || entry.image?.id || null;
    const selectedImage = placementImageId ? images.find((image) => image.id === placementImageId) : null;
    const coverImage = entry.cover?.id ? images.find((image) => image.id === entry.cover.id) : null;
    const directImage = entry.image || entry.display_image || entry.selected_image || null;
    const image = selectedImage || directImage || coverImage || entry.cover || images[0] || null;
    const imageLike = image || entry;
    const fullUrl = fullImageUrl(imageLike) || fullImageUrl(entry);
    const thumbUrl = thumbnailImageUrl(imageLike) || thumbnailImageUrl(entry);
    const resolved = {
      ...imageLike,
      id: imageLike.id || placementImageId || entry.cover?.id || entry.image_id || entry.id,
      url: fullUrl || thumbUrl || "",
      thumbnailUrl: thumbUrl || fullUrl || "",
      width: imageLike.width || entry.cover?.width || entry.image_width || entry.cover_width,
      height: imageLike.height || entry.cover?.height || entry.image_height || entry.cover_height,
      aspect_ratio: imageLike.aspect_ratio || entry.cover?.aspect_ratio || entry.image_aspect_ratio || entry.cover_aspect_ratio,
      slotId: entry.id,
      itemId: entry.item_id,
      title: entry.title
    };
    return resolved;
  }
  const viewerImages = draftItems.map(resolveAlbumPlacementImage).filter(Boolean);

  useEffect(() => {
    draftItemsRef.current = draftItems;
  }, [draftItems]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    setDraftItems(page.items || []);
    setSelectedIds([]);
    setSelectionRect(null);
    setEditingTextId("");
    cleanupInteraction();
  }, [page.id]);

  useEffect(() => {
    setSelectionRect(null);
    setEditingTextId("");
    cleanupInteraction();
  }, [mode, language]);

  useEffect(() => () => {
    cleanupInteraction();
    textCommitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    textCommitTimersRef.current.clear();
  }, []);

  function focusTextEditor(entryId) {
    window.requestAnimationFrame(() => {
      const node = textEditRefs.current.get(entryId);
      if (!node) return;
      node.focus({ preventScroll: true });
      if (typeof node.setSelectionRange === "function") {
        const length = String(node.value || "").length;
        node.setSelectionRange(length, length);
        return;
      }
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }

  useLayoutEffect(() => {
    if (!editingTextId) return;
    focusTextEditor(editingTextId);
  }, [editingTextId]);

  function cleanupInteraction() {
    if (interactionCleanupRef.current) {
      interactionCleanupRef.current();
      interactionCleanupRef.current = null;
    }
    setSelectionRect(null);
  }

  function setInteractionCleanup(cleanup) {
    cleanupInteraction();
    interactionCleanupRef.current = cleanup;
  }

  function latestDraftEntry(entry) {
    return draftItemsRef.current.find((item) => item.id === entry.id) || entry;
  }

  function scheduleTextCommit(entry, textContent, delay = 450) {
    const existing = textCommitTimersRef.current.get(entry.id);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      textCommitTimersRef.current.delete(entry.id);
      commitEntry({ ...latestDraftEntry(entry), text_content: textContent }, false);
    }, delay);
    textCommitTimersRef.current.set(entry.id, timer);
  }

  function flushTextCommit(entry, textContent) {
    const existing = textCommitTimersRef.current.get(entry.id);
    if (existing) {
      window.clearTimeout(existing);
      textCommitTimersRef.current.delete(entry.id);
    }
    const currentEntry = latestDraftEntry(entry);
    if (existing || textContent !== (currentEntry.text_content || "")) {
      commitEntry({ ...currentEntry, text_content: textContent }, true);
    }
  }

  useEffect(() => {
    const nextItems = page.items || [];
    setDraftItems(nextItems);
    if (selectedIds.some((selectedId) => !nextItems.some((entry) => entry.id === selectedId))) {
      setSelectedIds((current) => current.filter((selectedId) => nextItems.some((entry) => entry.id === selectedId)));
    }
  }, [page.items, selectedIds]);

  function measureCanvasViewport(node) {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const styles = window.getComputedStyle(node);
    const horizontalPadding = Number.parseFloat(styles.paddingLeft || "0") + Number.parseFloat(styles.paddingRight || "0");
    const verticalPadding = Number.parseFloat(styles.paddingTop || "0") + Number.parseFloat(styles.paddingBottom || "0");
    const horizontalBorder = Number.parseFloat(styles.borderLeftWidth || "0") + Number.parseFloat(styles.borderRightWidth || "0");
    const verticalBorder = Number.parseFloat(styles.borderTopWidth || "0") + Number.parseFloat(styles.borderBottomWidth || "0");
    const availableWidth = Math.max(260, node.clientWidth - horizontalPadding - horizontalBorder - 2);
    const wrapHeight = node.clientHeight || Math.max(360, window.innerHeight - rect.top - 16);
    const availableHeight = Math.max(320, wrapHeight - verticalPadding - verticalBorder - 2);
    return { availableWidth, availableHeight };
  }

  function debugAlbumLayout(event, details) {
    if (window.localStorage?.getItem("archiveDebugAlbumLayout") === "1") {
      console.log("[album-layout]", event, details);
    }
  }

  function calculateFitScale(node) {
    const measurement = measureCanvasViewport(node);
    if (!measurement) return editorZoom;
    const { availableWidth } = measurement;
    const fitWidth = (availableWidth - 8) / pageWidth;
    return clamp(fitWidth, MIN_EDITOR_ZOOM, MAX_EDITOR_ZOOM);
  }

  function fitPage(reason = "manual") {
    const node = canvasViewportRef.current;
    if (!node) return;
    const measurement = measureCanvasViewport(node);
    const nextScale = calculateFitScale(node);
    setEditorZoom((current) => {
      debugAlbumLayout("fit-page", {
        reason,
        previousZoom: current,
        nextZoom: nextScale,
        container: measurement,
        page: { width: pageWidth, height: pageHeight }
      });
      return Math.abs(current - nextScale) < 0.01 ? current : nextScale;
    });
  }

  function zoomEditorAtPoint(nextZoom, event) {
    const node = canvasViewportRef.current;
    if (!node) {
      setEditorZoom(nextZoom);
      return;
    }
    const rect = node.getBoundingClientRect();
    const viewportX = event.clientX - rect.left;
    const viewportY = event.clientY - rect.top;
    const logicalX = (node.scrollLeft + viewportX) / editorZoom;
    const logicalY = (node.scrollTop + viewportY) / editorZoom;
    setEditorZoom(nextZoom);
    window.requestAnimationFrame(() => {
      node.scrollLeft = logicalX * nextZoom - viewportX;
      node.scrollTop = logicalY * nextZoom - viewportY;
    });
  }

  function handleEditorWheel(event) {
    if (mode !== "edit" || !event.ctrlKey) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = clamp(editorZoom * factor, MIN_EDITOR_ZOOM, MAX_EDITOR_ZOOM);
    if (Math.abs(nextZoom - editorZoom) < 0.001) return;
    zoomEditorAtPoint(nextZoom, event);
  }

  useEffect(() => {
    if (mode !== "edit") return undefined;
    const node = canvasViewportRef.current;
    if (!node) return undefined;
    node.addEventListener("wheel", handleEditorWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleEditorWheel);
  }, [mode, editorZoom, pageWidth, pageHeight]);

  useLayoutEffect(() => {
    if (mode !== "preview") return undefined;
    const node = canvasViewportRef.current;
    if (!node) return undefined;
    const measurement = measureCanvasViewport(node);
    if (measurement) {
      const nextScale = clamp(measurement.availableWidth / pageWidth, 0.2, 1);
      setPreviewScale((current) => (Math.abs(current - nextScale) < 0.01 ? current : nextScale));
    }
    return undefined;
  }, [mode, page.id, pageWidth]);

  function pushHistory(items = draftItems) {
    setHistory((current) => [...current.slice(-24), snapshotItems(items)]);
    setFuture([]);
  }

  function updateDraft(nextEntry) {
    setDraftItems((current) => current.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry)));
  }

  async function commitEntry(nextEntry, record = false) {
    if (record) pushHistory();
    updateDraft(nextEntry);
    setSaveStatus("Saving...");
    await onUpdatePageItem(nextEntry);
    setSaveStatus("Saved");
  }

  async function commitEntries(nextEntries, record = false) {
    if (record) pushHistory();
    const byId = new Map(nextEntries.map((entry) => [entry.id, entry]));
    setDraftItems((current) => current.map((entry) => byId.get(entry.id) || entry));
    setSaveStatus("Saving...");
    await Promise.all(nextEntries.map((entry) => onUpdatePageItem(entry)));
    setSaveStatus("Saved");
  }

  async function applySnapshot(snapshot, direction) {
    const current = snapshotItems(draftItems);
    setDraftItems(snapshot);
    if (direction === "undo") {
      setHistory((entries) => entries.slice(0, -1));
      setFuture((entries) => [current, ...entries]);
    } else {
      setFuture((entries) => entries.slice(1));
      setHistory((entries) => [...entries, current]);
    }
    setSaveStatus("Saving...");
    await Promise.all(snapshot.map((entry) => onUpdatePageItem(entry)));
    setSaveStatus("Saved");
  }

  async function undo() {
    if (!history.length) return;
    await applySnapshot(history[history.length - 1], "undo");
  }

  async function redo() {
    if (!future.length) return;
    await applySnapshot(future[0], "redo");
  }

  function copySelection() {
    const selected = new Set(selectedIdsRef.current);
    clipboardRef.current = draftItemsRef.current.filter((entry) => selected.has(entry.id)).map((entry) => ({ ...entry }));
  }

  async function pasteClipboard() {
    const source = clipboardRef.current || [];
    if (!source.length) return;
    const currentItems = draftItemsRef.current;
    const existingIds = new Set(currentItems.map((entry) => entry.id));
    const maxZ = Math.max(...currentItems.map((entry) => Number(entry.z_index || 0)), 0);
    let latestAlbum = null;
    pushHistory();
    for (const [index, entry] of source.entries()) {
      const width = Number(entry.width || 140);
      const height = Number(entry.height || 140);
      const common = {
        page_id: page.id,
        x: clamp(Number(entry.x || 0) + 20, 0, pageWidth - width),
        y: clamp(Number(entry.y || 0) + 20, 0, pageHeight - height),
        width,
        height,
        rotation: Number(entry.rotation || 0),
          z_index: maxZ + index + 1,
          locked: entry.locked
        };
      if (entry.element_type === "text") {
        latestAlbum = await onAddTextToPage({
          ...common,
          text_content: entry.text_content,
          ...copyTextStyleFields(entry)
        });
      } else {
        latestAlbum = await onAddItemToPage({
          ...common,
          item_id: entry.item_id,
          image_id: entry.image_id || entry.cover?.id || null,
          caption: entry.caption,
          show_caption: entry.show_caption,
          show_title: entry.show_title,
          show_metadata: entry.show_metadata,
          ...copyFrameFields(entry)
        });
      }
    }
    const nextPage = latestAlbum?.pages?.find((entry) => entry.id === page.id);
    const nextItems = nextPage?.items || [];
    const pastedIds = nextItems.filter((entry) => !existingIds.has(entry.id)).map((entry) => entry.id);
    if (pastedIds.length) {
      setDraftItems(nextItems);
      setSelectedIds(pastedIds);
    }
  }

  useEffect(() => {
    function handleKeyDown(event) {
      if (mode !== "edit") return;
      if (shouldIgnoreAppShortcut(event, "AlbumPage.keydown")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedIds([]);
        setEditingTextId("");
        cleanupInteraction();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(draftItemsRef.current.map((entry) => entry.id));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      const currentSelected = draftItemsRef.current.filter((entry) => selectedIdsRef.current.includes(entry.id));
      if (currentSelected.length === 0) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const count = currentSelected.length;
        if (window.confirm(`Remove ${count} selected placement${count === 1 ? "" : "s"} from this album page? This will not delete the underlying collectible item${count === 1 ? "" : "s"}.`)) {
          pushHistory();
          Promise.all(currentSelected.map((entry) => onRemoveItemFromPage(entry.id)));
        }
        return;
      }
      const baseMovement = page.snap_to_grid ? Math.max(1, Number(page.grid_size || 5)) : 5;
      const movement = event.shiftKey ? baseMovement * 4 : baseMovement;
      const arrows = { ArrowLeft: [-movement, 0], ArrowRight: [movement, 0], ArrowUp: [0, -movement], ArrowDown: [0, movement] };
      if (arrows[event.key]) {
        event.preventDefault();
        const [dx, dy] = arrows[event.key];
        commitEntries(currentSelected.map((entry) => clampPlacement({ ...entry, x: entry.x + dx, y: entry.y + dy })), true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [future, history, mode, page.grid_size, page.id, page.snap_to_grid, pageHeight, pageWidth]);

  useEffect(() => {
    function handleCancelInteractions() {
      cleanupInteraction();
      setSelectionRect(null);
    }
    window.addEventListener("archive:cancel-interactions", handleCancelInteractions);
    return () => window.removeEventListener("archive:cancel-interactions", handleCancelInteractions);
  }, []);

  function snap(value) {
    if (!page.snap_to_grid) return value;
    const grid = Math.max(1, Number(page.grid_size || 25));
    return Math.round(value / grid) * grid;
  }

  function clampPlacement(entry) {
    const width = clamp(Number(entry.width || 80), 50, pageWidth);
    const height = clamp(Number(entry.height || 80), 50, pageHeight);
    return {
      ...entry,
      width,
      height,
      x: clamp(snap(Number(entry.x || 0)), 0, pageWidth - width),
      y: clamp(snap(Number(entry.y || 0)), 0, pageHeight - height)
    };
  }

  function selectEntry(entryId, event) {
    if (event?.ctrlKey || event?.metaKey) {
      setSelectedIds((current) => (current.includes(entryId) ? current.filter((id) => id !== entryId) : [...current, entryId]));
      return;
    }
    if (event?.shiftKey) {
      setSelectedIds((current) => (current.includes(entryId) ? current : [...current, entryId]));
      return;
    }
    setSelectedIds([entryId]);
  }

  function beginPointer(event, entry, action) {
    if (mode !== "edit") return;
    if (entry.element_type === "text" && event.detail >= 2 && event.target.closest?.(".album-text-content")) {
      event.preventDefault();
      event.stopPropagation();
      cleanupInteraction();
      selectEntry(entry.id, event);
      setEditingTextId(entry.id);
      focusTextEditor(entry.id);
      return;
    }
    if (entry.element_type === "text" && editingTextId === entry.id && event.target.closest?.(".album-text-content")) {
      event.stopPropagation();
      selectEntry(entry.id, event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    cleanupInteraction();
    setEditingTextId("");
    if (!selectedIds.includes(entry.id) && !(event.ctrlKey || event.metaKey || event.shiftKey)) {
      selectEntry(entry.id, event);
    }
    pushHistory();
    const startX = event.clientX;
    const startY = event.clientY;
    const activeIds = selectedIds.includes(entry.id) && !(event.ctrlKey || event.metaKey || event.shiftKey) ? selectedIds : [entry.id];
    const starts = draftItems.filter((item) => activeIds.includes(item.id)).map((item) => ({ ...item }));
    const start = starts.find((item) => item.id === entry.id) || { ...entry };
    let currentEntries = starts;
    const ratio = Math.max(0.1, Number(start.width || 1) / Number(start.height || 1));

    function move(pointerEvent) {
      const dx = (pointerEvent.clientX - startX) / scale;
      const dy = (pointerEvent.clientY - startY) / scale;
      if (action === "resize") {
        currentEntries = starts.map((item) => {
          const itemRatio = Math.max(0.1, Number(item.width || 1) / Number(item.height || 1));
          const nextWidth = item.width + dx;
          const nextHeight = item.locked ? nextWidth / (item.id === start.id ? ratio : itemRatio) : item.height + dy;
          return clampPlacement({ ...item, width: nextWidth, height: nextHeight });
        });
      } else {
        currentEntries = starts.map((item) => clampPlacement({ ...item, x: item.x + dx, y: item.y + dy }));
      }
      const byId = new Map(currentEntries.map((item) => [item.id, item]));
      setDraftItems((current) => current.map((item) => byId.get(item.id) || item));
    }

    async function finish(pointerEvent) {
      if (typeof pointerEvent.clientX === "number" && typeof pointerEvent.clientY === "number") {
        move(pointerEvent);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", cancel);
      interactionCleanupRef.current = null;
      await commitEntries(currentEntries);
    }

    function cancel() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", cancel);
      interactionCleanupRef.current = null;
      const byId = new Map(starts.map((item) => [item.id, item]));
      setDraftItems((current) => current.map((item) => byId.get(item.id) || item));
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", cancel);
    setInteractionCleanup(cancel);
  }

  function canvasPoint(event) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / scale, 0, pageWidth),
      y: clamp((event.clientY - rect.top) / scale, 0, pageHeight)
    };
  }

  function beginSelectionRect(event) {
    if (mode !== "edit" || event.target !== event.currentTarget) return;
    event.preventDefault();
    cleanupInteraction();
    setEditingTextId("");
    const canvas = event.currentTarget;
    const start = canvasPoint(event);
    let moved = false;
    setSelectedIds([]);
    setSelectionRect({ x: start.x, y: start.y, width: 0, height: 0 });

    function move(pointerEvent) {
      moved = true;
      const rect = canvas.getBoundingClientRect();
      const current = {
        x: clamp((pointerEvent.clientX - rect.left) / scale, 0, pageWidth),
        y: clamp((pointerEvent.clientY - rect.top) / scale, 0, pageHeight)
      };
      const nextRect = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y)
      };
      setSelectionRect(nextRect);
      const selected = draftItems
        .filter((item) => {
          const itemLeft = Number(item.x || 0);
          const itemTop = Number(item.y || 0);
          const itemRight = Number(item.x || 0) + Number(item.width || 0);
          const itemBottom = Number(item.y || 0) + Number(item.height || 0);
          const selectionRight = nextRect.x + nextRect.width;
          const selectionBottom = nextRect.y + nextRect.height;
          return (
            itemRight >= nextRect.x &&
            itemLeft <= selectionRight &&
            itemBottom >= nextRect.y &&
            itemTop <= selectionBottom
          );
        })
        .map((item) => item.id);
      setSelectedIds(selected);
    }

    function finish() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", cancel);
      interactionCleanupRef.current = null;
      setSelectionRect(null);
      if (!moved) {
        setSelectedIds([]);
      }
    }

    function cancel() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", cancel);
      interactionCleanupRef.current = null;
      setSelectionRect(null);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", cancel);
    setInteractionCleanup(cancel);
  }

  function openViewer(entry) {
    if (mode !== "preview" || entry.element_type === "text") return;
    const image = resolveAlbumPlacementImage(entry);
    if (localStorage.getItem("archiveDebugMedia") === "1") {
      console.log("[media] album preview placement click", {
        previewStyle: cleanPreview ? "Clean" : "Designed",
        placementId: entry.id,
        itemId: entry.item_id,
        imageId: entry.image_id || entry.imageId || entry.selected_image_id || image?.id,
        placementKeys: Object.keys(entry || {}),
        placementThumbnail: entry.thumbnailUrl || entry.thumbnail_url || entry.cover?.thumbnailUrl,
        placementUrl: entry.url || entry.full_url || entry.cover?.url,
        imagesCount: entry.images?.length || 0,
        resolvedImage: image,
        url: image?.url,
        thumbnailUrl: image?.thumbnailUrl,
        urlLooksUsable: Boolean(image?.url || image?.thumbnailUrl)
      });
      if (image?.url) {
        fetch(image.url)
          .then((response) => console.log("[media] album preview full image fetch", {
            placementId: entry.id,
            imageId: entry.image_id || entry.imageId || entry.selected_image_id || image?.id,
            url: image.url,
            ok: response.ok,
            status: response.status
          }))
          .catch((error) => console.warn("[media] album preview full image fetch failed", {
            placementId: entry.id,
            url: image.url,
            message: error.message
          }));
      }
    }
    if (!image) return;
    const nextIndex = viewerImages.findIndex((image) => image.slotId === entry.id);
    if (nextIndex > -1) setViewerIndex(nextIndex);
  }

  async function applyTemplate(templateName) {
    if (draftItems.length > 0 && !window.confirm("Apply this template to the current page and reposition existing placements?")) return;
    pushHistory();
    const nextItems = templateLayout(templateName, draftItems, page);
    setDraftItems(nextItems);
    await onUpdatePage({ ...page, template_name: templateName });
    await Promise.all(nextItems.map((entry) => onUpdatePageItem(entry)));
  }

  async function applyPaperPreset(presetName) {
    const preset = PAPER_PRESETS[presetName] || PAPER_PRESETS.custom;
    const nextWidth = preset.width || pageWidth;
    const nextHeight = preset.height || pageHeight;
    const hasContent = draftItems.length > 0;
    const scaleContent = hasContent
      ? window.confirm("Change page size? Choose OK to scale placements proportionally, or Cancel to keep positions and sizes as-is.")
      : false;
    const widthRatio = nextWidth / pageWidth;
    const heightRatio = nextHeight / pageHeight;
    const nextPage = {
      ...page,
      paper_preset: presetName,
      page_width: nextWidth,
      page_height: nextHeight,
      orientation: preset.orientation || (nextWidth >= nextHeight ? "landscape" : "portrait")
    };
    await onUpdatePage(nextPage);
    if (scaleContent) {
      const scaled = draftItems.map((entry) => ({
        ...entry,
        x: Number(entry.x || 0) * widthRatio,
        y: Number(entry.y || 0) * heightRatio,
        width: Number(entry.width || 1) * widthRatio,
        height: Number(entry.height || 1) * heightRatio
      }));
      await commitEntries(scaled, true);
    }
  }

  async function updateLayer(entryOrEntries, action) {
    const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
    const zValues = draftItems.map((item) => Number(item.z_index || 0));
    const minZ = Math.min(...zValues, 0);
    const maxZ = Math.max(...zValues, 0);
    const nextEntries = entries.map((entry, index) => {
      if (action === "front") return { ...entry, z_index: maxZ + index + 1 };
      if (action === "back") return { ...entry, z_index: minZ - entries.length + index };
      if (action === "forward") return { ...entry, z_index: Number(entry.z_index || 0) + 1 };
      if (action === "backward") return { ...entry, z_index: Number(entry.z_index || 0) - 1 };
      return entry;
    });
    await commitEntries(nextEntries, true);
  }

  async function duplicatePlacement(entry) {
    pushHistory();
    if (entry.element_type === "text") {
      await onAddTextToPage({
        page_id: page.id,
        x: clamp(Number(entry.x || 0) + 24, 0, pageWidth - Number(entry.width || 100)),
        y: clamp(Number(entry.y || 0) + 24, 0, pageHeight - Number(entry.height || 100)),
        width: entry.width,
        height: entry.height,
        rotation: entry.rotation,
        z_index: Math.max(...draftItems.map((item) => Number(item.z_index || 0)), 0) + 1,
        text_content: entry.text_content,
        font_size: entry.font_size,
        bold: entry.bold,
        italic: entry.italic,
        text_align: entry.text_align,
        text_color: entry.text_color,
        background: entry.background,
        ...copyTextStyleFields(entry),
        locked: entry.locked
      });
      return;
    }
    await onAddItemToPage({
      page_id: page.id,
      item_id: entry.item_id,
      image_id: entry.image_id || entry.cover?.id || null,
      x: clamp(Number(entry.x || 0) + 24, 0, pageWidth - Number(entry.width || 100)),
      y: clamp(Number(entry.y || 0) + 24, 0, pageHeight - Number(entry.height || 100)),
      width: entry.width,
      height: entry.height,
      rotation: entry.rotation,
      z_index: Math.max(...draftItems.map((item) => Number(item.z_index || 0)), 0) + 1,
      caption: entry.caption,
      show_caption: entry.show_caption,
      show_title: entry.show_title,
      show_metadata: entry.show_metadata,
      locked: entry.locked,
      ...copyFrameFields(entry)
    });
  }

  return (
    <article className={`album-page canvas-page album-page-${mode} ${cleanPreview ? "clean-preview image-only-preview" : ""}`}>
      <header>
        <span>Page {page.page_number}</span>
        <h2>{page.title}</h2>
      </header>
      {mode === "edit" && (
        <div className="album-editor-tools">
          <PageActionBar
            onAddItem={() => onOpenItemPicker(page.id)}
            onAddText={() => onAddTextToPage({ page_id: page.id })}
            onZoomOut={() => setEditorZoom((current) => clamp(current / 1.18, MIN_EDITOR_ZOOM, MAX_EDITOR_ZOOM))}
            onZoomIn={() => setEditorZoom((current) => clamp(current * 1.18, MIN_EDITOR_ZOOM, MAX_EDITOR_ZOOM))}
            onFitPage={() => fitPage("button")}
            onActualSize={() => setEditorZoom(1)}
            onSavePage={() => (pageSettingsSaveRef.current ? pageSettingsSaveRef.current() : onUpdatePage(page))}
            onDeletePage={() => onDeletePage(page.id)}
            onUndo={undo}
            onRedo={redo}
            canUndo={history.length > 0}
            canRedo={future.length > 0}
          />
          <p className="editor-zoom-tip">Tip: Ctrl + mouse wheel to zoom</p>
        </div>
      )}
      <div className={mode === "edit" ? "album-editor-layout with-inspector" : "album-preview-layout"}>
        <div className={mode === "edit" ? "album-canvas-wrap" : "album-preview-wrap"} ref={canvasViewportRef}>
          <div
            className={`album-canvas-shell ${page.show_guides && mode === "edit" ? "show-guides" : ""}`}
            style={{
              width: pageWidth * scale,
              height: pageHeight * scale,
              "--page-scale": scale,
              "--page-width": `${pageWidth}px`,
              "--page-height": `${pageHeight}px`,
              "--grid-size": `${Number(page.grid_size || 25)}px`
            }}
          >
            <div
              className="album-canvas"
              style={{ width: pageWidth, height: pageHeight, background: pageBackground(page) }}
              onPointerDown={beginSelectionRect}
            >
              {page.background_image_enabled && page.background_image && (
                <PageBackgroundImage page={page} />
              )}
              {sortedItems.map((entry) => (
                <div
                  className={`album-placement ${entry.element_type === "text" ? "text-placement" : ""} ${mode === "edit" && selectedIds.includes(entry.id) ? "selected" : ""} ${mode === "edit" ? "editable" : ""}`}
                  key={entry.id}
                  data-placement-id={entry.id}
                  style={{
                    left: entry.x,
                    top: entry.y,
                    width: entry.width,
                    height: entry.height,
                    zIndex: Number(entry.z_index || 0),
                    transform: `rotate(${Number(entry.rotation || 0)}deg)`,
                    ...placementFrameStyle(entry)
                  }}
                  onPointerDown={(event) => {
                    if (mode === "edit") beginPointer(event, entry, "move");
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (mode === "edit") {
                      selectEntry(entry.id, event);
                    }
                  }}
                >
                  {entry.element_type === "text" ? (
                    editingTextId === entry.id && mode === "edit" ? (
                      <textarea
                        className="album-text-content album-text-editor"
                        data-input-debug="Album text box"
                        ref={(node) => {
                          if (node) {
                            textEditRefs.current.set(entry.id, node);
                            if (editingTextId === entry.id) {
                              window.setTimeout(() => node.focus({ preventScroll: true }), 0);
                            }
                          } else {
                            textEditRefs.current.delete(entry.id);
                          }
                        }}
                        autoFocus
                        defaultValue={entry.text_content || "Album text"}
                        aria-label="Album text box"
                        style={{
                          ...textBoxStyle(entry)
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onInput={(event) => {
                          const textContent = event.currentTarget.value || "";
                          updateDraft({ ...entry, text_content: textContent });
                          scheduleTextCommit(entry, textContent);
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Escape") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        onBlur={(event) => {
                          const textContent = event.currentTarget.value || "";
                          setEditingTextId("");
                          flushTextCommit(entry, textContent);
                        }}
                      />
                    ) : (
                      <div
                        className="album-text-content"
                        ref={(node) => {
                          if (node) textEditRefs.current.set(entry.id, node);
                          else textEditRefs.current.delete(entry.id);
                        }}
                        role={mode === "edit" ? "textbox" : undefined}
                        aria-label="Album text box"
                        tabIndex={mode === "edit" ? 0 : undefined}
                        style={{
                          ...textBoxStyle(entry)
                        }}
                        onClick={(event) => {
                          if (mode !== "edit") return;
                          event.stopPropagation();
                          selectEntry(entry.id, event);
                        }}
                        onDoubleClick={(event) => {
                          if (mode !== "edit") return;
                          event.preventDefault();
                          event.stopPropagation();
                          cleanupInteraction();
                          selectEntry(entry.id, event);
                          setEditingTextId(entry.id);
                          focusTextEditor(entry.id);
                        }}
                      >
                        {entry.text_content || "Album text"}
                      </div>
                    )
                  ) : (
                    <>
                      <button className="placement-image-button" type="button" onClick={() => openViewer(entry)}>
                        <PlacementImage entry={entry} src={entry.cover?.thumbnailUrl || entry.cover?.url} alt={entry.title} context={`Album placement: ${entry.title}`} />
                      </button>
                      {!cleanPreview && (entry.show_title || entry.show_caption || entry.show_metadata) && (
                        <div className="placement-text">
                          {entry.show_title && <strong>{entry.title}</strong>}
                          {entry.show_caption && entry.caption && <span>{entry.caption}</span>}
                          {entry.show_metadata && <span>{[entry.country_name, entry.year].filter(Boolean).join(" / ")}</span>}
                        </div>
                      )}
                    </>
                  )}
                  {mode === "edit" && selectedIds.includes(entry.id) && (
                    <>
                      <button className="resize-handle corner-se" type="button" aria-label="Resize placement" onPointerDown={(event) => beginPointer(event, entry, "resize")} />
                      <span className="resize-corner corner-nw" />
                      <span className="resize-corner corner-ne" />
                      <span className="resize-corner corner-sw" />
                    </>
                  )}
                </div>
              ))}
              {selectionRect && (
                <div
                  className="selection-rect"
                  style={{
                    left: selectionRect.x,
                    top: selectionRect.y,
                    width: selectionRect.width,
                    height: selectionRect.height
                  }}
                />
              )}
            </div>
          </div>
        </div>
        {mode === "edit" && (
          <aside className="placement-inspector-panel" onPointerDown={(event) => event.stopPropagation()}>
            {selectedEntries.length > 1 ? (
              <MultiPlacementInspector
                entries={selectedEntries}
                saveStatus={saveStatus}
                onUpdateMany={(nextEntries) => commitEntries(nextEntries, true)}
                onLayer={(action) => updateLayer(selectedEntries, action)}
                onRemove={async () => {
                  if (!window.confirm(`Remove ${selectedEntries.length} selected placements? This will not delete the underlying collectible items.`)) return;
                  pushHistory();
                  await Promise.all(selectedEntries.map((entry) => onRemoveItemFromPage(entry.id)));
                  setSelectedIds([]);
                }}
              />
            ) : selectedEntry ? (
              <PlacementInspector
                entry={selectedEntry}
                page={page}
                saveStatus={saveStatus}
                onUpdate={(nextEntry) => commitEntry(nextEntry, true)}
                onLayer={updateLayer}
                onDuplicate={duplicatePlacement}
                onRemove={async (entry) => {
                  if (!window.confirm("Remove this placement from the album page?")) return;
                  pushHistory();
                  await onRemoveItemFromPage(entry.id);
                  setSelectedIds([]);
                }}
              />
            ) : (
              <PageSettingsPanel
                page={page}
                onRegisterSave={(save) => {
                  pageSettingsSaveRef.current = save;
                }}
                onApplyTemplate={applyTemplate}
                onUpdatePage={onUpdatePage}
                onPickBackground={() => onPickBackground(page.id)}
                onApplyPaperPreset={applyPaperPreset}
              />
            )}
          </aside>
        )}
      </div>
      {viewerIndex !== null && viewerImages[viewerIndex] && (
        <ImageViewer
          images={viewerImages}
          initialIndex={viewerIndex}
          title={viewerImages[viewerIndex].title}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </article>
  );
}

function AlbumSlotImageSelect({ entry, onUpdate }) {
  const images = entry.images || [];
  if (images.length < 2) return null;

  return (
    <label className="slot-image-select">
      Image
      <select
        value={entry.image_id || ""}
        onChange={(event) => onUpdate({ ...entry, image_id: event.target.value || null })}
      >
        <option value="">Primary / first image</option>
        {images.map((image, index) => (
          <option value={image.id} key={image.id}>
            {`Image ${index + 1}${image.original_filename ? ` - ${image.original_filename}` : ""}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckRow({ checked, label, title, onChange }) {
  return (
    <label className="check-row" title={title}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function FrameStyleControls({ entry, onChange, compact = false }) {
  const frameStyle = normalizedFrameStyle(entry);
  const backgroundOpacity = Math.round(Number(entry.background_opacity ?? 0) * 100);
  return (
    <div className={`frame-style-fields ${compact ? "compact" : ""}`}>
      <label>Frame style
        <select value={frameStyle} onChange={(event) => onChange({ frame_style: event.target.value })}>
          <option value="none">None / transparent</option>
          <option value="thin">Thin border</option>
          <option value="light">Light card</option>
          <option value="shadow">Shadow card</option>
        </select>
      </label>
      <div className="style-field-grid">
        <label>Border<input type="color" value={entry.border_color || "#b8c8c4"} onChange={(event) => onChange({ border_color: event.target.value })} /></label>
        <label>Background<input type="color" value={entry.background_color || "#ffffff"} onChange={(event) => onChange({ background_color: event.target.value })} /></label>
      </div>
      <label className="editor-number">Opacity <span>{backgroundOpacity}%</span><input type="range" min="0" max="100" value={backgroundOpacity} onChange={(event) => onChange({ background_opacity: Number(event.target.value) / 100 })} /></label>
      <div className="style-field-grid">
        <label>Padding<input type="number" min="0" max="80" value={Number(entry.padding ?? 4)} onChange={(event) => onChange({ padding: Number(event.target.value || 0) })} /></label>
        <label>Radius<input type="number" min="0" max="80" value={Number(entry.border_radius ?? 2)} onChange={(event) => onChange({ border_radius: Number(event.target.value || 0) })} /></label>
      </div>
    </div>
  );
}

function PlacementInspector({ entry, page, saveStatus, onUpdate, onLayer, onDuplicate, onRemove }) {
  const { t } = useI18n();
  const [caption, setCaption] = useState(entry.caption || "");
  const [textContent, setTextContent] = useState(entry.text_content || "");
  const [sizeMm, setSizeMm] = useState(() => {
    const initialMm = placementPxToMm(page, entry);
    return {
      width: Number(initialMm.widthMm.toFixed(2)),
      height: Number(initialMm.heightMm.toFixed(2))
    };
  });
  const [cropDraft, setCropDraft] = useState(() => {
    const crop = cropValues(entry);
    return {
      left: Number((crop.left * 100).toFixed(1)),
      right: Number((crop.right * 100).toFixed(1)),
      top: Number((crop.top * 100).toFixed(1)),
      bottom: Number((crop.bottom * 100).toFixed(1))
    };
  });

  useEffect(() => {
    setCaption(entry.caption || "");
    setTextContent(entry.text_content || "");
    const nextMm = placementPxToMm(page, entry);
    setSizeMm({
      width: Number(nextMm.widthMm.toFixed(2)),
      height: Number(nextMm.heightMm.toFixed(2))
    });
    const nextCrop = cropValues(entry);
    setCropDraft({
      left: Number((nextCrop.left * 100).toFixed(1)),
      right: Number((nextCrop.right * 100).toFixed(1)),
      top: Number((nextCrop.top * 100).toFixed(1)),
      bottom: Number((nextCrop.bottom * 100).toFixed(1))
    });
  }, [entry.id, entry.caption, entry.text_content, entry.width, entry.height, entry.crop_left, entry.crop_right, entry.crop_top, entry.crop_bottom, page.page_width, page.page_height, page.paper_preset]);

  const isText = entry.element_type === "text";

  function applyPhysicalSize() {
    const widthMm = Math.max(0.1, Number(sizeMm.width || 0));
    let heightMm = Math.max(0.1, Number(sizeMm.height || 0));
    const nextSize = placementMmToPx(page, widthMm, heightMm);
    if (entry.locked) {
      const aspect = visibleCropAspectRatio(entry);
      nextSize.height = nextSize.width / Math.max(0.05, aspect);
      heightMm = pagePxToMm(page, nextSize.height, "y");
      setSizeMm({ width: Number(widthMm.toFixed(2)), height: Number(heightMm.toFixed(2)) });
    }
    onUpdate({ ...entry, width: nextSize.width, height: nextSize.height });
  }

  function updateCrop(key, value) {
    setCropDraft((current) => {
      const next = {
        ...current,
        [key]: Number(value || 0)
      };
      window.queueMicrotask(() => {
        onUpdate({
          ...entry,
          crop_left: cropValue(next.left / 100),
          crop_right: cropValue(next.right / 100),
          crop_top: cropValue(next.top / 100),
          crop_bottom: cropValue(next.bottom / 100)
        });
      });
      return next;
    });
  }

  return (
    <div className="placement-inspector">
      <header>
        <div className="inspector-thumb">
          {isText ? <div className="text-thumb">Text</div> : entry.cover ? <MediaImage src={entry.cover.thumbnailUrl} alt={entry.title} context={`Inspector: ${entry.title}`} /> : <div className="image-placeholder">No image</div>}
        </div>
        <div>
          <strong>{isText ? "Text box" : entry.title}</strong>
          <span>{Math.round(entry.x)}, {Math.round(entry.y)} / {Math.round(entry.width)} x {Math.round(entry.height)}</span>
          <small>{saveStatus}</small>
        </div>
      </header>
      <div className="inspector-fields inspector-sections">
        {isText ? (
          <>
            <section className="inspector-section">
              <h3>{t("selectedObject")}</h3>
              <label>Text<textarea value={textContent} onChange={(event) => setTextContent(event.target.value)} onBlur={() => onUpdate({ ...entry, text_content: textContent })} /></label>
              <CheckRow checked={Boolean(entry.locked)} label="Lock ratio" onChange={(checked) => onUpdate({ ...entry, locked: checked })} />
            </section>
            <section className="inspector-section">
              <h3>{t("textStyle")}</h3>
              <label>{t("font")}
                <select value={entry.font_family || "system"} onChange={(event) => onUpdate({ ...entry, font_family: event.target.value })}>
                  {TEXT_FONT_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label || t(option.labelKey)}</option>
                  ))}
                </select>
              </label>
              <div className="style-field-grid">
                <label>{t("size")}<input type="number" min="8" max="96" value={Number(entry.font_size || 24)} onChange={(event) => onUpdate({ ...entry, font_size: Number(event.target.value || 24) })} /></label>
                <label>{t("lineHeight")}<input type="number" min="0.8" max="3" step="0.05" value={Number(entry.line_height || 1.25)} onChange={(event) => onUpdate({ ...entry, line_height: Number(event.target.value || 1.25) })} /></label>
              </div>
              <label>{t("alignment")}<select value={entry.text_align || "center"} onChange={(event) => onUpdate({ ...entry, text_align: event.target.value })}><option value="left">{t("left")}</option><option value="center">{t("center")}</option><option value="right">{t("right")}</option></select></label>
              <div className="style-field-grid">
                <label>{t("textColor")}<input type="color" value={entry.text_color || "#202629"} onChange={(event) => onUpdate({ ...entry, text_color: event.target.value })} /></label>
                <label>{t("background")}<input type="color" value={entry.background_color || "#ffffff"} onChange={(event) => onUpdate({ ...entry, background: "color", background_color: event.target.value })} /></label>
              </div>
              <CheckRow checked={(entry.background || "transparent") === "transparent"} label={t("transparent")} onChange={(checked) => onUpdate({ ...entry, background: checked ? "transparent" : "color", background_opacity: checked ? 0 : Number(entry.background_opacity ?? 1) })} />
              {(entry.background || "transparent") !== "transparent" && (
                <label className="editor-number">{t("opacity")} <span>{Math.round(Number(entry.background_opacity ?? 1) * 100)}%</span><input type="range" min="0" max="100" value={Math.round(Number(entry.background_opacity ?? 1) * 100)} onChange={(event) => onUpdate({ ...entry, background: "color", background_opacity: Number(event.target.value) / 100 })} /></label>
              )}
              <div className="style-field-grid">
                <label>{t("border")}<input type="color" value={entry.border_color || "#202629"} onChange={(event) => onUpdate({ ...entry, border_color: event.target.value })} /></label>
                <label>{t("border")} {t("size")}<input type="number" min="0" max="24" step="0.5" value={Number(entry.border_width || 0)} onChange={(event) => onUpdate({ ...entry, border_width: Number(event.target.value || 0) })} /></label>
                <label>{t("radius")}<input type="number" min="0" max="80" value={Number(entry.border_radius || 0)} onChange={(event) => onUpdate({ ...entry, border_radius: Number(event.target.value || 0) })} /></label>
                <label>{t("padding")}<input type="number" min="0" max="80" value={Number(entry.padding ?? 8)} onChange={(event) => onUpdate({ ...entry, padding: Number(event.target.value || 0) })} /></label>
              </div>
              <div className="style-toggle-row">
                <CheckRow checked={Boolean(entry.bold)} label={t("bold")} onChange={(checked) => onUpdate({ ...entry, bold: checked })} />
                <CheckRow checked={Boolean(entry.italic)} label={t("italic")} onChange={(checked) => onUpdate({ ...entry, italic: checked })} />
                <CheckRow checked={Boolean(entry.underline)} label={t("underline")} onChange={(checked) => onUpdate({ ...entry, underline: checked })} />
              </div>
            </section>
          </>
        ) : (
          <section className="inspector-section">
            <h3>{t("selectedObject")}</h3>
            <AlbumSlotImageSelect entry={entry} onUpdate={onUpdate} />
            <label>Caption<input value={caption} onChange={(event) => setCaption(event.target.value)} onBlur={() => onUpdate({ ...entry, caption })} /></label>
            <CheckRow checked={Boolean(entry.show_title)} label="Show title" onChange={(checked) => onUpdate({ ...entry, show_title: checked })} />
            <CheckRow checked={Boolean(entry.show_caption)} label="Show caption" onChange={(checked) => onUpdate({ ...entry, show_caption: checked })} />
            <CheckRow checked={Boolean(entry.show_metadata)} label="Show item info" title="Show or hide issuing entity, type, and year for this placement." onChange={(checked) => onUpdate({ ...entry, show_metadata: checked })} />
          </section>
        )}
        {!isText && (
          <>
            <section className="inspector-section">
              <h3>{t("physicalSize")}</h3>
              <div className="style-field-grid">
                <label>{t("widthMm")}<input type="number" min="0.1" step="0.1" value={sizeMm.width} onChange={(event) => setSizeMm((current) => ({ ...current, width: event.target.value }))} /></label>
                <label>{t("heightMm")}<input type="number" min="0.1" step="0.1" value={sizeMm.height} onChange={(event) => setSizeMm((current) => ({ ...current, height: event.target.value }))} /></label>
              </div>
              <CheckRow checked={Boolean(entry.locked)} label="Lock ratio" onChange={(checked) => onUpdate({ ...entry, locked: checked })} />
              <button type="button" className="secondary" onClick={applyPhysicalSize}>{t("applySize")}</button>
            </section>
            <section className="inspector-section">
              <h3>{t("crop")}</h3>
              <small className="helper-text">{t("cropHelp")}</small>
              <div className="style-field-grid crop-field-grid">
                <label>{t("cropLeft")} %<input type="number" min="0" max="50" step="0.5" value={cropDraft.left} onChange={(event) => updateCrop("left", event.target.value)} /></label>
                <label>{t("cropRight")} %<input type="number" min="0" max="50" step="0.5" value={cropDraft.right} onChange={(event) => updateCrop("right", event.target.value)} /></label>
                <label>{t("cropTop")} %<input type="number" min="0" max="50" step="0.5" value={cropDraft.top} onChange={(event) => updateCrop("top", event.target.value)} /></label>
                <label>{t("cropBottom")} %<input type="number" min="0" max="50" step="0.5" value={cropDraft.bottom} onChange={(event) => updateCrop("bottom", event.target.value)} /></label>
              </div>
              <button type="button" className="ghost" onClick={() => onUpdate({ ...entry, crop_left: 0, crop_right: 0, crop_top: 0, crop_bottom: 0 })}>{t("resetCrop")}</button>
            </section>
          </>
        )}
        {!isText && (
          <section className="inspector-section">
            <h3>{t("frame")}</h3>
            <FrameStyleControls entry={entry} onChange={(changes) => onUpdate({ ...entry, ...changes })} />
          </section>
        )}
      </div>
      <div className="placement-actions">
        <button type="button" title="Move selected placement up one layer" onClick={() => onLayer(entry, "forward")}>Forward</button>
        <button type="button" title="Move selected placement down one layer" onClick={() => onLayer(entry, "backward")}>Backward</button>
        <button type="button" title="Put selected placement above all other placements" onClick={() => onLayer(entry, "front")}>To front</button>
        <button type="button" title="Put selected placement behind all other placements" onClick={() => onLayer(entry, "back")}>To back</button>
        <button type="button" onClick={() => onDuplicate(entry)}>Duplicate</button>
        <button type="button" className="danger" onClick={() => onRemove(entry)}>Delete placement</button>
      </div>
    </div>
  );
}

function MultiPlacementInspector({ entries, saveStatus, onUpdateMany, onLayer, onRemove }) {
  function align(kind) {
    const left = Math.min(...entries.map((entry) => Number(entry.x || 0)));
    const right = Math.max(...entries.map((entry) => Number(entry.x || 0) + Number(entry.width || 0)));
    const top = Math.min(...entries.map((entry) => Number(entry.y || 0)));
    const bottom = Math.max(...entries.map((entry) => Number(entry.y || 0) + Number(entry.height || 0)));
    const centerX = left + (right - left) / 2;
    const centerY = top + (bottom - top) / 2;
    onUpdateMany(entries.map((entry) => {
      if (kind === "left") return { ...entry, x: left };
      if (kind === "right") return { ...entry, x: right - Number(entry.width || 0) };
      if (kind === "top") return { ...entry, y: top };
      if (kind === "bottom") return { ...entry, y: bottom - Number(entry.height || 0) };
      if (kind === "hcenter") return { ...entry, x: centerX - Number(entry.width || 0) / 2 };
      if (kind === "vcenter") return { ...entry, y: centerY - Number(entry.height || 0) / 2 };
      return entry;
    }));
  }

  function distribute(axis) {
    if (entries.length < 3) return;
    const key = axis === "horizontal" ? "x" : "y";
    const size = axis === "horizontal" ? "width" : "height";
    const sorted = [...entries].sort((a, b) => Number(a[key] || 0) - Number(b[key] || 0));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const start = Number(first[key] || 0);
    const end = Number(last[key] || 0) + Number(last[size] || 0);
    const totalSize = sorted.reduce((sum, entry) => sum + Number(entry[size] || 0), 0);
    const gap = Math.max(0, (end - start - totalSize) / (sorted.length - 1));
    let cursor = start;
    const nextById = new Map();
    sorted.forEach((entry) => {
      nextById.set(entry.id, { ...entry, [key]: cursor });
      cursor += Number(entry[size] || 0) + gap;
    });
    onUpdateMany(entries.map((entry) => nextById.get(entry.id) || entry));
  }

  function toggle(field, value) {
    onUpdateMany(entries.map((entry) => ({ ...entry, [field]: value })));
  }

  function updateImageFrames(changes) {
    onUpdateMany(entries.map((entry) => (entry.element_type === "text" ? entry : { ...entry, ...changes })));
  }

  const allLocked = entries.every((entry) => Boolean(entry.locked));
  const imageEntries = entries.filter((entry) => entry.element_type !== "text");
  const allShowTitle = imageEntries.length > 0 && imageEntries.every((entry) => Boolean(entry.show_title));
  const allShowCaption = imageEntries.length > 0 && imageEntries.every((entry) => Boolean(entry.show_caption));
  const allShowInfo = imageEntries.length > 0 && imageEntries.every((entry) => Boolean(entry.show_metadata));

  return (
    <div className="placement-inspector multi-inspector">
      <header className="multi-header">
        <div>
          <strong>{entries.length} placements selected</strong>
          <span>{saveStatus}</span>
        </div>
      </header>
      <div className="placement-actions">
        <button type="button" onClick={() => align("left")}>Align left</button>
        <button type="button" onClick={() => align("right")}>Align right</button>
        <button type="button" onClick={() => align("top")}>Align top</button>
        <button type="button" onClick={() => align("bottom")}>Align bottom</button>
        <button type="button" onClick={() => align("hcenter")}>Center H</button>
        <button type="button" onClick={() => align("vcenter")}>Center V</button>
        <button type="button" disabled={entries.length < 3} onClick={() => distribute("horizontal")}>Distribute H</button>
        <button type="button" disabled={entries.length < 3} onClick={() => distribute("vertical")}>Distribute V</button>
      </div>
      <div className="placement-actions">
        <button type="button" title="Move selected placements up one layer" onClick={() => onLayer("forward")}>Forward</button>
        <button type="button" title="Move selected placements down one layer" onClick={() => onLayer("backward")}>Backward</button>
        <button type="button" title="Put selected placements above all other placements" onClick={() => onLayer("front")}>To front</button>
        <button type="button" title="Put selected placements behind all other placements" onClick={() => onLayer("back")}>To back</button>
      </div>
      <div className="inspector-fields">
        <CheckRow checked={allLocked} label="Lock ratio" onChange={(checked) => toggle("locked", checked)} />
        {imageEntries.length > 0 && (
          <>
            <CheckRow checked={allShowTitle} label="Show title" onChange={(checked) => toggle("show_title", checked)} />
            <CheckRow checked={allShowCaption} label="Show caption" onChange={(checked) => toggle("show_caption", checked)} />
            <CheckRow checked={allShowInfo} label="Show item info" title="Show or hide issuing entity, type, and year for selected placements." onChange={(checked) => toggle("show_metadata", checked)} />
            <FrameStyleControls entry={imageEntries[0]} compact onChange={updateImageFrames} />
          </>
        )}
      </div>
      <button type="button" className="danger" onClick={onRemove}>Delete selected placements</button>
    </div>
  );
}

function PdfQualitySelect({ value, onChange }) {
  const { t } = useI18n();
  const labels = {
    original: t("originalQuality"),
    high: t("highQuality"),
    medium: t("mediumQuality"),
    low: t("lowQuality")
  };
  return (
    <label className="pdf-quality-select">
      <span>{t("pdfQuality")}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {PDF_QUALITY_OPTIONS.map((option) => (
          <option value={option.value} key={option.value}>{labels[option.value] || option.label}</option>
        ))}
      </select>
    </label>
  );
}

function PageActionBar({ onAddItem, onAddText, onZoomOut, onZoomIn, onFitPage, onActualSize, onSavePage, onDeletePage, onUndo, onRedo, canUndo, canRedo }) {
  const { t } = useI18n();
  return (
    <div className="page-action-bar">
      <div className="toolbar-group">
        <button type="button" className="primary" onClick={onAddItem}>{t("addItem")}</button>
        <button type="button" className="primary" onClick={onAddText}>{t("addText")}</button>
      </div>
      <div className="toolbar-group">
        <button type="button" className="ghost" onClick={onZoomOut}>{t("zoomOut")}</button>
        <button type="button" className="ghost" onClick={onZoomIn}>{t("zoomIn")}</button>
        <button type="button" className="ghost" onClick={onFitPage}>{t("fitPage")}</button>
        <button type="button" className="ghost" onClick={onActualSize}>{t("actualSize")}</button>
      </div>
      <div className="toolbar-group">
        <button type="button" className="secondary" onClick={onSavePage}>{t("savePage")}</button>
        <button type="button" className="danger" onClick={onDeletePage}>{t("deletePage")}</button>
      </div>
      <div className="toolbar-group">
        <button type="button" className="ghost" disabled={!canUndo} onClick={onUndo}>{t("undo")}</button>
        <button type="button" className="ghost" disabled={!canRedo} onClick={onRedo}>{t("redo")}</button>
      </div>
    </div>
  );
}

function PageSettingsPanel({ page, onRegisterSave, onApplyTemplate, onUpdatePage, onPickBackground, onApplyPaperPreset }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(page.title || "");
  const [paperPreset, setPaperPreset] = useState(() => pagePaperPreset(page));
  const [customWidth, setCustomWidth] = useState(logicalPageSize(page).width);
  const [customHeight, setCustomHeight] = useState(logicalPageSize(page).height);
  const [background, setBackground] = useState(page.background || "white");
  const [customBackground, setCustomBackground] = useState(page.custom_background || "#ffffff");
  const [backgroundImageEnabled, setBackgroundImageEnabled] = useState(Boolean(page.background_image_enabled));
  const [backgroundOpacity, setBackgroundOpacity] = useState(Math.round(Number(page.background_opacity ?? 1) * 100));
  const [backgroundFit, setBackgroundFit] = useState(page.background_fit || "contain");
  const [showGuides, setShowGuides] = useState(Boolean(page.show_guides));
  const [snapToGrid, setSnapToGrid] = useState(Boolean(page.snap_to_grid));
  const [gridSize, setGridSize] = useState(Number(page.grid_size || 25));
  const [templateName, setTemplateName] = useState(page.template_name || "blank");

  useEffect(() => {
    const nextSize = logicalPageSize(page);
    setTitle(page.title || "");
    setPaperPreset(pagePaperPreset(page));
    setCustomWidth(nextSize.width);
    setCustomHeight(nextSize.height);
    setBackground(page.background || "white");
    setCustomBackground(page.custom_background || "#ffffff");
    setBackgroundImageEnabled(Boolean(page.background_image_enabled));
    setBackgroundOpacity(Math.round(Number(page.background_opacity ?? 1) * 100));
    setBackgroundFit(page.background_fit || "contain");
    setShowGuides(Boolean(page.show_guides));
    setSnapToGrid(Boolean(page.snap_to_grid));
    setGridSize(Number(page.grid_size || 25));
    setTemplateName(page.template_name || "blank");
  }, [page]);

  function savePage() {
    const preset = PAPER_PRESETS[paperPreset] || PAPER_PRESETS.custom;
    const width = paperPreset === "custom" ? Math.max(100, Number(customWidth || page.page_width || 1000)) : preset.width;
    const height = paperPreset === "custom" ? Math.max(100, Number(customHeight || page.page_height || 1400)) : preset.height;
    onUpdatePage({
      ...page,
      title,
      paper_preset: paperPreset,
      page_width: width,
      page_height: height,
      orientation: width > height ? "landscape" : "portrait",
      background,
      custom_background: customBackground,
      background_image_enabled: backgroundImageEnabled,
      background_opacity: backgroundOpacity / 100,
      background_fit: backgroundFit,
      show_guides: showGuides,
      snap_to_grid: snapToGrid,
      grid_size: gridSize,
      template_name: templateName
    });
  }

  useEffect(() => {
    onRegisterSave?.(savePage);
    return () => onRegisterSave?.(null);
  });

  const hasBackgroundImage = Boolean(page.background_image_id || page.background_image);

  return (
    <div className="page-settings-panel placement-inspector">
      <header className="settings-header">
        <div>
          <strong>{t("pageSettings")}</strong>
          <span>{t("page")} {page.page_number}</span>
        </div>
      </header>
      <div className="inspector-fields inspector-sections">
        <section className="inspector-section">
          <h3>{t("page")}</h3>
          <label>{t("pageTitle")}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>{t("paperSize")}
            <select
              value={paperPreset}
              onChange={(event) => {
                const value = event.target.value;
                setPaperPreset(value);
                if (value === "custom") {
                  const nextSize = logicalPageSize(page);
                  setCustomWidth(nextSize.width);
                  setCustomHeight(nextSize.height);
                } else {
                  onApplyPaperPreset(value);
                }
              }}
            >
              {Object.entries(PAPER_PRESETS).map(([key, preset]) => (
                <option value={key} key={key}>{preset.label}</option>
              ))}
            </select>
          </label>
          {paperPreset === "custom" && (
            <div className="custom-paper-size">
              <label>Custom width<input type="number" min="100" max="5000" value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} /></label>
              <label>Custom height<input type="number" min="100" max="5000" value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} /></label>
            </div>
          )}
        </section>
        <section className="inspector-section">
          <h3>{t("background")}</h3>
          <label>{t("backgroundColor")}
            <select value={background} onChange={(event) => setBackground(event.target.value)}>
              <option value="white">White</option>
              <option value="cream">Cream</option>
              <option value="light gray">Light gray</option>
              <option value="black">Black</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {background === "custom" && <label>Custom color<input type="color" value={customBackground} onChange={(event) => setCustomBackground(event.target.value)} /></label>}
          <div className="background-controls">
            <button type="button" className="secondary" onClick={onPickBackground}>{t("setBackgroundImage")}</button>
            <button
              type="button"
              className="ghost"
              disabled={!hasBackgroundImage}
              onClick={() => {
                setBackgroundImageEnabled(false);
                onUpdatePage({ ...page, background_image_id: null, background_image_enabled: false });
              }}
            >
              {t("clearBackground")}
            </button>
          </div>
          {hasBackgroundImage && (
            <CheckRow
              checked={backgroundImageEnabled}
              label={t("showBackgroundImage")}
              onChange={(checked) => setBackgroundImageEnabled(checked)}
            />
          )}
          <label className="editor-number">{t("opacity")} <span>{backgroundOpacity}%</span><input type="range" min="0" max="100" value={backgroundOpacity} onChange={(event) => setBackgroundOpacity(Number(event.target.value))} /></label>
          <label>{t("backgroundFit")}
            <select value={backgroundFit} onChange={(event) => setBackgroundFit(event.target.value)}>
              <option value="contain" title="Show the whole background image without cropping.">Contain</option>
              <option value="cover" title="Fill the page, cropping edges if needed.">Cover</option>
              <option value="stretch" title="Stretch to page size; may distort.">Stretch</option>
              <option value="tile" title="Repeat the image as a pattern.">Tile</option>
            </select>
          </label>
          <small className="helper-text">{{
            contain: "Contain shows the whole background image without cropping.",
            cover: "Cover fills the page and may crop edges.",
            stretch: "Stretch fills the page but may distort the image.",
            tile: "Tile repeats the image as a pattern."
          }[backgroundFit] || ""}</small>
        </section>
        <section className="inspector-section">
          <h3>{t("grid")}</h3>
          <CheckRow checked={showGuides} label={t("showGuides")} title="Display alignment guides while editing the page." onChange={setShowGuides} />
          <CheckRow checked={snapToGrid} label={t("snapToGrid")} title="When moving or resizing items, align them to the grid." onChange={setSnapToGrid} />
          <label className="editor-number" title="Controls spacing of the snap grid; smaller values allow finer positioning.">{t("gridSize")}<input type="number" min="5" max="100" value={gridSize} onChange={(event) => setGridSize(Number(event.target.value))} /></label>
        </section>
        <section className="inspector-section">
          <h3>{t("template")}</h3>
          <label>{t("template")}
            <select value={templateName} onChange={(event) => setTemplateName(event.target.value)}>
              <option value="blank">Blank page</option>
              <option value="2-column">2-column</option>
              <option value="3-column">3-column</option>
              <option value="4-column">4-column</option>
              <option value="coin-tray">Coin tray</option>
              <option value="banknote-rows">Banknote rows</option>
            </select>
          </label>
        </section>
      </div>
      <div className="placement-actions">
        <button type="button" onClick={() => onApplyTemplate(templateName)}>{t("applyTemplate")}</button>
      </div>
    </div>
  );
}

function SearchableCombobox({
  rows,
  value,
  onChange,
  allLabel,
  searchPlaceholder,
  searchLabel,
  clearLabel,
  className = ""
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const orderedEntries = useMemo(() => orderedRows(rows), [rows]);
  const selected = orderedEntries.find((entry) => String(entry.id) === String(value));
  const normalizedQuery = query.trim().toLowerCase();
  const matches = orderedEntries.filter((entry) => !normalizedQuery || String(entry.name || "").toLowerCase().includes(normalizedQuery));
  const visibleMatches = matches.slice(0, 80);

  useEffect(() => {
    if (!open) return;
    setHighlighted(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  function selectEntry(entry) {
    onChange(entry.id);
    setQuery("");
    setOpen(false);
  }

  function clearSelection() {
    onChange("");
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, visibleMatches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (visibleMatches[highlighted]) selectEntry(visibleMatches[highlighted]);
    }
  }

  return (
    <div className={`entity-combobox ${className}`} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <div className="entity-combobox-value">
        <button type="button" className="entity-combobox-trigger" onClick={() => setOpen((current) => !current)} onKeyDown={handleKeyDown}>
          {selected ? selected.name : allLabel}
        </button>
        {selected && <button type="button" className="entity-combobox-clear" aria-label={clearLabel} onClick={clearSelection}>X</button>}
      </div>
      {open && (
        <div className="entity-combobox-panel">
          <input
            data-input-debug={searchLabel || searchPlaceholder || "Searchable combobox"}
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
          />
          <div className="entity-combobox-results" role="listbox">
            <button type="button" className={!value ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={clearSelection}>
              {allLabel}
            </button>
            {visibleMatches.map((entry, index) => (
              <button
                type="button"
                key={entry.id}
                className={`${String(entry.id) === String(value) ? "selected" : ""} ${index === highlighted ? "active" : ""}`}
                role="option"
                aria-selected={String(entry.id) === String(value)}
                title={entry.name}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => selectEntry(entry)}
              >
                {entry.name}
              </button>
            ))}
            {matches.length > visibleMatches.length && <p className="quiet">Showing first {visibleMatches.length} matches. Type to narrow results.</p>}
            {visibleMatches.length === 0 && <p className="quiet">No matching results</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function IssuingEntityCombobox({ countries, value, onChange }) {
  const { t } = useI18n();
  return (
    <SearchableCombobox
      rows={countries}
      value={value}
      onChange={onChange}
      allLabel={t("none")}
      searchPlaceholder={t("searchIssuingEntities")}
      searchLabel={t("searchIssuingEntities")}
      clearLabel={t("clearIssuingEntity")}
    />
  );
}

function ItemForm({ title, item, countries, types, onClose, onSubmit, onBulkCreate }) {
  const { t } = useI18n();
  const initialCustomFieldsText = customFieldsToText(item?.customFields);
  const [form, setForm] = useState(() => ({
    ...emptyItem,
    ...(item || {}),
    tags: item?.tags?.join(", ") || "",
    customFieldsText: initialCustomFieldsText
  }));
  const [customFieldsOpen, setCustomFieldsOpen] = useState(() => Boolean(initialCustomFieldsText.trim()));

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal wide"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            title: form.title,
            country_id: form.country_id,
            type_id: form.type_id,
            year: form.year,
            description: form.description,
            condition: form.condition,
            purchase_price: form.purchase_price,
            source: form.source,
            tags: form.tags,
            customFields: customFieldsFromText(form.customFieldsText),
            favorite: form.favorite
          });
        }}
      >
        <header>
          <h2>{title}</h2>
          <div className="modal-header-actions">
            <button
              type="button"
              className={`favorite form-favorite ${form.favorite ? "active" : ""}`}
              onClick={() => update("favorite", !form.favorite)}
              aria-label={form.favorite ? t("removeFromFavorites") : t("addToFavorites")}
              title={form.favorite ? t("removeFromFavorites") : t("addToFavorites")}
            >
              {form.favorite ? "\u2605" : "\u2606"}
            </button>
            <button type="submit">{t("save")}</button>
            {!item && onBulkCreate && (
              <button type="button" className="secondary" onClick={onBulkCreate}>{t("createMultipleItems")}</button>
            )}
            <button type="button" onClick={onClose}>{t("close")}</button>
          </div>
        </header>
        <div className="form-grid">
          <label>{t("title")}<input data-input-debug="Item title" required value={form.title} onChange={(event) => update("title", event.target.value)} /></label>
          <label>{t("issuingEntity")}<IssuingEntityCombobox countries={countries} value={form.country_id || ""} onChange={(value) => update("country_id", value)} /></label>
          <label>{t("type")}<select value={form.type_id || ""} onChange={(event) => update("type_id", event.target.value)}><option value="">{t("none")}</option>{orderedRows(types).map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select></label>
          <label>{t("year")}<input value={form.year || ""} onChange={(event) => update("year", event.target.value)} /></label>
          <label>{t("condition")}<input value={form.condition || ""} onChange={(event) => update("condition", event.target.value)} /></label>
          <label>{t("purchasePrice")}<input value={form.purchase_price || ""} onChange={(event) => update("purchase_price", event.target.value)} /></label>
          <label>{t("source")}<input value={form.source || ""} onChange={(event) => update("source", event.target.value)} /></label>
          <label>{t("tagsComma")}<input value={form.tags || ""} onChange={(event) => update("tags", event.target.value)} /></label>
          <label className="full">{t("description")}<textarea data-input-debug="Item description" value={form.description || ""} onChange={(event) => update("description", event.target.value)} /></label>
          <details className="custom-fields-section full" open={customFieldsOpen} onToggle={(event) => setCustomFieldsOpen(event.currentTarget.open)}>
            <summary>{t("customFields")}</summary>
            <label>{t("jsonStyleLines")}<textarea data-input-debug="Item custom fields" value={form.customFieldsText || ""} onChange={(event) => update("customFieldsText", event.target.value)} /></label>
          </details>
        </div>
      </form>
    </div>
  );
}

function groupsForEntity(entityId, library) {
  const groupIds = new Set((library.entityMemberships || [])
    .filter((entry) => entry.entity_id === entityId)
    .map((entry) => String(entry.group_id)));
  return orderedRows(library.entityGroups || []).filter((group) => groupIds.has(String(group.id)));
}

function NameForm({ title, label, extraLabel, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (extraLabel) {
            onSubmit({ title: name, description: extra });
          } else {
            onSubmit({ name });
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <label>{label}<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        {extraLabel && <label>{extraLabel}<textarea value={extra} onChange={(event) => setExtra(event.target.value)} /></label>}
        <footer><button type="submit">Save</button></footer>
      </form>
    </div>
  );
}

function ManageLists({ library, onClose, onRefresh, onMessage }) {
  const [activeTab, setActiveTab] = useState("types");
  const [entitySearch, setEntitySearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [countryFormOpen, setCountryFormOpen] = useState(false);
  const [typeFormOpen, setTypeFormOpen] = useState(false);
  const [editingCountry, setEditingCountry] = useState(null);
  const [editingType, setEditingType] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [blocked, setBlocked] = useState(null);
  const normalizedEntitySearch = entitySearch.trim().toLowerCase();
  const normalizedGroupSearch = groupSearch.trim().toLowerCase();
  const typeRows = orderedRows(library.types);
  const entityRows = orderedRows(library.countries).filter((country) => !normalizedEntitySearch || String(country.name || "").toLowerCase().includes(normalizedEntitySearch));
  const groupRows = orderedRows(library.entityGroups || []).filter((group) => {
    if (!normalizedGroupSearch) return true;
    return [group.name, group.kind, group.notes].some((value) => String(value || "").toLowerCase().includes(normalizedGroupSearch));
  });

  async function refreshWithMessage(text) {
    await onRefresh();
    onMessage(text);
  }

  async function deleteCountry(country) {
    if (!window.confirm(`Delete issuing entity "${country.name}"?`)) return;
    const result = await api.deleteCountry({ id: country.id, action: "check" });
    if (result.blocked) {
      setBlocked({ kind: "country", entity: country, ...result });
      return;
    }
    await refreshWithMessage("Issuing entity deleted.");
  }

  async function deleteType(type) {
    if (!window.confirm(`Delete collection type "${type.name}"?`)) return;
    const result = await api.deleteType({ id: type.id, action: "check" });
    if (result.blocked) {
      setBlocked({ kind: "type", entity: type, ...result });
      return;
    }
    await refreshWithMessage("Collection type deleted.");
  }

  async function reorderCountries(ids) {
    await api.reorderCountries(ids);
    await refreshWithMessage("Issuing entity order saved.");
  }

  async function reorderTypes(ids) {
    await api.reorderTypes(ids);
    await refreshWithMessage("Collection type order saved.");
  }

  async function reorderGroups(ids) {
    await api.reorderEntityGroups(ids);
    await refreshWithMessage("Entity group order saved.");
  }

  async function deleteGroup(group) {
    if (!window.confirm(`Delete entity group "${group.name}"? Entity memberships will be removed, but items will not be deleted.`)) return;
    await api.deleteEntityGroup(group.id);
    await refreshWithMessage("Entity group deleted.");
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wide manage-modal">
        <header>
          <h2>Manage lists</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="manage-tabs" role="tablist" aria-label="Manage list categories">
          <button type="button" className={activeTab === "types" ? "active" : ""} onClick={() => setActiveTab("types")}>Collection Types</button>
          <button type="button" className={activeTab === "entities" ? "active" : ""} onClick={() => setActiveTab("entities")}>Issuing Entities</button>
          <button type="button" className={activeTab === "groups" ? "active" : ""} onClick={() => setActiveTab("groups")}>Entity Groups</button>
        </div>
        <div className="manage-tab-panel">
          {activeTab === "types" && (
            <section>
              <div className="manage-section-header">
                <div>
                  <h3>Collection Types</h3>
                  <p className="quiet">Small manually ordered list.</p>
                </div>
                <button type="button" onClick={() => setTypeFormOpen(true)}>Add type</button>
              </div>
              <ReorderableManageList
                rows={typeRows}
                detail={(type) => type.description}
                onReorder={reorderTypes}
                onEdit={setEditingType}
                onDelete={deleteType}
              />
            </section>
          )}
          {activeTab === "entities" && (
            <section>
              <div className="manage-section-header">
                <div>
                  <h3>Issuing Entities</h3>
                  <p className="quiet">{entityRows.length} shown from {library.countries.length} entities</p>
                </div>
                <button type="button" onClick={() => setCountryFormOpen(true)}>Add entity</button>
              </div>
              <input
                className="manage-search"
                value={entitySearch}
                onChange={(event) => setEntitySearch(event.target.value)}
                placeholder="Search issuing entities..."
                aria-label="Search issuing entities"
              />
              <ReorderableManageList
                rows={entityRows}
                detail={(country) => {
                  const groupNames = groupsForEntity(country.id, library).map((group) => group.name).join(", ");
                  return [country.notes, groupNames ? `Groups: ${groupNames}` : ""].filter(Boolean).join(" / ");
                }}
                onReorder={reorderCountries}
                onEdit={setEditingCountry}
                onDelete={deleteCountry}
                reorderEnabled={!normalizedEntitySearch}
                emptyMessage="No matching issuing entities."
              />
            </section>
          )}
          {activeTab === "groups" && (
            <section>
              <div className="manage-section-header">
                <div>
                  <h3>Entity Groups</h3>
                  <p className="quiet">{groupRows.length} shown from {(library.entityGroups || []).length} groups</p>
                </div>
                <button type="button" onClick={() => setGroupFormOpen(true)}>Add group</button>
              </div>
              <input
                className="manage-search"
                value={groupSearch}
                onChange={(event) => setGroupSearch(event.target.value)}
                placeholder="Search entity groups..."
                aria-label="Search entity groups"
              />
              <ReorderableManageList
                rows={groupRows}
                detail={(group) => [group.kind, group.notes].filter(Boolean).join(" / ")}
                onReorder={reorderGroups}
                onEdit={setEditingGroup}
                onDelete={deleteGroup}
                reorderEnabled={!normalizedGroupSearch}
                emptyMessage="No matching entity groups."
              />
            </section>
          )}
        </div>
        {blocked && (
          <BlockedDeletePanel
            blocked={blocked}
            library={library}
            onCancel={() => setBlocked(null)}
            onDone={async (text) => {
              setBlocked(null);
              await refreshWithMessage(text);
            }}
          />
        )}
      </div>
      {editingCountry && (
        <CountryEditForm
          country={editingCountry}
          groups={library.entityGroups || []}
          selectedGroupIds={groupsForEntity(editingCountry.id, library).map((group) => group.id)}
          onClose={() => {
            setEditingCountry(null);
          }}
          onSubmit={async ({ groupIds, ...payload }) => {
            await api.updateCountry(payload);
            await api.setEntityMemberships({ entityId: payload.id, groupIds });
            setEditingCountry(null);
            await refreshWithMessage("Issuing entity updated.");
          }}
        />
      )}
      {countryFormOpen && (
        <NameForm
          title="New issuing entity"
          label="Name"
          onClose={() => {
            setCountryFormOpen(false);
          }}
          onSubmit={async (payload) => {
            await api.createCountry(payload);
            setCountryFormOpen(false);
            await refreshWithMessage("Issuing entity created.");
          }}
        />
      )}
      {typeFormOpen && (
        <NameForm
          title="New collection type"
          label="Name"
          onClose={() => {
            setTypeFormOpen(false);
          }}
          onSubmit={async (payload) => {
            await api.createType(payload);
            setTypeFormOpen(false);
            await refreshWithMessage("Collection type created.");
          }}
        />
      )}
      {groupFormOpen && (
        <NameForm
          title="New entity group"
          label="Name"
          onClose={() => {
            setGroupFormOpen(false);
          }}
          onSubmit={async (payload) => {
            await api.createEntityGroup(payload);
            setGroupFormOpen(false);
            await refreshWithMessage("Entity group created.");
          }}
        />
      )}
      {editingGroup && (
        <EntityGroupEditForm
          group={editingGroup}
          onClose={() => {
            setEditingGroup(null);
          }}
          onSubmit={async (payload) => {
            await api.updateEntityGroup(payload);
            setEditingGroup(null);
            await refreshWithMessage("Entity group updated.");
          }}
        />
      )}
      {editingType && (
        <TypeEditForm
          type={editingType}
          onClose={() => {
            setEditingType(null);
          }}
          onSubmit={async (payload) => {
            await api.updateType(payload);
            setEditingType(null);
            await refreshWithMessage("Collection type updated.");
          }}
        />
      )}
    </div>
  );
}

function ReorderableManageList({ rows, detail, onReorder, onEdit, onDelete, reorderEnabled = true, emptyMessage = "No entries." }) {
  const [localRows, setLocalRows] = useState(rows);
  const [draggingId, setDraggingId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  function idsFrom(nextRows) {
    return nextRows.map((row) => row.id);
  }

  async function saveRows(nextRows) {
    if (!reorderEnabled) return;
    setLocalRows(nextRows);
    await onReorder(idsFrom(nextRows));
  }

  async function move(rowId, direction) {
    if (!reorderEnabled) return;
    const index = localRows.findIndex((row) => String(row.id) === String(rowId));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= localRows.length) return;
    const nextRows = [...localRows];
    const [row] = nextRows.splice(index, 1);
    nextRows.splice(target, 0, row);
    await saveRows(nextRows);
  }

  function calculateDrop(event, rowId) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    setDropTarget({ rowId, position });
  }

  function startDrag(event, rowId) {
    if (!reorderEnabled) return;
    setDraggingId(rowId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", rowId);
  }

  async function drop(rowId = null, position = "after", draggedId = draggingId) {
    if (!reorderEnabled || !draggedId) return;
    const dragged = localRows.find((row) => String(row.id) === String(draggedId));
    if (!dragged) return;
    const withoutDragged = localRows.filter((row) => String(row.id) !== String(draggedId));
    const targetIndex = rowId ? withoutDragged.findIndex((row) => String(row.id) === String(rowId)) : withoutDragged.length - 1;
    const insertAt = rowId ? targetIndex + (position === "after" ? 1 : 0) : withoutDragged.length;
    const nextRows = [...withoutDragged];
    nextRows.splice(Math.max(0, insertAt), 0, dragged);
    setDraggingId(null);
    setDropTarget(null);
    await saveRows(nextRows);
  }

  return (
    <div
      className="manage-list reorder-list"
      onDragOver={(event) => {
        if (reorderEnabled) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        drop(null, "after", event.dataTransfer.getData("text/plain") || draggingId);
      }}
    >
      {localRows.map((row, index) => {
        const detailText = detail(row);
        const indicator = dropTarget?.rowId === row.id ? `drop-${dropTarget.position}` : "";
        return (
          <div
            className={`manage-row reorder-row ${reorderEnabled ? "" : "no-reorder"} ${draggingId === row.id ? "dragging" : ""} ${indicator}`}
            key={row.id}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTarget(null);
            }}
            onDragOver={(event) => {
              if (!reorderEnabled) return;
              event.preventDefault();
              calculateDrop(event, row.id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!reorderEnabled) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const position = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
              drop(row.id, position, event.dataTransfer.getData("text/plain") || draggingId);
            }}
          >
            {reorderEnabled && (
              <button
                type="button"
                className="drag-handle"
                draggable
                aria-label={`Drag ${row.name}`}
                title={`Drag ${row.name}`}
                onDragStart={(event) => startDrag(event, row.id)}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDropTarget(null);
                }}
              >
                ::
              </button>
            )}
            <div className="manage-row-main">
              <strong title={row.name}>{row.name}</strong>
              {detailText && <span>{detailText}</span>}
            </div>
            <div className="order-actions">
              <button type="button" aria-label={`Move ${row.name} up`} disabled={index === 0} onClick={() => move(row.id, -1)}>↑</button>
              <button type="button" aria-label={`Move ${row.name} down`} disabled={index === localRows.length - 1} onClick={() => move(row.id, 1)}>↓</button>
            </div>
            <button type="button" draggable={false} onClick={() => onEdit(row)}>Edit</button>
            <button type="button" draggable={false} className="danger" onClick={() => onDelete(row)}>Delete</button>
          </div>
        );
      })}
      {localRows.length === 0 && <p className="quiet">{emptyMessage}</p>}
    </div>
  );
}

function BlockedDeletePanel({ blocked, library, onCancel, onDone }) {
  const [replacementId, setReplacementId] = useState("");
  const isCountry = blocked.kind === "country";
  const replacements = orderedRows(isCountry ? library.countries : library.types).filter((entry) => entry.id !== blocked.entity.id);

  async function apply(action) {
    if (isCountry) {
      await api.deleteCountry({ id: blocked.entity.id, action, replacementId });
      await onDone(action === "clear" ? "Issuing entity cleared from linked items." : "Issuing entity reassigned and deleted.");
    } else {
      await api.deleteType({ id: blocked.entity.id, action, replacementId });
      await onDone(action === "clear" ? "Collection type cleared from linked items." : "Collection type reassigned and deleted.");
    }
  }

  return (
    <div className="blocked-panel">
      <h3>{blocked.entity.name} is still linked</h3>
      <p>{blocked.count} item{blocked.count === 1 ? "" : "s"} use this {isCountry ? "issuing entity" : "collection type"}.</p>
      <div className="linked-list">
        {blocked.linkedItems.slice(0, 6).map((item) => <span key={item.id}>{item.title}</span>)}
      </div>
      <div className="blocked-actions">
        <button type="button" onClick={onCancel}>Cancel deletion</button>
        <select value={replacementId} onChange={(event) => setReplacementId(event.target.value)}>
          <option value="">Reassign to...</option>
          {replacements.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
        </select>
        <button type="button" disabled={!replacementId} onClick={() => apply("reassign")}>Reassign linked items</button>
        <button type="button" className="danger" onClick={() => apply("clear")}>Clear field from linked items</button>
      </div>
    </div>
  );
}

function CountryEditForm({ country, groups, selectedGroupIds, onClose, onSubmit }) {
  const [name, setName] = useState(country.name || "");
  const [notes, setNotes] = useState(country.notes || "");
  const [groupIds, setGroupIds] = useState(() => new Set((selectedGroupIds || []).map((entry) => String(entry))));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [pendingGroupIds, setPendingGroupIds] = useState(() => new Set());

  const orderedGroups = useMemo(() => orderedRows(groups), [groups]);
  const selectedGroups = orderedGroups.filter((group) => groupIds.has(String(group.id)));
  const unassignedGroups = orderedGroups.filter((group) => !groupIds.has(String(group.id)));
  const normalizedGroupSearch = groupSearch.trim().toLowerCase();
  const pickerGroups = unassignedGroups.filter((group) => !normalizedGroupSearch || String(group.name || "").toLowerCase().includes(normalizedGroupSearch));

  function removeGroup(groupId) {
    setGroupIds((current) => {
      const next = new Set(current);
      next.delete(String(groupId));
      return next;
    });
  }

  function togglePendingGroup(groupId, checked) {
    setPendingGroupIds((current) => {
      const next = new Set(current);
      if (checked) next.add(String(groupId));
      else next.delete(String(groupId));
      return next;
    });
  }

  function openPicker() {
    setPendingGroupIds(new Set());
    setGroupSearch("");
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
    setPendingGroupIds(new Set());
    setGroupSearch("");
  }

  function addPendingGroups() {
    setGroupIds((current) => new Set([...current, ...pendingGroupIds]));
    closePicker();
  }

  return (
    <form className="modal nested-modal" onSubmit={(event) => { event.preventDefault(); onSubmit({ id: country.id, name, notes, groupIds: [...groupIds] }); }}>
      <header>
        <h2>Edit issuing entity</h2>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <section className="membership-editor" aria-label="Entity Groups">
        <div className="membership-header">
          <strong>Entity Groups</strong>
          <button type="button" onClick={openPicker} disabled={unassignedGroups.length === 0}>Add group</button>
        </div>
        <div className="group-chip-list">
          {selectedGroups.map((group) => (
            <span className="group-chip" key={group.id}>
              {group.name}
              <button type="button" aria-label={`Remove group ${group.name}`} title="Remove group" onClick={() => removeGroup(group.id)}>&times;</button>
            </span>
          ))}
          {selectedGroups.length === 0 && <p className="quiet">No groups assigned.</p>}
        </div>
        {groups.length === 0 && <p className="quiet">Create entity groups first, then assign this entity to them.</p>}
        {pickerOpen && (
          <div className="group-picker" role="dialog" aria-label="Add entity groups">
            <div className="group-picker-header">
              <strong>Add group</strong>
              <button type="button" onClick={closePicker}>Close</button>
            </div>
            <input
              value={groupSearch}
              onChange={(event) => setGroupSearch(event.target.value)}
              placeholder="Search groups..."
              aria-label="Search entity groups"
              autoFocus
            />
            <div className="group-picker-list">
              {pickerGroups.map((group) => (
                <CheckRow
                  key={group.id}
                  checked={pendingGroupIds.has(String(group.id))}
                  label={group.name}
                  onChange={(checked) => togglePendingGroup(group.id, checked)}
                />
              ))}
              {pickerGroups.length === 0 && <p className="quiet">No matching groups</p>}
            </div>
            <div className="group-picker-actions">
              <button type="button" onClick={closePicker}>Cancel</button>
              <button type="button" disabled={pendingGroupIds.size === 0} onClick={addPendingGroups}>Add selected groups</button>
            </div>
          </div>
        )}
      </section>
      <footer><button type="submit">Save</button></footer>
    </form>
  );
}

function EntityGroupEditForm({ group, onClose, onSubmit }) {
  const [name, setName] = useState(group.name || "");
  const [kind, setKind] = useState(group.kind || "");
  const [notes, setNotes] = useState(group.notes || "");

  return (
    <form className="modal nested-modal" onSubmit={(event) => { event.preventDefault(); onSubmit({ id: group.id, name, kind, notes }); }}>
      <header>
        <h2>Edit entity group</h2>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Kind<input value={kind} onChange={(event) => setKind(event.target.value)} placeholder="Optional" /></label>
      <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <footer><button type="submit">Save</button></footer>
    </form>
  );
}

function TypeEditForm({ type, onClose, onSubmit }) {
  const [name, setName] = useState(type.name || "");
  const [description, setDescription] = useState(type.description || "");
  const [customFieldsText, setCustomFieldsText] = useState(customFieldsToText(parseJsonText(type.custom_fields_json, {})));

  return (
    <form className="modal nested-modal" onSubmit={(event) => { event.preventDefault(); onSubmit({ id: type.id, name, description, customFields: customFieldsFromText(customFieldsText) }); }}>
      <header>
        <h2>Edit collection type</h2>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>Custom fields JSON-style lines<textarea value={customFieldsText} onChange={(event) => setCustomFieldsText(event.target.value)} /></label>
      <footer><button type="submit">Save</button></footer>
    </form>
  );
}

function parseJsonText(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function EmptyState({ title }) {
  return <div className="empty">{title}</div>;
}

perfTrace("renderer.module.loaded", { ms: Math.round(rendererModuleLoadedAt * 10) / 10 });
createRoot(document.getElementById("root")).render(<App />);
perfTrace("renderer.root.render.called", { ms: Math.round(performance.now() * 10) / 10 });
