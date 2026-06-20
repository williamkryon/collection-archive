import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const api = window.archiveAPI;

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
    newItem: "New item",
    manageLists: "Manage lists",
    dataFolder: "Data folder",
    openingArchive: "Opening archive...",
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
    metadata: "Metadata",
    replaceImage: "Replace image",
    removeImage: "Remove image",
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
    gridSize: "Grid size",
    template: "Template",
    applyTemplate: "Apply template",
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
  const [message, setMessage] = useState("");
  const [itemsVersion, setItemsVersion] = useState(0);
  const [libraryItems, setLibraryItems] = useState({ items: [], total: 0, limit: libraryPageSize, offset: 0, loading: false });
  const [galleryItems, setGalleryItems] = useState({ items: [], total: 0, limit: galleryPageSize, offset: 0, loading: false });
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

  async function refresh() {
    const nextLibrary = await api.getLibrary();
    setLibrary(nextLibrary);
  }

  useEffect(() => {
    refresh();
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
        items: append ? [...current.items, ...result.items] : result.items
      }));
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
        items: append ? [...current.items, ...result.items] : result.items
      }));
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
    const timeout = window.setTimeout(() => setMessage(""), 2000);
    return () => window.clearTimeout(timeout);
  }, [message]);

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
    if (!window.confirm("Delete this item? Images and album placements for this item will be removed.")) return;
    await api.deleteItem(itemId);
    await refresh();
    setItemsVersion((version) => version + 1);
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
      setDetail(null);
      setActiveView("library");
    }
    setMessage("Item deleted.");
  }

  async function addImages(itemId) {
    await api.addImages(itemId);
    await refresh();
    setItemsVersion((version) => version + 1);
    setDetail(await api.getItem(itemId));
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
    return <div className="boot">{t("openingArchive")}</div>;
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
          <button className="ghost" onClick={() => api.revealDataFolder()}>
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
            onRemoveImage={removeImage}
            onReplaceImage={replaceImage}
            onReorderImages={reorderImages}
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
      </main>
      {message && (
        <button type="button" className="toast" onClick={() => setMessage("")}>
          {message}
        </button>
      )}

      {itemFormOpen && (
        <ItemForm
          title={t("newItemTitle")}
          countries={library.countries}
          types={library.types}
          onClose={() => setItemFormOpen(false)}
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

function LibraryView({ library, items, total, loading, filters, setFilters, onLoadMore, onOpenItem, onToggleFavorite, onEditItem, onDeleteItem }) {
  const { t } = useI18n();
  return (
    <section className="workspace">
      <header className="topbar library-header">
        <div className="library-title-row">
          <h1>{t("libraryTitle")}</h1>
          <p>{t("libraryCount", "", { shown: items.length, total })}</p>
        </div>
        <FilterBar library={library} filters={filters} setFilters={setFilters} />
      </header>
      <div className="item-grid">
        {items.map((item) => (
          <article className="item-card" key={item.id}>
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
        <input value={filters.year} onChange={(event) => update({ year: event.target.value })} placeholder={t("year")} />
        <label className="filter-tag-field">
          <input value={filters.tag} onChange={(event) => update({ tag: event.target.value })} placeholder={t("tagsComma")} aria-label={t("tagsComma")} />
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
  const viewerImages = items.map((item) => ({
    ...item.cover,
    itemId: item.id,
    title: item.title
  }));

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

function DetailView({ detail, countries, types, onBack, onAddImages, onRemoveImage, onReplaceImage, onReorderImages, onUpdate, onToggleFavorite, onDeleteItem }) {
  const { t } = useI18n();
  const [activeImage, setActiveImage] = useState(0);
  const [editing, setEditing] = useState(false);
  const [dragImageId, setDragImageId] = useState("");

  useEffect(() => {
    setActiveImage(0);
    setEditing(false);
  }, [detail?.id]);

  useEffect(() => {
    if (detail && activeImage >= detail.images.length) {
      setActiveImage(Math.max(0, detail.images.length - 1));
    }
  }, [detail, activeImage]);

  if (!detail) {
    return (
      <section className="workspace">
        <button className="back" onClick={onBack}>{t("back")}</button>
        <EmptyState title={t("selectItem")} />
      </section>
    );
  }

  const image = detail.images[activeImage];
  const viewerImages = detail.images.map((entry) => ({ ...entry, title: entry.original_filename }));

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
            <div className="image-meta">
              <span>{image.original_filename}</span>
              <span>{image.width} x {image.height}</span>
              <span>Aspect {Number(image.aspect_ratio).toFixed(3)}</span>
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
                onClick={() => setActiveImage(index)}
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
        </aside>
      </div>
      {editing && (
        <ItemForm
          title={t("editItemTitle")}
          item={detail}
          countries={countries}
          types={types}
          onClose={() => setEditing(false)}
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
      {open && <ImageViewer images={images} initialIndex={activeImage} title={title} onClose={() => setOpen(false)} />}
    </>
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
  const pageCopyControls = activePage ? (
    <div className="page-copy-controls">
      <button type="button" onClick={duplicateActivePage}>{t("duplicatePage")}</button>
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
      <button type="button" disabled={!copyTargetAlbumId} onClick={copyActivePageToAlbum}>{t("copy")}</button>
    </div>
  ) : null;

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
        {!album && <EmptyState title={t("chooseAlbum")} />}
        {album && (
          <>
            <header className="album-toolbar">
              {mode === "edit" ? (
                <>
                  <div className="album-header-row album-header-main">
                    <input value={albumTitle} onChange={(event) => setAlbumTitle(event.target.value)} placeholder={t("albumName")} />
                    <input value={albumDescription} onChange={(event) => setAlbumDescription(event.target.value)} placeholder={t("description")} />
                    <button type="button" onClick={() => onUpdateAlbum({ id: album.id, title: albumTitle, description: albumDescription })}>{t("saveAlbum")}</button>
                    <button type="button" className="danger" onClick={() => onDeleteAlbum(album.id)}>{t("deleteAlbum")}</button>
                    <div className="segmented">
                      <button className={mode === "preview" ? "active" : ""} type="button" onClick={() => setMode("preview")}>{t("preview")}</button>
                      <button className={mode === "edit" ? "active" : ""} type="button" onClick={() => setMode("edit")}>{t("edit")}</button>
                    </div>
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
                    <div className="page-order-controls">
                      <button type="button" aria-label={t("movePageUp")} title={t("movePageUp")} disabled={!activePage || albumPages.findIndex((page) => page.id === activePageId) <= 0} onClick={() => moveActivePage(-1)}>{t("moveUp")}</button>
                      <button type="button" aria-label={t("movePageDown")} title={t("movePageDown")} disabled={!activePage || albumPages.findIndex((page) => page.id === activePageId) >= albumPages.length - 1} onClick={() => moveActivePage(1)}>{t("moveDown")}</button>
                    </div>
                    {pageCopyControls}
                    <button>{t("addPage")}</button>
                  </form>
                </>
              ) : (
                <>
                  <div>
                    <h1>{album.title}</h1>
                    <p>{album.description || t("digitalAlbum")}</p>
                  </div>
                  <div className="album-toolbar-actions">
                    <div className="album-pdf-export-actions">
                      <PdfQualitySelect value={pdfQuality} onChange={setPdfQuality} />
                      <button type="button" onClick={exportAlbumPdf}>{t("exportPdf")}</button>
                    </div>
                    <div className="segmented">
                      <button className={mode === "preview" ? "active" : ""} type="button" onClick={() => setMode("preview")}>{t("preview")}</button>
                      <button className={mode === "edit" ? "active" : ""} type="button" onClick={() => setMode("edit")}>{t("edit")}</button>
                    </div>
                    <div className="segmented preview-style-toggle">
                      <button className={previewStyle === "standard" ? "active" : ""} type="button" onClick={() => setPreviewStyle("standard")}>{t("designedPage")}</button>
                      <button className={previewStyle === "clean" ? "active" : ""} type="button" onClick={() => setPreviewStyle("clean")}>{t("cleanPreview")}</button>
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
                <div className="page-order-controls">
                  <button type="button" aria-label={t("movePageUp")} title={t("movePageUp")} disabled={!activePage || albumPages.findIndex((page) => page.id === activePageId) <= 0} onClick={() => moveActivePage(-1)}>{t("moveUp")}</button>
                  <button type="button" aria-label={t("movePageDown")} title={t("movePageDown")} disabled={!activePage || albumPages.findIndex((page) => page.id === activePageId) >= albumPages.length - 1} onClick={() => moveActivePage(1)}>{t("moveDown")}</button>
                </div>
                {pageCopyControls}
                <button type="button" onClick={() => exportPageImage()}>{t("exportPage")}</button>
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
          onClose={() => setPickerOpen(null)}
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
  "a4-portrait": { label: "A4 portrait", width: 1000, height: 1414, orientation: "portrait" },
  "a4-landscape": { label: "A4 landscape", width: 1414, height: 1000, orientation: "landscape" },
  "letter-portrait": { label: "Letter portrait", width: 1000, height: 1294, orientation: "portrait" },
  "letter-landscape": { label: "Letter landscape", width: 1294, height: 1000, orientation: "landscape" },
  square: { label: "Square", width: 1000, height: 1000, orientation: "portrait" },
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
    border_radius: Number(entry.border_radius ?? 2)
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

function safeExportFilename(name) {
  const cleaned = String(name || "album")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "album";
}

function exportFrameCss(entry) {
  return styleToCss({
    boxSizing: "border-box",
    ...placementFrameStyle(entry)
  });
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
          fontSize: Number(entry.font_size || 24),
          fontWeight: entry.bold ? 800 : 500,
          fontStyle: entry.italic ? "italic" : "normal",
          textAlign: entry.text_align || "center",
          color: entry.text_color || "#202629",
          background: entry.background === "white" ? "#fff" : "transparent"
        })}">${escapeHtml(entry.text_content || "")}</div>
      </div>
    `;
  }

  const image = resolvePlacementExportImage(entry);
  const imageHtml = image?.url
    ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(entry.title || image.original_filename || "Album image")}" />`
    : `<div class="export-placeholder">No image</div>`;
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
    .export-image-box img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .export-placeholder { display: grid; width: 100%; height: 100%; place-items: center; color: #667477; background: #eef3f2; }
    .export-placement-text { display: grid; gap: 2px; max-height: 72px; overflow: hidden; color: #263234; font-size: 14px; line-height: 1.25; }
    .export-placement-text strong, .export-placement-text span { min-width: 0; overflow-wrap: anywhere; }
    .export-text-content { display: grid; width: 100%; height: 100%; align-items: center; overflow: hidden; white-space: pre-wrap; padding: 4px; }
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

function AlbumItemPicker({ countries, entityGroups = [], types, pageId, title = "Add item", onAdd, onClose }) {
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

  function selectItem(item) {
    setSelectedItem(item);
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

  function handleKeyDown(event) {
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
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="picker-filters">
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title" />
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
          <input value={year} onChange={(event) => setYear(event.target.value)} placeholder="Year" />
          <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Tags" />
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
                </div>
              </>
            ) : (
              <p className="quiet">Select an item to choose its image.</p>
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

  function scheduleTextCommit(entry, textContent, delay = 450) {
    const existing = textCommitTimersRef.current.get(entry.id);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      textCommitTimersRef.current.delete(entry.id);
      commitEntry({ ...entry, text_content: textContent }, false);
    }, delay);
    textCommitTimersRef.current.set(entry.id, timer);
  }

  function flushTextCommit(entry, textContent) {
    const existing = textCommitTimersRef.current.get(entry.id);
    if (existing) {
      window.clearTimeout(existing);
      textCommitTimersRef.current.delete(entry.id);
    }
    if (textContent !== (entry.text_content || "")) {
      commitEntry({ ...entry, text_content: textContent }, true);
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

  function isTypingTarget(target) {
    return Boolean(
      target &&
      (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable ||
        target.closest?.("[contenteditable='true']")
      )
    );
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
          font_size: entry.font_size,
          bold: entry.bold,
          italic: entry.italic,
          text_align: entry.text_align,
          text_color: entry.text_color,
          background: entry.background
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
      const target = event.target;
      const typing = isTypingTarget(target);
      if (event.key === "Escape") {
        event.preventDefault();
        if (typing) {
          target.blur?.();
          setEditingTextId("");
          return;
        }
        setSelectedIds([]);
        setEditingTextId("");
        cleanupInteraction();
        return;
      }
      if (typing) return;
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
                          fontSize: Number(entry.font_size || 24),
                          fontWeight: entry.bold ? 800 : 500,
                          fontStyle: entry.italic ? "italic" : "normal",
                          textAlign: entry.text_align || "center",
                          color: entry.text_color || "#202629",
                          background: entry.background === "white" ? "#fff" : "transparent"
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
                          fontSize: Number(entry.font_size || 24),
                          fontWeight: entry.bold ? 800 : 500,
                          fontStyle: entry.italic ? "italic" : "normal",
                          textAlign: entry.text_align || "center",
                          color: entry.text_color || "#202629",
                          background: entry.background === "white" ? "#fff" : "transparent"
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
                        {entry.cover ? <MediaImage src={entry.cover.thumbnailUrl} alt={entry.title} context={`Album placement: ${entry.title}`} /> : <div className="image-placeholder">No image</div>}
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

function PlacementInspector({ entry, saveStatus, onUpdate, onLayer, onDuplicate, onRemove }) {
  const [caption, setCaption] = useState(entry.caption || "");
  const [textContent, setTextContent] = useState(entry.text_content || "");

  useEffect(() => {
    setCaption(entry.caption || "");
    setTextContent(entry.text_content || "");
  }, [entry.id, entry.caption, entry.text_content]);

  const isText = entry.element_type === "text";

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
      <div className="inspector-fields">
        {isText ? (
          <>
            <label>Text<textarea value={textContent} onChange={(event) => setTextContent(event.target.value)} onBlur={() => onUpdate({ ...entry, text_content: textContent })} /></label>
            <label>Font size<input type="number" min="8" max="96" value={Number(entry.font_size || 24)} onChange={(event) => onUpdate({ ...entry, font_size: Number(event.target.value || 24) })} /></label>
            <label>Alignment<select value={entry.text_align || "center"} onChange={(event) => onUpdate({ ...entry, text_align: event.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
            <label>Text color<input type="color" value={entry.text_color || "#202629"} onChange={(event) => onUpdate({ ...entry, text_color: event.target.value })} /></label>
            <label>Background<select value={entry.background || "transparent"} onChange={(event) => onUpdate({ ...entry, background: event.target.value })}><option value="transparent">Transparent</option><option value="white">White</option></select></label>
            <CheckRow checked={Boolean(entry.bold)} label="Bold" onChange={(checked) => onUpdate({ ...entry, bold: checked })} />
            <CheckRow checked={Boolean(entry.italic)} label="Italic" onChange={(checked) => onUpdate({ ...entry, italic: checked })} />
          </>
        ) : (
          <>
            <AlbumSlotImageSelect entry={entry} onUpdate={onUpdate} />
            <label>Caption<input value={caption} onChange={(event) => setCaption(event.target.value)} onBlur={() => onUpdate({ ...entry, caption })} /></label>
            <CheckRow checked={Boolean(entry.show_title)} label="Show title" onChange={(checked) => onUpdate({ ...entry, show_title: checked })} />
            <CheckRow checked={Boolean(entry.show_caption)} label="Show caption" onChange={(checked) => onUpdate({ ...entry, show_caption: checked })} />
            <CheckRow checked={Boolean(entry.show_metadata)} label="Show item info" title="Show or hide issuing entity, type, and year for this placement." onChange={(checked) => onUpdate({ ...entry, show_metadata: checked })} />
            <FrameStyleControls entry={entry} onChange={(changes) => onUpdate({ ...entry, ...changes })} />
          </>
        )}
        <CheckRow checked={Boolean(entry.locked)} label="Lock ratio" onChange={(checked) => onUpdate({ ...entry, locked: checked })} />
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
      <button type="button" onClick={onAddItem}>{t("addItem")}</button>
      <button type="button" onClick={onAddText}>{t("addText")}</button>
      <button type="button" onClick={onZoomOut}>{t("zoomOut")}</button>
      <button type="button" onClick={onZoomIn}>{t("zoomIn")}</button>
      <button type="button" onClick={onFitPage}>{t("fitPage")}</button>
      <button type="button" onClick={onActualSize}>{t("actualSize")}</button>
      <button type="button" onClick={onSavePage}>{t("savePage")}</button>
      <button type="button" className="danger" onClick={onDeletePage}>{t("deletePage")}</button>
      <button type="button" disabled={!canUndo} onClick={onUndo}>{t("undo")}</button>
      <button type="button" disabled={!canRedo} onClick={onRedo}>{t("redo")}</button>
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
      <div className="inspector-fields">
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
          <button type="button" onClick={onPickBackground}>{t("setBackgroundImage")}</button>
          <button
            type="button"
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
        <CheckRow checked={showGuides} label={t("showGuides")} title="Display alignment guides while editing the page." onChange={setShowGuides} />
        <CheckRow checked={snapToGrid} label={t("snapToGrid")} title="When moving or resizing items, align them to the grid." onChange={setSnapToGrid} />
        <label className="editor-number" title="Controls spacing of the snap grid; smaller values allow finer positioning.">{t("gridSize")}<input type="number" min="5" max="100" value={gridSize} onChange={(event) => setGridSize(Number(event.target.value))} /></label>
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

function ItemForm({ title, item, countries, types, onClose, onSubmit }) {
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
            <button type="button" onClick={onClose}>{t("close")}</button>
          </div>
        </header>
        <div className="form-grid">
          <label>{t("title")}<input required value={form.title} onChange={(event) => update("title", event.target.value)} /></label>
          <label>{t("issuingEntity")}<IssuingEntityCombobox countries={countries} value={form.country_id || ""} onChange={(value) => update("country_id", value)} /></label>
          <label>{t("type")}<select value={form.type_id || ""} onChange={(event) => update("type_id", event.target.value)}><option value="">{t("none")}</option>{orderedRows(types).map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select></label>
          <label>{t("year")}<input value={form.year || ""} onChange={(event) => update("year", event.target.value)} /></label>
          <label>{t("condition")}<input value={form.condition || ""} onChange={(event) => update("condition", event.target.value)} /></label>
          <label>{t("purchasePrice")}<input value={form.purchase_price || ""} onChange={(event) => update("purchase_price", event.target.value)} /></label>
          <label>{t("source")}<input value={form.source || ""} onChange={(event) => update("source", event.target.value)} /></label>
          <label>{t("tagsComma")}<input value={form.tags || ""} onChange={(event) => update("tags", event.target.value)} /></label>
          <label className="full">{t("description")}<textarea value={form.description || ""} onChange={(event) => update("description", event.target.value)} /></label>
          <details className="custom-fields-section full" open={customFieldsOpen} onToggle={(event) => setCustomFieldsOpen(event.currentTarget.open)}>
            <summary>{t("customFields")}</summary>
            <label>{t("jsonStyleLines")}<textarea value={form.customFieldsText || ""} onChange={(event) => update("customFieldsText", event.target.value)} /></label>
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
          onClose={() => setEditingCountry(null)}
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
          onClose={() => setCountryFormOpen(false)}
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
          onClose={() => setTypeFormOpen(false)}
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
          onClose={() => setGroupFormOpen(false)}
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
          onClose={() => setEditingGroup(null)}
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
          onClose={() => setEditingType(null)}
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

createRoot(document.getElementById("root")).render(<App />);
