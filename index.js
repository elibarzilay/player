"use strict";

// ---- config ----------------------------------------------------------------

const autoExpandItems = 30;
const pgSize = 10;
const bigSkip = 60, smallSkip = 5, smallerSkipDiv = 2;
const fadeToFreq = 20, pauseFade = 1, switchFade = 0.25; // time for 0-1 fade
const imageDelayTime = 2, imageCycleTime = 60, imageExplicitTime = 120;
const tickerTime = 60, tickerSwapTime = 1;
const analyzerSettings = { smoothingTimeConstant: 0.5, fftSize: 2 * 512 };

// ---- utils -----------------------------------------------------------------

const $ = x => document.getElementById(x);
const { isArray } = Array;
const { isFinite } = Number;
const { round, floor, ceil, abs, max, min, random } = Math;
const { now } = Date;
const U = undefined;

const mod = (n, m) => { const r = n % m; return r < 0 ? r + m : r; };
const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
const clipRange = (lo, x, hi) => max(min(x,hi), lo);
const clip01 = x => clipRange(0, x, 1);
const padL = (s, n, c = "\u2007") =>
  typeof s !== "string" ? padL(String(s), n, c)
  : s.length >= n ? s : c.repeat(n - s.length) + s;

const arrNext = (arr, cur) =>
  arr[mod(arr.indexOf(cur)+1, arr.length)];

const timeout = (wait, cb) => setTimeout(cb, wait);

const shuffle = xs => {
  xs = xs.slice();
  xs.forEach((x,i) => {
    const j = i + floor(random() * (xs.length - i));
    xs[i] = xs[j], xs[j] = x;
  });
  return xs;
};

const addLazyProp = (o, name, get) =>
  Object.defineProperty(o, name, { configurable: true, get: ()=> {
    const value = get(o);
    Object.defineProperty(o, name, { value, writable: true });
    return value;
  }});

const wheelToN = (e, n1, n2, dflt) =>
  (e.deltaY > 0 ? +n1 : e.deltaY < 0 ? -n1
   : e.deltaX > 0 ? +n2 : e.deltaX < 0 ? -n2
   : dflt);

const scrollIntoView = elt =>
  elt.scrollIntoView({
    behavior: "auto", block: "nearest", inline: "nearest" });

["selected", "player", "altitem", "dragitem"].forEach(prop => {
  let item; Object.defineProperty($, prop, {
    get: ()=> item,
    set: elt => { if (item === elt) return;
                  if (item instanceof Element) item.classList.remove(prop);
                  item = elt;
                  if (item instanceof Element) item.classList.add(prop); } });
});

const $message = $("message");
const message = txt => {
  $message.innerHTML = txt;
  $message.classList.add("active");
  clearTimeout(message.timer);
  message.timer = timeout(2000, ()=> $message.classList.remove("active"));
};

// desmos: 1-\cos\left(\frac{\pi}{2}\left(1-\operatorname{abs}\left(x-
// \left\{-1\le x<1:\ 0,\ 1\le x<3:\ 2,\ 3\le x:4\right\}\right)\right)\right)
const spike = n => 1 - Math.cos((Math.PI/2)*n);
const antiSpike = n => Math.sin((Math.PI/2)*n);

const hsl = (h, s, l, a) =>
  `hsl(${round(h)}deg, ${round(s)}%, ${round(l)}%, ${round(a)}%)`;

const blankPNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQ"
  + "VR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const reddishPNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQ"
  + "VR42mP8f+ZMPQAIgQMYmyUZ4QAAAABJRU5ErkJggg==";

const setStyleVar = (()=>{
  const rootS = document.documentElement.style;
  return (prop, val) => rootS.setProperty(prop, val);
})();

// ---- data ------------------------------------------------------------------

let all = {};

const processData = data => {
  const p = dir => info => {
    const isDir = info.type === "dir";
    info.path = dir + info.name + (isDir ? "/" : "");
    info.name =
      (isDir ? (info.name === "" ? "All" : info.name)
             : info.name.replace(/[.]([^.]+)$/,
                                 !info.type.startsWith("other") ? "" : " ($1)"))
        .replace(/^(\d+)-/, "$1. ")
        .replace(/_/g, " ").replace(/-/g, " – ");
    if (isDir) {
      info.children.forEach(p(info.path));
      info.size = 1 + info.children.map(c => c.size || 1)
                                   .reduce((x,y) => x+y, 0);
    }
  };
  p("")(data);
  localStorage.all = JSON.stringify(data);
  return data;
};

// ---- additional runtime data -----------------------------------------------

const addLazyInfoProps = info => {
  addLazyProp(info, "elt", ()=> $(info.path));
  if (info.type !== "audio") return;
  const txt = x => x ? " " + x.replaceAll(/\//g, " ") : "";
  addLazyProp(info, "search", ()=>
    (info.path + "/" + txt(info.title) + txt(info.album) + txt(info.track)
     + txt(info.date) + txt(info.artist))
    .replace(/[ _]+/g, " ").toLowerCase());
};

const setAllExtras = ()=> {
  let first = null, last = null, firsts = [all], lasts = [all];
  const loop = parent => parent.children.forEach(child => {
    child.parent = parent;
    if (last) child.preva = last; else firsts.push(child);
    if (child.type === "audio") {
      child.duration = +child.duration;
      if (!first) first = child;
      lasts.forEach(n => n.nexta = child); lasts.length = 0;
      last = child;
    }
    lasts.push(child);
    if (child.children) loop(child);
    addLazyInfoProps(child);
  });
  loop(all);
  addLazyInfoProps(all);
  lasts .forEach(n => n.nexta = first); lasts .length = 0;
  firsts.forEach(n => n.preva = last ); firsts.length = 0;
};

// ---- rendering -------------------------------------------------------------

const $main  = $("main");
const $plist = $("plist");

const infoMap = new WeakMap();
const getInfo = elt => infoMap.get(elt);
const getPath = elt => elt.id || getInfo(elt).path;
const isMainItem = elt =>
  elt === $main || (elt !== $plist && (!!elt.id || elt === $main));

const div = (parent, css = null, txt = null) => {
  const div = document.createElement("div");
  if (css) (isArray(css) ? css : [css]).forEach(c => div.classList.add(c));
  if (txt) div.innerText = txt;
  parent.append(div);
  return div;
};

const allItems = [];
const renderItem = (elt, info, main) => {
  if (info.type === "dir") elt = div(elt, "list");
  const item = div(elt, ["item", info.type], info.name);
  allItems.push(item);
  if (main) item.id = info.path;
  item.setAttribute("tabindex", 0);
  item.setAttribute("draggable", true);
  infoMap.set(item, info);
  addItemEvents(item, info);
  if (info.type === "dir") {
    const subs = div(elt, "subs");
    info.children.forEach(c => renderItem(subs, c, main));
  }
  return item;
};

const focusItemHandler = elt => {
  if ($.selected && isMainItem(elt) !== isMainItem($.selected))
    [$.altitem, $.selected] = [$.selected, $.altitem];
  return $.selected = elt;
};

const addItemEvents = (elt, info) => {
  elt.addEventListener("click", e => mainOrPlistOp(e, elt, info));
  elt.addEventListener("dragstart", dragStart);
  elt.addEventListener("dragend", dragEnd);
  elt.addEventListener("focus", ()=> focusItemHandler(elt));
};

// can also use allItems.filter(x => !isHidden(x)), but it tends to be slower
const visibleItems = ()=> [...$main.querySelectorAll([
  ".list.open > .item",
  ".list.open > .subs > .item",
  ".list.open > .subs:not(.only) > .list > .item"
].join(","))];

// ---- player ----------------------------------------------------------------

const $player = $("player");
const play = (elt = $.selected) => {
  if (typeof elt === "string") elt = $(elt);
  const info = getInfo(elt);
  if (elt && info.type !== "audio") elt = null;
  if ($.player === elt) $player.currentTime = 0;
  $.player = elt;
  if (info) fetchBeats(info);
  const doPlay = ()=> {
    $player.volume = $player.defaultVolume;
    if (!elt) return playerStop();
    updateDisplays(info);
    playerPlay();
    setBackgroundImageLoop(imageDelayTime);
  }
  if (!elt || $player.paused) doPlay();
  else fadeTo([0, switchFade], doPlay);
};

let unders = [...document.getElementsByClassName("under")];
const setBackgroundImageLoop = s => {
  if (!s) { setBackgroundImage(); s = imageCycleTime; }
  clearTimeout(setBackgroundImageLoop.timer);
  setBackgroundImageLoop.timer = timeout(1000*s, setBackgroundImageLoop);
};
const setBackgroundImage = (eltOrPath = $.player) => {
  if (!eltOrPath) return;
  if (typeof eltOrPath === "string") setBackgroundImageLoop(imageExplicitTime);
  else {
    const info = getInfo(eltOrPath).parent;
    if (!info.images) {
      info.images =
        info.children.filter(n => n.type === "image").map(n => n.path);
      info.curImages = [];
    };
    if (!info.images.length) eltOrPath = null;
    if (info.images.length === 1) eltOrPath = info.images[0];
    else {
      if (!info.curImages.length) info.curImages = shuffle(info.images);
      eltOrPath = info.curImages.pop();
    }
  }
  if (unders[0].src === new URL(eltOrPath, document.baseURI).href) return;
  unders[0].style.opacity = "";
  [unders[1], unders[0]] = [...unders];
  unders[0].src = eltOrPath || blankPNG;
  unders[0].style.opacity = 1.0;
};

const fadeTo = (tgtTime, cb) => {
  const [target, time] = isArray(tgtTime) ? tgtTime : [tgtTime, pauseFade];
  const fade = ()=> {
    const t = now();
    if ($player.paused || t >= end) {
      $player.volume = target;
      fadeTo.timer = null;
      if (cb) cb();
      return;
    }
    $player.volume = target + dir * (end - t) / (1000 * time);
    fadeTo.timer = timeout(1000/fadeToFreq, fade);
  };
  clearTimeout(fadeTo.timer);
  fadeTo.timer = timeout(1000/fadeToFreq, fade);
  const from = $player.volume, dir = from > target ? +1 : -1;
  const end  = now() + 1000 * time * abs(target - from);
};

$player.pausing = false; // made up field
const playerStop = ()=> {
  $player.pausing = false;
  if (!$player.info) return;
  if (!$player.paused) $player.pause();
  $player.currentTime = 0;
  $.player = null;
  playerButtonsPlaying(false);
  updateDisplays(null);
};
const playerPause = ()=> {
  $player.pausing = true;
  if (!$player.info) return;
  fadeTo(0, ()=> { $player.pausing = false; $player.pause(); });
};
const playerPlay = ()=> {
  $player.pausing = false;
  if (!$player.info) return play();
  if ($player.currentTime > 0) fadeTo($player.defaultVolume);
  else $player.volume = $player.defaultVolume;
  return audio.resume()
    .then(()=> $player.play())
    .then(visualizer.start)
    .catch(e => { if (e.code !== e.ABORT_ERR) throw e; });
};
const playerPlayPause = ({ ctrlKey }) =>
    ctrlKey                           ? playerStop()
  : $player.paused || $player.pausing ? playerPlay()
  :                                     playerPause();

$player.leftoverMove = null; // made up field
const doLeftoverMove = ()=> {
  if (!$player.leftoverMove) return;
  const t = $player.leftoverMove; $player.leftoverMove = null;
  playerMoveTo(t > 0 ? t : $player.duration + t);
};
const playerMoveTo = time => {
  if (!$player.info) return;
  if (time < 0) {
    $player.leftoverMove = time;
    playerNextPrev(false);
  } else if (isFinite($player.duration) && time > $player.duration) {
    $player.leftoverMove = time - $player.duration;
    playerNextPrev(true);
  } else {
    if (!beatMode.on) $player.currentTime = time;
    else fetchBeats($player.info).then(beats.moveTo(time));
  }
};
const playerMove = dir => ({ shiftKey, ctrlKey }) => {
  const delta = dir * (ctrlKey ? bigSkip : smallSkip)
                    / (shiftKey ? smallerSkipDiv : 1);
  if ($player.leftoverMove) $player.leftoverMove += delta;
  else playerMoveTo($player.currentTime + delta);
};

const playerNextPrev = down => {
  let item = $.player;
  if (!item) return;
  if (document.activeElement === $search && isMainItem(item)) {
    if (search.origin.elt === item || search.origin.type !== "audio")
      searchNext(1, loopMode.on);
    item = search.origin && search.origin.elt;
  } else {
    do { item = nextItem(item, down, { wrap: loopMode.on }); }
    while (item && item !== $.player && getInfo(item).type !== "audio");
  }
  play(item);
};

const playerButtonsPlaying = playing =>
  $("playerbuttons").classList.toggle("playing", playing);
$player.addEventListener("play",  ()=> playerButtonsPlaying(true));
$player.addEventListener("pause", ()=> playerButtonsPlaying(false));
$player.addEventListener("ended", ()=> playerNextPrev(true));
$player.addEventListener("loadeddata", doLeftoverMove);

$player.info = null; // made up field
const updateDisplays = info => {
  if ($player.info !== info) {
    $player.info = info;
    $player.src = info?.path || "";
  }
  $("wave-image").src =
    !info ? reddishPNG : "/images" + info.path.replace(/[.][^.]+$/, ".png");
  updateTimes();
  updateTrackInfo();
  if (!info) visualizer.clear();
};

// ---- navigation ------------------------------------------------------------

const isItem   = elt => elt.classList.contains("item");
const isHidden = elt => elt.offsetParent === null;
const isTop    = elt => elt === $main || elt === $plist;

const nextItem = (elt, down, opts = {}) => {
  const { wrap = true, sub = true, different = false } = opts;
  const [xSibling, xChild] =
    down ? [e => e.nextElementSibling,     e => e.firstElementChild]
         : [e => e.previousElementSibling, e => e.lastElementChild];
  const loopUp = elt =>
    !elt ? elt
    : isTop(elt) ? (wrap && loopDn(elt))
    : xSibling(elt) ? loopDn(xSibling(elt))
    : loopUp(elt.parentElement);
  const loopDn = elt =>
    !elt ? elt
    : isHidden(elt) ? loopUp(elt)
    : isItem(elt) ? elt
    : loopDn(xChild(elt));
  const start  = !sub && getInfo(elt).type === "dir" ? elt.parentElement : elt;
  const result = loopUp(start);
  return (!different || result !== start) ? result : null;
};

let timeRemaining = false;
$("times").addEventListener("click", ()=> timeRemaining = !timeRemaining);

// ---- navigation interactions -----------------------------------------------

const stopEvent = e => { e.preventDefault(); e.stopImmediatePropagation(); };

const selectNext = (elt = $.selected, n = 0, opts) => {
  const move = (opts?.move ?? false) && (n>0 ? "down" : "up");
  if (!elt) return;
  if (move && isMainItem(elt)) return;
  let result = null;
  while (n !== 0) {
    elt = nextItem(elt, n>0, opts);
    if (!elt) break; else result = elt;
    if (n > 0) n--; else n++;
  }
  if (!result) return;
  if (!move) {
    const inSearch = document.activeElement === $search;
    result.focus();
    if (inSearch) $search.focus();
    return;
  }
  const swap = result === result.parentElement.firstElementChild ? result
             : result === result.parentElement.lastElementChild  ? null
             : move === "up" ? result : result.nextElementSibling;
  result.parentElement.insertBefore($.selected, swap);
};
const selectEdge = (n, opts) =>
  selectNext(($.selected && !isMainItem($.selected)) ? $plist : $main, n, opts);

const expandDir = (info = getInfo($.selected), expand = "??", focus = true) => {
  let elt = info.elt, parent = elt.parentElement;;
  if (expand === "toggle")
    expand = parent.classList.contains("open")
             && !elt.nextElementSibling.classList.contains("only")
             ? false : "??";
  if (expand === "??")
    expand = info.size > autoExpandItems+1 || "deep";
  if (expand) {
    if (info.type !== "dir") return;
    if (parent.classList.contains("open"))
      elt.nextElementSibling.classList.remove("only");
    parent.classList.add("open");
    if (expand === "deep")
      [...parent.getElementsByClassName("list")].forEach(e =>
        e.classList.add("open"));
    if (focus) selectNext(elt, 1);
  } else {
    if (info.type !== "dir")
      elt = parent.previousElementSibling;
    else if (isHidden(elt.nextElementSibling))
      elt = parent.parentElement.previousElementSibling;
    parent = elt.parentElement;
    if (focus) elt.focus();
    parent.classList.remove("open");
    [...parent.getElementsByClassName("open")].forEach(e =>
      e.classList.remove("open"));
  }
};

const showOnly = (info = getInfo($.selected), focus = true) => {
  const elt0 = focusItemHandler(info.elt);
  if (info.type !== "dir") info = info.parent;
  let elt = info.elt;
  const toSelect = elt.parentElement.classList.contains("only")
                   && nextItem(elt, true);
  for (const e of new Set(["open", "only"]
                          .flatMap(c => [...$main.getElementsByClassName(c)])))
    e.classList.remove("open", "only");
  expandDir(info, U, focus);
  do {
    elt = elt.parentElement; elt.classList.add("open", "only");
    elt = elt.parentElement; elt.classList.add("only");
  } while (elt !== $main);
  if (!focus) return;
  if (toSelect) return toSelect.focus();
  const f = elt0 && nextItem(elt0, true); if (f) return f.focus();
};

const mainOrPlistOp = (e, elt = $.selected, info = getInfo(elt)) => {
  if (e.ctrlKey && info.type !== "dir" && info.type !== "audio")
    return info.type !== "otherbin" && window.open(info.path, "_blank");
  stopEvent(e);
  (e.ctrlKey ? plistOp : mainOp)(e, elt, info);
};

const mainOp = (e, elt = $.selected, info = getInfo(elt)) =>
    info.type === "dir" ? (e.shiftKey ? expandDir(U, "toggle") : showOnly(info))
  : info.type === "audio" ? play(elt)
  : info.type === "image" ? setBackgroundImage(info.path)
  : info.type === "other" ? window.open(info.path, "_blank")
  : undefined;

const bind = (keys, op, filter) =>
  (isArray(keys) ? keys : [keys]).forEach(k => {
    if (!bind.keys.has(k)) bind.keys.set(k, []);
    bind.keys.get(k).unshift({ op, filter });
  });
bind.keys = new Map();
bind.handler = e => {
  if (bind.prehook?.(e)) return;
  const bs = bind.keys.get(e.key) || bind.keys.get(e.code);
  if (!bs) return;
  for (const b of bs) {
    if (b.filter && !b.filter(e)) continue;
    stopEvent(e);
    return b.op(e);
  }
};
window.addEventListener("keydown", bind.handler);
const withCtrl  = e => e.ctrlKey;
const noCtrl    = e => !e.ctrlKey;
const noAlt     = e => !e.altKey;
const noCtrlAlt = e => !e.ctrlKey && !e.altKey;

const $help = document.createElement("pre");
$("help-text").append($help);
const help = (...lines) => $help.innerHTML += `<div class="entry">${
  lines.map(line =>
    line.replace(/[<>]/g, m => m === "<" ? "<key>" : "</key>"))
    .join("\n")
}</div>`;
bind("?", ()=> helpSel());

// ---- playlist --------------------------------------------------------------

const switchMain = ()=> $.altitem && $.altitem.focus();

const plistOp = (e, elt = $.selected, info = getInfo(elt), dragTo) => {
  if (elt === $main) return;
  const drag = e instanceof DragEvent && $drag;
  if (drag && !isMainItem(elt))
    return $plist.insertBefore($drag, dragTo);
  if (!isMainItem(elt)) {
    showOnly(info.parent);
    info.elt.focus();
    return;
  }
  const render = dragTo
    ? info => $plist.insertBefore(renderItem($plist, info, false), dragTo)
    : info => renderItem($plist, info, false);
  const add = info =>
    info.type === "dir"     ? info.children.forEach(add)
    : info.type !== "audio" ? U
    : $.player === info.elt ? $.player = $.altitem = render(info)
    : $.altitem             ? render(info)
    : $.player              ? $.altitem = render(info)
    :                         play($.altitem = render(info));
  add(info);
  if (e instanceof KeyboardEvent)
    selectNext(U, +1, { wrap: false, sub: false });
};

const plistDelete = backOrElt => {
  const [back, item] = backOrElt instanceof Element
                       ? [false, backOrElt] : [backOrElt, $.selected];
  if (!item || isMainItem(item)) return;
  const toDelete = back ? item.previousElementSibling : item;
  if (!toDelete) return;
  const newSel = back ? item
    : item.nextElementSibling || item.previousElementSibling || $.altitem;
  const [prev, next] = [false, true].map(d =>
    nextItem(toDelete, d, { different: true }));
  if (toDelete === $.player) {
    $.player = { previousElementSibling: prev, nextElementSibling: next };
    infoMap.set($.player, getInfo(toDelete));
  } else if ($.player && !($.player instanceof Element)) {
    if ($.player.nextElementSibling === toDelete)
      $.player.nextElementSibling = next;
    if ($.player.previousElementSibling === toDelete)
      $.player.previousElementSibling = prev;
  }
  toDelete.remove();
  newSel.focus();
  if (isMainItem(newSel)) $.altitem = null;
};

// ---- drag and drop ---------------------------------------------------------

let $drag = null;
const dragStart = e =>
  e.dataTransfer.setData("text/plain",
                         location.origin + getPath($drag = e.target));
const dragEnd = e => $drag = null;

const addDragEvents = (elt, op, dragOK = null) => {
  let count = 0;
  const YtoElt = e => {
    if (e.target !== $plist) {
      return e.offsetY >= e.target.offsetHeight/2
             ? e.target.nextElementSibling : e.target;
    } else {
      const fst = $plist.firstElementChild;
      if (fst && e.offsetY <= fst.offsetTop) return fst;
      return null;
    }
  };
  const dragHandle = handler => e =>
    $drag && (!dragOK || dragOK(e)) && (stopEvent(e), handler(e));
  let oLast = 0;
  elt.addEventListener("dragover", dragHandle(e => {
    if (elt !== $plist) return;
    if (e.timeStamp - oLast <= 100) return; else oLast = e.timeStamp;
    const di = YtoElt(e);
    if (di) { $.dragitem = di; $.dragitem.classList.remove("bottom"); }
    else if ($.dragitem = $plist.lastElementChild)
      $.dragitem.classList.add("bottom");
    if (di === $plist.firstElementChild)     plist.scrollTop -= 1;
    else if (di === $plist.lastElementChild) plist.scrollTop += 1;
  }));
  elt.addEventListener("dragenter", dragHandle(e =>
    count++ === 0 && elt.classList.add("drag-to")));
  elt.addEventListener("dragleave", dragHandle(e =>
    --count === 0 && elt.classList.remove("drag-to")));
  elt.addEventListener("drop", dragHandle(e => {
    count = 0; elt.classList.remove("drag-to");
    op(e, $drag, U, elt === $plist ? YtoElt(e) : U);
    $drag = null;
    $.dragitem = null;
  }));
};

addDragEvents($("control-panel"), mainOp);
addDragEvents($plist, plistOp);
addDragEvents($main, (e, d) => plistDelete(d), e => !isMainItem($drag));

// ---- toggles ---------------------------------------------------------------

const mkToggle = (id, cb = null, opts = {}) => {
  const elt = $(id);
  const toggle = e => {
    if (opts.preHandler?.(e)) return;
    elt.classList.toggle("on", (toggle.on = !toggle.on));
    if (!opts?.noMessage) message(`${elt.title}: ${toggle.on ? "on" : "off"}`);
    if (cb) cb(toggle.on);
  };
  toggle.on = elt.classList.contains("on");
  elt.addEventListener("click", toggle);
  return toggle;
};
const deviceSel  = mkToggle("device", on => {
  if (on) audio.device.populateSelector();
  showOverlay($("select-device"), on, deviceSel);
}, { noMessage: true });
const helpSel  = mkToggle("help", on =>
  showOverlay($("help-text"), on, helpSel),
  { noMessage: true });
const loopMode   = mkToggle("loop");
const bigvizMode = mkToggle("bigviz", on =>
  document.documentElement.classList.toggle("bigviz", on));
const flashyMode = mkToggle("flashy",
  on => document.body.classList.toggle("flashy", on),
  { preHandler: e => e?.shiftKey && (mkFlashyWindow(), true) });
const beatMode   = mkToggle("beatmode");

// ---- overlays --------------------------------------------------------------

const showOverlay = (elt, on = true, offOp = null) => {
  if (elt.classList.contains("on") === on) return;
  if (on && showOverlay.off) showOverlay.off();
  elt.classList.toggle("on", on);
  $("overlay-bg").classList.toggle("on", on);
  showOverlay.off = !on ? null
    : offOp || (()=> showOverlay(elt, false));
};
$("overlay-bg").addEventListener("click", ()=> showOverlay.off?.());

// ---- generic escape handler ------------------------------------------------

const escapeHandler = ()=> {
  if (showOverlay.off) return showOverlay.off();
  if (flashyMode.on) return flashyMode();
  if (bigvizMode.on) return bigvizMode();
};
bind("Escape", escapeHandler);
document.querySelectorAll(".under").forEach(u =>
  u.addEventListener("click", escapeHandler));

// ---- player interactions ---------------------------------------------------

bind("Enter", mainOrPlistOp, noAlt);
help(`<⏎>: play selected track or open selected file`,
     `  dir: sublist focus, shift: toggle`,
     `  ctrl: add to playlist and play, playlist: reveal and focus track`);
bind("Tab", switchMain, noCtrlAlt);
help(`<⇥>: switch between main and playlist panes`);

const initiateSearch = e => {
  if (e) $search.value = e.key; else $search.select();
  $search.focus(); }
bind("/", ()=> initiateSearch(), noCtrlAlt);
help(`</>: start a full search`);

bind(["Backspace", "Delete"], e => plistDelete(e.key === "Backspace"));
help(`<⌫>⋅<⌦>: remove track from playlist`);

bind("+", ()=> expandDir(U, true),   noCtrlAlt);
bind("-", ()=> expandDir(U, false),  noCtrlAlt);
bind("*", ()=> expandDir(U, "deep"), noCtrlAlt);
help(`<+>⋅<*>⋅<->: subdir expand / deep-expand / close`);

bind("\\", bigvizMode);
help(`<\\>: big visualization mode`,
     `  ctrl: next visualization, ctrl+shift: next submode`);
bind("|",  ()=> flashyMode()); // | uses shift: avoid a new window
help(`<|>: color flashing mode`);
bind(".",  beatMode);
help(`<.>: beat movement mode`);

bind("ArrowUp",   e => selectNext(U, -1, { move: e.ctrlKey }));
bind("ArrowDown", e => selectNext(U, +1, { move: e.ctrlKey }));
bind("PageUp",    e => selectNext(U, -pgSize, { wrap: false, move: e.ctrlKey }));
bind("PageDown",  e => selectNext(U, +pgSize, { wrap: false, move: e.ctrlKey }));
bind("Home",      e => selectEdge(+1, { move: e.ctrlKey }));
bind("End",       e => selectEdge(-1, { move: e.ctrlKey }));
help(`<⇧>⋅<⇩>⋅<⇞>⋅<⇟>⋅<⇱>⋅<⇲>: list navigation`,
     `  ctrl: move playlist track`);

bind([" ", "Numpad5"], playerPlayPause);
help(`<Spc>⋅<Pad5>: play / pause`);
bind("ArrowLeft",      playerMove(-1));
bind("ArrowRight",     playerMove(+1));
help(`<⇦>⋅<⇨>: move in track (5s)`,
     `  ctrl: big skip (1m)`,
     `  shft: small skip (½)`);
[[null,      "p-pause", "pause",         playerPause],
 [null,      "p-play",  "play",          playerPlay],
 [null,      "p-stop",  "stop",          playerStop],
 ["Numpad4", "p-prev",  "previoustrack", ()=> playerNextPrev(false)],
 ["Numpad6", "p-next",  "nexttrack",     ()=> playerNextPrev(true)],
 ["Numpad1", "p-rew",   "seekbackward",  playerMove(-2)],
 ["Numpad3", "p-fwd",   "seekbackward",  playerMove(+2)],
].forEach(([key, id, media, handler]) => {
  if (key)   bind(key, handler);
  if (id)    $(id).addEventListener("click", handler);
  if (media) navigator.mediaSession.setActionHandler(media, handler);
});
help(`<Pad4>⋅<Pad6>: next / prev track`);
help(`<Pad1>⋅<Pad3>: big move (×2)`);

const markers = new Map();
const markerJump = e => {
  const { key, code, ctrlKey: ctrl } = e;
  const n = +e.code.substring(code.length-1);
  if (ctrl) {
    let m = markers.get($player.info);
    if (!m) markers.set($player.info, m = new Array(10));
    const target = $player.currentTime - 0.015; // reaction time
    m[n] = beatMode.on && beats.nextBeatTime(target) || $player.currentTime;
  } else { // defaults to a spread of 10 markers (youtube-style)
    const newTime =
      markers.get($player.info)?.[n]
      || (isFinite($player.duration) ? n * $player.duration / 10
          : $player.currentTime);
    playerMoveTo(newTime);
  }
};
bind("0123456789".split("").map(d => "Digit"+d), markerJump);
help(`<1>⋅<2>⋅…⋅<0>: move to percentage`,
     `  ctrl: set marker`);

$player.defaultVolume = 1; // made up field
const $volume = $("volume"), $volumeMax = +$volume.max;
$volume.value = $volumeMax;
const updateVolume = v => {
  const vol = clip01(v / $volumeMax);
  fadeTo($player.defaultVolume = vol);
  $volume.value = round($volumeMax * vol);
  message(`${$volume.title}: ${padL(round(vol*100), 3)}%`);
};
$volume.addEventListener("input", ()=> updateVolume(+$volume.value));
$volume.addEventListener("mousedown", e =>
  e.button === 1 && updateVolume($volumeMax));
$volume.addEventListener("wheel", e => {
  stopEvent(e); updateVolume(+$volume.value + wheelToN(e, -1, 2, 0)); });
bind("Numpad8", ()=> updateVolume(+$volume.value + 1), noCtrl);
bind("Numpad8", ()=> updateGain(+$gain.value + 0.25),  withCtrl);
bind("Numpad2", ()=> updateVolume(+$volume.value - 1), noCtrl);
bind("Numpad2", ()=> updateGain(+$gain.value - 0.25),  withCtrl);
help(`<Pad8>⋅<Pad2>: volume up / down`,
     `  ctrl: gain up / down`);

$player.defaultPlaybackRate = 1;
const $rate = $("rate"), $rateMax = +$rate.max;
$rate.value = $rateMax / 2;
const rateFracs = "0 ⅛ ¼ ⅜ ½ ⅝ ¾ ⅞ 1 1⅛ 1¼ 1⅜ 1½ 1⅝ 1¾ 1⅞ 2".split(" ");
const updateRate = r => {
  const rate = clip01(r / $rateMax) + 0.5;
  $player.preservesPitch = false;
  $player.defaultPlaybackRate = $player.playbackRate = rate;
  $rate.value = round($rateMax * (rate - 0.5));
  const frac = rateFracs[round(rate*8)];
  message(`${$rate.title
    }: <span style="display: inline-block; width: 1.25em;">${frac}</span>`);
};
$rate.addEventListener("input", ()=> updateRate(+$rate.value));
$rate.addEventListener("mousedown", e =>
  e.button === 1 && updateRate($rateMax/2));
$rate.addEventListener("wheel", e => {
  stopEvent(e); updateRate(+$rate.value + wheelToN(e, -1, 2, 0)); });
bind(["Numpad9", ">", "]"], ()=> updateRate(+$rate.value + 1));
bind(["Numpad7", "<", "["], ()=> updateRate(+$rate.value - 1));
bind(["="], ()=> updateRate($rateMax/2));
help(`<Pad7>⋅<Pad9>⋅<=>: slower / faster / normal playback`);

const $gain = $("gain"), $gainMax = +$gain.max;
$gain.value = 1;
const updateGain = g => {
  const gain = round(clip01(g / $gainMax) * 4 * $gainMax) / 4;
  audio.setGain(gain);
  $gain.value = gain;
  message(`${$gain.title}: ${gain.toFixed(2)}`);
};
$gain.addEventListener("input", ()=> updateGain(+$gain.value));
$gain.addEventListener("mousedown", e => e.button === 1 && updateGain(1));
$gain.addEventListener("wheel", e => {
  stopEvent(e); updateGain(+$gain.value + wheelToN(e, -0.25, 1, 0)); });

// mouse wheel for convenient song navigation
$("control-panel").addEventListener("wheel", e =>
  playerMove(wheelToN(e, 0.5, 1, U))(e));

// ---- time display ----------------------------------------------------------

const updateTimes = ()=> {
  const $dur = $("dur"), $time = $("time");
  const formatTime = t => floor(t/60) + ":" + padL(abs(t) % 60, 2, "0");
  if (!isFinite($player.duration) || !$.player) {
    updateTimes.shownTime = null;
    updateTimes.shownPath = null;
    $dur.innerText = $time.innerText = "–:––";
    drawPlayerLine(null);
    beats.update(null);
    return;
  }
  const path = $player.info?.path || "";
  if (updateTimes.shownPath !== path && $player.duration) {
    updateTimes.shownPath = path;
    $dur.innerText = formatTime(round($player.duration));
  }
  let t = $player.currentTime, d = $player.duration;
  drawPlayerLine(t / d);
  beats.update(t);
  if (timeRemaining) t = d - t;
  t = round(t);
  if (updateTimes.shownTime !== t) {
    updateTimes.shownTime = t;
    $time.innerText = (timeRemaining ? "-" : "") + formatTime(t);
  }
};

// ---- info display ----------------------------------------------------------

const infoDisplay = (()=>{
  const infoDiv = $("track-info"), textDiv = infoDiv.firstElementChild;
  const START = 0, END = 1, CLEARSTART = 2, CLEAREND = 3, NEWTEXT = 4;
  let initialized = false, state = START, newText = "", moveTo = 0;
  //
  const move = (x, st, { time = tickerTime, text = U, fun = U } = {}) => {
    if (text !== U) {
      textDiv.innerText = text;
      moveTo = infoDiv.offsetWidth - textDiv.scrollWidth;
    }
    if (textDiv.innerText === "" && state === NEWTEXT) return;
    textDiv.style.transition = `left ${time}s ${fun || "ease-in-out"}`;
    textDiv.style.left = `${x}px`;
    state = st;
    if (time <= 0) timeout(100, done);
  };
  //
  const transition = [];
  transition[START]      = ()=> move(0, END);
  transition[END]        = ()=> move(moveTo, START);
  transition[NEWTEXT]    = ()=> move(0, END,
                                     { time: tickerSwapTime, fun: "ease-out" });
  transition[CLEARSTART] = ()=> move(-(textDiv.scrollWidth+1), CLEAREND,
                                     { time: tickerSwapTime, fun: "ease-in" });
  transition[CLEAREND]   = ()=> move(infoDiv.offsetWidth, NEWTEXT,
                                     { time: 0, text: newText });
  const done = ()=> transition[state]();
  //
  if (!initialized) {
    initialized = true;
    textDiv.addEventListener("transitionend", done);
  }
  //
  return str => { state = CLEARSTART; newText = str; done(); };
})();

const updateTrackInfo = ()=> {
  if (!$player.info) return infoDisplay("");
  const info = $.player && getInfo($.player), sep = " • ";
  let text = "";
  if (info) {
    text += info.title || info.name;
    text += sep;
    text += info.album || info.parent.name;
    if (info.track) text += ` (#${info.track})`;
    if (info.date)  text += `, ${info.date}`;
    text += sep;
    text += info.artist || info.parent.parent?.name || "???";
  }
  infoDisplay(text);
};

// ---- waveform control ------------------------------------------------------

const drawPlayerLine = (()=>{
  const $needle = $("wave-needle");
  const half = $needle.computedStyleMap().get("width").value / 2;
  let shown = true;
  return loc => {
    if (loc === null) {
      if (shown) { shown = false; $needle.style.display = "none"; }
    } else {
      if (!shown) { shown = true; $needle.style.display = ""; }
      const pos = $needle.parentElement.clientWidth * loc - half;
      $needle.style.left = `${pos}px`;
    }
  };
})();
// not needed, since it's called more frequently by updateTimes()
// $player.addEventListener("timeupdate", drawPlayerLine);

const $wave = $("wave");
$wave.addEventListener("mousedown", e => {
  const move = e => {
    const dur = $player.duration;
    if (isNaN(dur)) return;
    const rect = $wave.getBoundingClientRect();
    playerMoveTo(dur * clip01((e.clientX-rect.left) / rect.width));
    updateTimes();
  };
  stopEvent(e);
  const up = e => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  move(e);
});

// ---- search function -------------------------------------------------------

const mkSearcher = str => {
  const escape = str => str.replace(/[.*+?^${}()|\[\]\\]/g, "\\$&");
  const rx = RegExp(
    [...str.trim().matchAll(/\w+|\W/g)]
      .map(m => m[0]).filter(s => s !== " ")
      .map(s => s.length === 1 ? escape(s) : s.split("").join("\\w*"))
      .join(".*"));
  return inp => rx.test(inp);
};
/*
(()=>{
  let n = 0, sec = "", fails = [], ok = ()=>{};
  const js = JSON.stringify;
  const test = res => str =>
    (n++, !!ok(str) === res || fails.push(
      `${n} ${sec} > ${res ? "t" : "f"}(${js(str)})`));
  const t = test(true);
  const f = test(false);
  const search = (...xs) => {
    sec = `search(${xs.map(js).join(", ")})`, ok = mkSearcher(...xs); };
  search("");
  t("");
  t("/");
  t(" ");
  t("foo");
  t("/foo");
  t("/foo/");
  search("foo");
  t("foo");
  t("/foo");
  t("foo/");
  t("/foo/");
  t("foooo");
  t("fxoxo");
  t("fxxxoxxxo");
  t("xfxoxox");
  f("oof");
  search(" foo  bar ");
  t("foo bar");
  f("foo");
  f(" bar foo ");
  f("barfoo");
  t("foobar");
  f("bafoor");
  f("fobaro");
  f("fboaor");
  f("bfaoro");
  t("foo.bar");
  f("bar.foo");
  f("rab oof");
  t("foo-bar");
  t("foo/bar");
  t("foo / bar");
  t("/foo bar");
  f("bar foo/");
  t("foo bar/");
  f("///bar foo///");
  t("///foo bar///");
  f("///bar/foo///");
  t("///foo/bar///");
  search(" / foo  bar ");
  f("foo bar");
  f(" foo bar ");
  t("/foo bar");
  t("/ foo bar ");
  f("/ bar foo ");
  t(" / foo bar ");
  f(" / bar foo ");
  t("/foobar");
  f("/barfoo");
  t("/foobar");
  t("/xfooxbarx");
  f("/xbfaxorox");
  t("/foo.bar");
  f("/bar.foo");
  f("/rab oof");
  t("/foo // bar/");
  search(" / foo  bar / ");
  f("foo bar");
  f(" foo bar ");
  f("/foo bar");
  f("/foo/bar");
  t("/foo/bar/");
  f("/bar/foo/");
  t("/foo/bar/xxx");
  f("/bar/foo/xxx");
  t("/foo/bar/x/x/x/");
  f("/bar/foo/x/x/x/");
  t(" / foo / bar / ");
  t("/fxoxo/bxaxr/");
  t("/foo//bar/");
  t("///foo///bar///");
  search("/foo/bar/");
  t("/foo/bar/");
  f("/bar/foo/");
  t("/foo/bar/x");
  t("/foo/bar/x/x");
  f("/foo/bar");
  search("/foo//bar");
  f("/foo/bar");
  f("/foo/bar/");
  t("/foo//bar");
  t("/foo//bar/");
  t("/foo///bar");
  t("/foo///bar/");
  t("/foo/x/bar");
  t("/foo/x/bar/");
  t("/foo/x/x/bar");
  t("/foo/x/x/bar/");
  if (fails.length)
    console.error([`${fails.length}/${n} tests failed:`, ...fails]
                  .join("\n  "));
  else
    console.log(`${n} tests passed.`);
})();
*/

// ---- search UI -------------------------------------------------------------

const $search = $("search");

const showSearch = (origin = search.origin) => {
  if (!origin) origin = getInfo($.selected);
  let n0 = search.origin = origin;
  $search.classList.remove("found", "not-found");
  if (!search.ok) return removeSearch();
  if (n0.type !== "audio") n0 = n0.nexta;
  const ok = search.ok, fst = all.nexta;
  let n = n0, results = [], later;
  do {
    if (n === fst) { later = results; results = []; }
    const r = ok(n.search);
    n.elt.classList.toggle("found", r);
    if (r) results.push(n);
  } while ((n = n.nexta) !== n0);
  later.forEach(x => results.push(x));
  $search.classList.add(results.length > 0 ? "found" : "not-found");
  search.results = results;
  search.cur = (results.length - later.length) % results.length;
  showCurSearch();
};

// const nextSearchTrack = down => {
//   if (!search.ok || !$.player) return;
//   const len = search.results.length;
//   if (len === 0) return;
//   const cur = search.results.indexOf(getInfo($.player));
//   if (cur >= 0) return search.results[mod(cur + (down ? +1 : -1), len)].elt;
//   if (search.origin && search.origin.type === "audio")
//     return search.origin.elt;
//   return search.results[0].elt;
// };

const searchNext = (delta, wrap = true) => {
  if (!search.ok) return;
  const len = search.results.length;
  if (len === 0) return;
  if (wrap) search.cur = mod(search.cur + delta, len);
  else {
    search.cur += delta;
    if (search.cur < 0 || search.cur >= len) search.cur = null;
  }
  search.origin = showCurSearch();
};

const showCurSearch = ()=> {
  const len = search.results.length;
  if (len === 0 || search.cur === null) {
    $("result-number").innerText = "";
    return null;
  }
  const cur = search.results[search.cur];
  isHidden(cur.elt) ? showOnly(cur, false) : focusItemHandler(cur.elt);
  scrollIntoView(cur.elt);
  $("result-number").innerText = (search.cur + 1) + "/" + len;
  return cur;
};

const removeSearch = ()=> {
  search.results.forEach(n => n.elt.classList.remove("found"));
  $("result-number").innerText = "";
};

const search = e => {
  if (e.type === "blur") {
    if (e.relatedTarget) { search.blurTime = null; return removeSearch(); }
    else { search.blurTime = e.timeStamp; return $search.focus(); }
  }
  if (e.type === "focus") {
    if (search.blurTime && (e.timeStamp - search.blurTime) < 200)
      return search.blurTime = null;
    showSearch(getInfo($.selected));
    if (!search.initial) return;
    $search.value = search.initial; search.initial = null;
  }
  const searchStr = $search.value.toLowerCase().trim().replace(/\s+/g, " ");
  if (search.last === searchStr) return; else search.last = searchStr;
  const searchStrs = searchStr.split(" ");
  search.ok = searchStr === "" ? null : mkSearcher(searchStr);
  clearTimeout(search.timer);
  search.timer = timeout(300, showSearch);
};
search.results = [];

const searchKey = e => {
  const { key, code, shiftKey: shift, ctrlKey: ctrl } = e;
  if (key === "Enter") { $.selected.focus(); return; }
  if (code === "Backslash" || code.startsWith("Numpad")
      || ((shift || ctrl) && (key === " " || code.startsWith("Digit"))))
    return;
  e.stopImmediatePropagation();
  if (["Escape", "Tab"].includes(key)) $.selected.focus();
  else if (key === "ArrowUp")   searchNext(-1);
  else if (key === "ArrowDown") searchNext(+1);
  else if (key === "PageUp")    searchNext(-pgSize, false);
  else if (key === "PageDown")  searchNext(+pgSize, false);
  else return;
  e.preventDefault();
};

$search.addEventListener("focus", search);
$search.addEventListener("blur",  search);
$search.addEventListener("input", search);
$search.addEventListener("keydown", searchKey);

// ---- quick search ----------------------------------------------------------

{
  let curItems = null, startItem = null, curStr = "";
  let searchTimer = null, exitTimer = null;
  const quickSearch = (str = curStr) => {
    str = str.toLowerCase();
    const r = new Range(); let first = null;
    if (curItems) clear();
    curItems = [];
    const items = visibleItems(), start = items.indexOf(startItem);
    if (start > -1)
      items.push(...items.splice(0, (start + 1) % items.length));
    for (const search of [
      `^${str}`, `\\b${str}`, `${str}`, // beginning, word start, anywhere
      str.split(/ +/).map(w => w.split("").join("[^ ]*")).join(".*"), // words
      str.split("").join(".*?"),                                   // anything
    ]) {
      const rx = new RegExp(search, "id");
      items.forEach(item => {
        const p = rx.exec(getInfo(item).name)?.indices[0];
        if (!p) return;
        const children = item.childNodes;
        if (children.length !== 1 || children[0].nodeType !== Node.TEXT_NODE)
          throw Error(`unexpected childNodes`);
        const c = children[0];
        curItems.push(item);
        r.setStart(c, p[0]); r.setEnd(c, p[1]);
        r.surroundContents(document.createElement("mark"));
        if (!first) first = item;
      });
      if (first) return focusOn(first);
    }
  };
  const focusOn = elt => {
    scrollIntoView(elt);
    elt.focus();
  };
  const clear = ()=> {
    curItems?.forEach(item =>
      item.replaceChildren(document.createTextNode(getInfo(item).name)));
    curItems = null;
  };
  const delayExit = ()=> {
    clearTimeout(exitTimer);
    exitTimer = timeout(2000, doStop);
  }
  const doKey = key => {
    curStr = key === "DEL" ? curStr.slice(0,-1)
             : curStr + (key === "-" ? "–" : key);
    clearTimeout(searchTimer);
    searchTimer = timeout(300, ()=> {
      if (curStr === "") return doStop();
      quickSearch();
      delayExit();
    });
    return true;
  };
  const moveNext = delta => {
    delayExit();
    focusOn(curItems[mod(curItems.indexOf($.selected) + delta,
                         curItems.length)]);
    startItem = $.selected;
    return true;
  };
  const delKeys    = "Backspace Delete".split(" ");
  const ignoreKeys =
    "Shift Control Alt Meta CapsLock NumLock ScrollLock".split(" ");
  const handler = e => {
    const { key } = e;
    e.preventDefault();
    if (curItems?.length && curItems.length > 1) { // moves w/ multiple matches
      if (key === "ArrowUp")   return moveNext(-1);
      if (key === "ArrowDown") return moveNext(+1);
    }
    if (delKeys.includes(key))          return doKey("DEL");
    if (ignoreKeys.includes(key))       return;
    if (/^[ \-\p{L}\p{N}]$/u.test(key)) return doKey(key);
    // anything else terminates the search and used normally
    doStop();
    return false;
  };
  const doStart = ({ key }) => {
    curStr = "";
    startItem = $.selected;
    doKey(key);
    bind.prehook = handler; // start won't be called too!
  };
  const doStop = ()=> {
    clearTimeout(searchTimer);
    clearTimeout(exitTimer);
    curStr = "";
    startItem = null;
    clear();
    bind.prehook = null;
  };
  bind("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(l => "Key"+l),
       doStart, noCtrlAlt);
}
help(`<A>⋅<B>⋅…⋅<Z>: quick search visible items`);

// ---- device switching ------------------------------------------------------

const makeDeviceSwitcher = ()=> {
  const getDevices = async ()=> {
    await navigator.mediaDevices.getUserMedia({ audio: true }); // permission
    return (await navigator.mediaDevices.enumerateDevices())
      .filter(d => d.kind === "audiooutput");
  };
  const list = ()=>
    getDevices().then(ds => ds.forEach(d =>
      console.log(`${d.label} (${d.deviceId})`)));
  let devAudio = null, devDest = null;
  const use = async idOrName => {
    const findDevice = async p =>
      (findDevice.list ??= await getDevices()).find(p);
    const d =
      !idOrName || idOrName === "default" ? null
      : (await findDevice(d => d.deviceId === idOrName)
         || await findDevice(d =>
              d.label.toLowerCase().includes(idOrName.toLowerCase())))
    if (d === undefined) throw Error(`No "${idOrName}" device found`);
    // doesn't work when it's a source in `createMediaElementSource`
    //   (https://github.com/w3c/mediacapture-output/issues/87)
    // await $player.setSinkId(d.deviceId);
    if (!devAudio === !!d) {
      if (devAudio) {
        audio.out.disconnect(devDest);
        audio.out.connect(audio.ctx.destination);
        devAudio = null;
      } else {
        devAudio = new Audio();
        devDest = audio.ctx.createMediaStreamDestination();
        devAudio.srcObject = devDest.stream;
        audio.out.disconnect(audio.ctx.destination);
        audio.out.connect(devDest);
        devAudio.play();
      }
    }
    console.log(`Connecting to ${d ? d.label : "default"}`);
    if (d) devAudio.setSinkId(d.deviceId);
  };
  let devices = null;
  $("select-device").addEventListener("click", e => {
    e.stopPropagation();
    const id = e.target.dataset?.id;
    if (id) { use(id); deviceSel(); }
  });
  const populateSelector = async ()=> {
    devices ??= await getDevices();
    $("select-device").innerHTML = `<div>${
      devices.map(d => `<a data-id="${d.deviceId}">${d.label}</a>`).join("")
    }</div>`;
  };
  return { list, use, populateSelector };
};

// ---- audio wiring ----------------------------------------------------------

const SIDES = [0, 1];
const audio = (()=>{
  const c = new AudioContext({ latencyHint: "playback" });
  const src = c.createMediaElementSource($player);
  const gain = c.createGain();
  src.connect(gain);
  gain.connect(c.destination);
  const setGain = g => gain.gain.value = g;
  // experimental effects to play with (see the "experiments" directory)
  const effectNodes = []; // nodes between src and gain
  const effects = {
    append: node => {
      const last = effectNodes.length ? effectNodes[effectNodes.length-1] : src;
      last.disconnect(gain);
      last.connect(node);
      node.connect(gain);
      effectNodes.push(node);
    },
    prepend: node => {
      const first = effectNodes.length ? effectNodes[0] : gain;
      src.disconnect(first);
      src.connect(node);
      node.connect(first);
      effectNodes.unshift(node);
    },
    clear: ()=> {
      if (effectNodes.length === 0) return;
      let last = src;
      for (const node of effectNodes) { last.disconnect(node); last = node; }
      effectNodes.length = 0;
      last.disconnect(gain);
      src.connect(gain);
    },
    set: (...nodes) => {
      effects.clear();
      if (nodes.length === 0) return;
      src.disconnect(gain);
      let last = src;
      for (const node of nodes) { last.connect(node); last = node; }
      last.connect(gain);
      effectNodes.push(...nodes);
    }
  };
  //
  return {
    ctx: c, out: gain, resume: c.resume.bind(c), setGain, effects,
    device: makeDeviceSwitcher(),
  };
})();

// ---- visualizations --------------------------------------------------------

const SimpleViz = ($c, c, fade) => {
  const analyzers = mkAnalyzers(audio.out);
  const bufLen = analyzers[0].frequencyBinCount, aData = new Uint8Array(bufLen);
  let vol1 = 0, vol2 = 0;
  let submode = SimpleViz.submode ?? 3;
  const nextSubmode = ()=> {
    submode = SimpleViz.submode = mod(submode + 1, 4);
    message(["None", "FFT", "Wave", "FFT+Wave"][submode]);
  };
  const destroy = ()=> analyzers.destroy();
  //
  const draw = ()=> {
    fade("#0003");
    const W = $c.width, H = $c.height, w = W / bufLen / 2;
    let avg1 = 0, avg2 = 0;
    // fft
    const c1 = hsl(-80*vol2, 100, 75*vol1,     75); // values from
    const c2 = hsl( 80*vol2, 100, 75*vol1+25, 100); // last round
    for (const side of SIDES) {
      analyzers[side].getByteFrequencyData(aData);
      if (!(submode & 1)) {
        for (let i = 0; i < bufLen; i++) avg1 += aData[i];
      } else {
        const d = side === 0 ? -1 : +1;
        for (let i = 0, x = W / 2; i < bufLen; i++, x += d*w) {
          avg1 += aData[i];
          const rx = round(x), rw = round(d*w+d);
          const barHeight = aData[i] * H / 256;
          c.fillStyle = c1;
          c.fillRect(rx, (H-barHeight) / 2, rw, barHeight);
          const inner = barHeight/4 - 10;
          if (inner > 0) {
            c.fillStyle = c2;
            c.fillRect(rx, H/2 - inner, rw, 2*inner);
          }
        }
      }
    }
    avg1 = clip01(avg1 / bufLen / 2 / 128);
    // wave
    c.strokeStyle = "#8f4f"; c.lineWidth = bigvizMode.on ? 4 : 2;
    c.lineJoin = "bevel"; c.lineCap = "round";
    for (const side of SIDES) {
      analyzers[side].getByteTimeDomainData(aData);
      if (!(submode & 2)) {
        for (let i = 0; i < bufLen; i++) avg2 += abs(aData[i] - 128);
      } else {
        const d = side === 0 ? -1 : +1;
        c.beginPath();
        for (let i = 0, x = W / 2; i < bufLen; i++, x += d*w) {
          avg2 += abs(aData[i] - 128);
          const y = aData[i] * H / 256;
          c.lineTo(x, y);
        }
        c.stroke();
      }
    }
    avg2 = clip01(avg2 / bufLen / 2 / 64);
    //
    return [vol1 = avg1, vol2 = avg2];
  };
  return { draw, destroy, nextSubmode };
};

const CQTViz = ($c, c, fade) => {
  // https://github.com/mfcc64/showcqt-js#example-code
  let bar_v = 16, sono_v = 50, wfall = CQTViz.wfall ?? 0.5, curWfall = 0;
  const waterfalls = [0, 0.5, 1, 2]
  const nextSubmode = ()=> {
    wfall = CQTViz.wfall = arrNext(waterfalls, wfall);
    fadeRate = (255/H2)*wfall; // see fading below
    message(`Waterfall: ${wfall || "none"}`);
  };
  let W = 0, H = 0, W4 = 0, H2 = 0, fadeRate = 0, curFade = 0;
  let iBuf = null, showcqt = null, analyzers = null;
  const init = ()=> {
    analyzers?.destroy();
    W = $c.width, H = $c.height, W4 = 4*W, H2 = Math.floor(H/2);
    fadeRate = (255/H2)*wfall; // see fading below
    iBuf = c.createImageData(W, H);
    ShowCQT.instantiate().then(cqt => {
      showcqt = cqt;
      showcqt.init(audio.ctx.sampleRate, W, H2, bar_v, sono_v, 1);
      analyzers = mkAnalyzers(audio.out, {
        ...analyzerSettings, fftSize: showcqt.fft_size
      });
    });
  };
  init();
  const destroy = ()=> analyzers.destroy();
  //
  const draw = ()=> {
    if (!showcqt) return;
    if ($c.width !== W || $c.height !== H) return init(); // let it initialize
    // fade out, based on how fast is the waterfall and the height
    if (wfall && (curFade += fadeRate) >= 1) {
      const fade = Math.floor(curFade);
      curFade -= fade;
      for (let i = 3; i < iBuf.data.length; i += 4) iBuf.data[i] -= fade;
    }
    for (const side of SIDES)
      analyzers[side].getFloatTimeDomainData(showcqt.inputs[side]);
    showcqt.calc();
    const outLine = showcqt.output;
    // vol1/vol2: use the average amplitude of the lower and upper halves
    let vol1 = 0, vol2 = 0, len = outLine.length;
    for (let i = 3; i < len; i += 4)
      if (i < len/2) vol1 += outLine[i]; else vol2 += outLine[i];
    vol1 = clip01(vol1 / (len/8) / 255);
    vol2 = clip01(vol2 / (len/8) / 255);
    //
    for (let y = 0; y < H2; y++) {
      showcqt.render_line_opaque(y);
      for (let i = 0; i < W4; i += 4)
        outLine[i+3] = Math.max(outLine[i+0], outLine[i+1], outLine[i+2]);
      iBuf.data.set(outLine, W4 * y);
      if (!wfall) iBuf.data.set(outLine, W4 * (H - 2 - y));
    }
    if (wfall && (curWfall += wfall) >= 1) {
      const wfall = Math.floor(curWfall);
      curWfall -= wfall;
      const src = W4 * (H2 - wfall);
      iBuf.data.copyWithin(W4 * H2, src, W4 * (H - wfall));
    }
    c.putImageData(iBuf, 0, 0);
    // This mirrors the RHS onto the LHS
    // c.scale(-1,1);
    // c.clearRect(0, 0, W, H);
    // c.drawImage($c, W, 0, W, H, -W, 0, W, H);
    // c.scale(1,1);
    return [vol1, vol2];
  };
  return { draw, destroy, nextSubmode };
};

const mkAnalyzers = (signal, opts = analyzerSettings) => {
  const splitter = audio.ctx.createChannelSplitter(2);
  signal.connect(splitter);
  const as = SIDES.map(i => {
    const a = audio.ctx.createAnalyser();
    Object.assign(a, opts);
    splitter.connect(a, i);
    return a;
  });
  as.destroy = ()=> {
    signal.disconnect(splitter);
    as.forEach(a => a.disconnect());
  }
  return as;
};

const visualizer = (()=>{
  const r = {};
  const $c = $("visualization");
  const vizListeners = new Set();
  r.addListener = l => vizListeners.add(l);
  r.delListener = l => vizListeners.delete(l);
  $c.addEventListener("click", bigvizMode);
  const c = $c.getContext("2d");
  const clear = r.clear = ()=> {
    c.clearRect(0, 0, $c.width, $c.height);
    r.vol = 0; r.col = "black";
    vizListeners.forEach(l => l());
  };
  const fade = fc => {
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = fc;
    c.fillRect(0, 0, $c.width, $c.height);
    c.globalCompositeOperation = "source-over";
  };
  let playState = null; // null, true, or time we started to pause
  r.start = ()=> { if (playState === null) { playState = true; draw(); } };
  const draw = ()=> {
    if (!playState) return;
    requestAnimationFrame(draw);
    if (!$player.paused) playState = true;
    else {
      const t = now();
      if (playState === true) playState = t;
      else if (t > playState + 5000) { clear(); return playState = null; }
      else if (t > playState + 4000) return fade("#0001");
    }
    if ($c.width  !== $c.clientWidth ) $c.width = $c.clientWidth;
    if ($c.height !== $c.clientHeight) $c.height = $c.clientHeight;
    updateTimes();
    if (curViz) {
      const d = curViz.draw();
      if (!d) return;
      const [vol1, vol2] = d;
      r.vol = vol1;
      setStyleVar("--volume1",  vol1.toFixed(3));
      setStyleVar("--volume2",  vol2.toFixed(3));
      // vol1 is avg of the fft so it's smooth, vol2 is fast-responding
      setStyleVar("--volcolor", r.col = hsl(80*vol2, 100, 50, 100*vol1));
      vizListeners.forEach(l => l());
    }
  };
  //
  let curViz = null, curMkViz = null;
  const vizualizers = [null, SimpleViz, CQTViz];
  const useViz = mkViz => {
    message(mkViz?.name ?? "NoViz");
    if (curViz) curViz.destroy();
    clear();
    curMkViz = mkViz;
    curViz = mkViz ? mkViz($c, c, fade) : null;
  };
  r.nextViz = ()=> useViz(arrNext(vizualizers, curMkViz));
  r.nextSubmode = ()=> curViz?.nextSubmode?.();
  //
  useViz(SimpleViz);
  clear();
  return r;
})();

$("vizmode").addEventListener("click", visualizer.nextViz);
$("vizsubmode").addEventListener("click", visualizer.nextSubmode);
bind("\\", visualizer.nextViz, withCtrl);
bind("|", visualizer.nextSubmode, withCtrl);

const mkFlashyWindow = ()=> {
  const win = window.open(
    "", "_blank",
    "resizable=1,scrollbars=0,menubar=0,toolbar=0,location=0,status=0");
  const body = win.document.body;
  body.parentElement.style.background = "#000";
  const setbg = ()=> body.style.background = visualizer.col;
  setbg();
  visualizer.addListener(setbg);
  win.addEventListener("unload", ()=> visualizer.delListener(setbg));
};

// ---- experimental beat detection -------------------------------------------

const fetchBeats = info => {
  if ("beats" in info) return info.beatsPromise;
  info.beats = null;
  const beatsPath = "/beats" + info.path.replace(/[.][^.]+$/, ".json");
  return info.beatsPromise = fetch(beatsPath)
    .then(x => x.ok && x.json())
    .then(x => (
      info.beats = !x?.length ? null : [
        ...(x[0] > 0 ? [0] : []),
        ...x,
        ...(x[x.length-1] < info.duration ? [info.duration] : [])],
      info.beatsPromise = Promise.resolve(info.beats)));
};

const findBeatIndex = (t, bs, last = 0) => {
  let lo = 0, hi = bs?.length;
  if (!hi || hi === 1) return 0;
  if (t >= bs[last]) {
    if (last + 1 === hi || t < bs[last + 1]) return last;
    if (last + 2 === hi || t < bs[last + 2]) return last + 1;
  }
  if (t <= bs[lo]) return lo;
  if (t >= bs[hi]) return hi;
  while (lo < hi) {
    const mid = ceil((lo + hi) / 2);
    if (bs[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
};

/*
for (useLast of [0, 1, 2]) {
  const test = (beats, times = 1000000) => {
    const last = beats.length - 1, MIN = beats[0], MAX = beats[last];
    let bi = 0;
    const test = n => {
      bi = findBeatIndex(n, beats,
                         useLast === 0 ? undefined : useLast === 1 ? bi
                         : floor(random()*beats.length));
      const ok = last < 0 ? bi === 0
            : n < beats[0] ? bi === 0
            : n >= beats[last] ? bi === last
            : beats[bi] <= n && n < beats[bi+1];
      if (!ok) throw Error(`poof n=${n}, beats=[${beats.join(", ")}]`);
    };
    for (const b of beats) test(b);
    for (let i = 0; i < times; i++) test(random()*(MAX-MIN+2) + MIN - 1);
  }
  test([0, 10, 20, 40, 60, 90]);
  test([0, 10, 20,     60, 90]);
  test([0,     20,     60, 90]);
  test([0,     20,     60    ]);
  test([       20,     60    ]);
  test([               60    ]);
  const randomBeats = ()=> {
    let r = [], n = 0;
    while (random() <= 0.95) r.push(n += random());
    return r;
  }
  for (let i = 0; i < 10000; i++) test(randomBeats(), 10000);
}
*/

const beats = (()=>{
  //
  // let tickSound = null;
  // const tick = ()=> {
  //   if (!tickSound) tickSound = new Audio("/.player/beats/tick.wav");
  //   tickSound.volume = $player.volume / 2;
  //   tickSound.play();
  // }
  //
  let eltStyle = null, isShown = false;
  const hide = ()=> {
    if (isShown) { eltStyle.opacity = 0; isShown = false; }
  }
  const draw = ()=> {
    if (!isShown) { eltStyle.opacity = 1; isShown = true; }
    const R = antiSpike(1 - abs(2*beat01 - 1)) * (beat % 2 ? 60 : -60);
    setStyleVar("--beat", `${R}deg`);
    const L = spike(1 - beat01);
    eltStyle.backgroundColor = hsl(120, 100, L * visualizer.vol * 80, 50);
  };
  //
  let lastBeats = null, beats = null, beat = 0, beat01 = 0, beatMove = null;
  const update = curTime => {
    if (!eltStyle) eltStyle = $("beat").style;
    const info = $player.info;
    beats = info?.beats;
    if (!beats || $player.paused || curTime === null) {
      beat = beat01 = 0, beatMove = null; return hide();
    }
    if (beats != lastBeats) {
      lastBeats = beats, beat = beat01 = 0, beatMove = null;
    }
    const newBeat = findBeatIndex(curTime, beats, beat);
    if (newBeat != beat) {
      beat = newBeat;
      // tick();
      if (beatMove !== null) {
        $player.currentTime = beats[beat = beatMove];
        beatMove = null;
      }
    }
    beat01 = beat < 0 ? 0 : beat >= beats.length - 1 ? 0
           : (curTime - beats[beat]) / (beats[beat + 1] - beats[beat]);
    draw();
  };
  const nextBeatTime = t =>
    beats[clipRange(0, findBeatIndex(t, beats, beat) + 1, beats.length - 1)];
  // moves are unused
  const move = n => beatMove = clipRange(0, beat + n, beats.length - 1);
  const moveTo = t => {
    const b = findBeatIndex(t, beats);
    beatMove = b >= beats.length - 1 ? beats.length - 1
             : beats[b + 1] - t > t - beats[b] ? b : b + 1;
  };
  const X = { update, nextBeatTime, move, moveTo };
  return X;
})();

// ---- initialization --------------------------------------------------------

const init = data => {
  all = data;
  setAllExtras();
  renderItem($main, all, true);
  $main.firstElementChild.classList.add("open");
  selectNext($main, +1);
  updateDisplays(null);
};

fetch("info.json", { method: "HEAD" })
  .then(r => localStorage.date === r.headers.get("last-modified")
             && localStorage.all
             ? init(JSON.parse(localStorage.all))
             : (delete localStorage.all,
                localStorage.date = r.headers.get("last-modified"),
                fetch("info.json")
                  .then(r => r.json())
                  .then(data => init(processData(data)))));

// ----------------------------------------------------------------------------
