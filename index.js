"use strict";

// ---- config ----------------------------------------------------------------

const autoExpandItems = 30;
const pgSize = 10;
const bigSkip = 60, smallSkip = 5, smallerSkipDiv = 2;
const fadeToFreq = 20, pauseFade = 0.5, switchFade = 0.25; // time for 0-1 fade
const imageDelayTime = 2, imageCycleTime = 60, imageExplicitTime = 120;
const tickerTime = 60, tickerSwapTime = 1;
const waveNeedleColor = "#f00a", waveNeedleWidth = 4;
const analyzerSmoothing = 0.5, analyzerBins = 512;
const analyzerWaveColor = "#ffcc", analyzerBinsColor = "#844";

// ---- utils -----------------------------------------------------------------

const $ = x => document.getElementById(x);
const rec = f => f((...xs) => rec(f)(...xs));
const isArray  = Array.isArray;
const isFinite = Number.isFinite;
const U = undefined;

const mod = (n, m) => { const r = n % m; return r < 0 ? r + m : r; };
const clipRange = (lo, x, hi) => Math.max(Math.min(x,hi), lo);
const clip01 = x => clipRange(0, x, 1);

const addLazyProp = (o, name, get) =>
  Object.defineProperty(o, name, {configurable: true, get: ()=> {
    const value = get(o);
    Object.defineProperty(o, name, {value, writable: true});
    return value;
  }});

const shuffle = xs => {
  xs = xs.slice();
  xs.forEach((x,i) => {
    const j = i + Math.floor(Math.random() * (xs.length - i));
    xs[i] = xs[j], xs[j] = x;
  });
  return xs;
};

const wheelToN = (e, n1, n2, dflt) =>
  (e.deltaY > 0 ? +n1 : e.deltaY < 0 ? -n1
   : e.deltaX > 0 ? +n2 : e.deltaX < 0 ? -n2
   : dflt);

["selected", "player", "altitem", "dragitem"].forEach(prop => {
  let item; Object.defineProperty($, prop, {
    get: ()=> item,
    set: elt => { if (item == elt) return;
                  if (item instanceof Element) item.classList.remove(prop);
                  item = elt;
                  if (item instanceof Element) item.classList.add(prop); } });
});

const blankPNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQ"
  + "VR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const reddishPNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQ"
  + "VR42mP8f+ZMPQAIgQMYmyUZ4QAAAABJRU5ErkJggg==";

// ---- data ------------------------------------------------------------------

let all = {};

const processData = data => {
  const p = dir => info => {
    const isDir = info.type == "dir";
    info.path = dir + info.name + (isDir ? "/" : "");
    info.name = (isDir ? (info.name == "" ? "All" : info.name)
                       : info.name.replace(/[.]([^.]+)$/,
                                           info.type != "other" ? "" : " ($1)"))
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
  if (info.type != "audio") return;
  const txt = x => x ? " " + x.replaceAll(/\//g, " ") : "";
  addLazyProp(info, "search", ()=>
    (info.path + "/" + txt(info.title) + txt(info.album) + txt(info.track)
     + txt(info.date) + txt(info.artist))
    .replaceAll(/[ _]+/g, " ").toLowerCase());
};

const setAllExtras = ()=> {
  let first = null, last = null, firsts = [all], lasts = [all];
  const loop = parent => parent.children.forEach(child => {
    child.parent = parent;
    if (last) child.preva = last; else firsts.push(child);
    if (child.type == "audio") {
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
  elt == $main || (elt != $plist && (!!elt.id || elt == $main));

const div = (parent, css = null, txt = null) => {
  const div = document.createElement("div");
  if (css) (isArray(css) ? css : [css]).forEach(c => div.classList.add(c));
  if (txt) div.innerText = txt;
  parent.append(div);
  return div;
};

const renderItem = (elt, info, main) => {
  if (info.type == "dir") elt = div(elt, "list");
  const item = div(elt, ["item", info.type], info.name);
  if (main) item.id = info.path;
  item.setAttribute("tabindex", 0);
  item.setAttribute("draggable", true);
  infoMap.set(item, info);
  addItemEvents(item, info);
  if (info.type == "dir") {
    const subs = div(elt, "subs");
    info.children.forEach(c => renderItem(subs, c, main));
  }
  return item;
};

const addItemEvents = (elt, info) => {
  elt.addEventListener("click", e => mainOrPlistOp(e, elt, info));
  elt.addEventListener("dragstart", dragStart);
  elt.addEventListener("dragend", dragEnd);
  elt.addEventListener("focus", ()=> {
    if ($.selected && isMainItem(elt) != isMainItem($.selected))
      [$.altitem, $.selected] = [$.selected, $.altitem];
    $.selected = elt;
  });
};

// ---- player ----------------------------------------------------------------

const $player = $("player");
const play = (elt = $.selected) => {
  if (typeof elt == "string") elt = $(elt);
  if (elt && getInfo(elt).type != "audio") elt = null;
  if ($.player == elt) $player.currentTime = 0;
  $.player = elt;
  const path = elt ? getPath(elt) : null;
  const doPlay = ()=> {
    $player.volume = $player.defaultVolume;
    if (!elt) return playerStop();
    updateDisplays(path);
    playerPlay().catch(e => {
      if (e.code != e.ABORT_ERR) throw e; });
    setBackgroundImageLoop(imageDelayTime);
  }
  if (!elt || $player.paused) doPlay();
  else fadeTo([0, switchFade], doPlay);
};

let unders = [...document.getElementsByClassName("under")];
const setBackgroundImageLoop = s => {
  if (!s) { setBackgroundImage(); s = imageCycleTime; }
  if (setBackgroundImageLoop.timer)
    clearTimeout(setBackgroundImageLoop.timer);
  setBackgroundImageLoop.timer = setTimeout(setBackgroundImageLoop, 1000*s);
};
const setBackgroundImage = (eltOrPath = $.player) => {
  if (!eltOrPath) return;
  if (typeof eltOrPath == "string") setBackgroundImageLoop(imageExplicitTime);
  else {
    const info = getInfo(eltOrPath).parent;
    if (!info.images) {
      info.images =
        info.children.filter(n => n.type == "image").map(n => n.path);
      info.curImages = [];
    };
    if (!info.images.length) eltOrPath = null;
    if (info.images.length == 1) eltOrPath = info.images[0];
    else {
      if (!info.curImages.length) info.curImages = shuffle(info.images);
      eltOrPath = info.curImages.pop();
    }
  }
  if (unders[0].src == new URL(eltOrPath, document.baseURI).href) return;
  unders[0].style.opacity = "";
  [unders[1], unders[0]] = [...unders];
  unders[0].src = eltOrPath || blankPNG;
  unders[0].style.opacity = 1.0;
};

const fadeTo = (tgtTime, cb) => {
  const [target, time] = isArray(tgtTime) ? tgtTime : [tgtTime, pauseFade];
  const fade = ()=> {
    const now = Date.now();
    if ($player.paused || now >= end) {
      $player.volume = target;
      fadeTo.timer = null;
      if (cb) cb();
      return;
    }
    $player.volume = target + dir * (end - now) / (1000 * time);
    fadeTo.timer = setTimeout(fade, 1000/fadeToFreq);
  };
  if (fadeTo.timer) clearTimeout(fadeTo.timer);
  fadeTo.timer = setTimeout(fade, 1000/fadeToFreq);
  const from = $player.volume, dir = from > target ? +1 : -1;
  const end  = Date.now() + 1000 * time * Math.abs(target - from);
};

$player.pausing = false; // made up field
const playerStop = ()=> {
  $player.pausing = false;
  if (!$player.path) return;
  if (!$player.paused) $player.pause();
  $player.currentTime = 0;
  $.player = null;
  playerButtonsPlaying(false);
  updateDisplays("");
};
const playerPause = ()=> {
  $player.pausing = true;
  if (!$player.path) return;
  fadeTo(0, ()=> { $player.pausing = false; $player.pause(); });
};
const playerPlay  = ()=> {
  $player.pausing = false;
  if (!$player.path) return play();
  if ($player.currentTime > 0) fadeTo($player.defaultVolume);
  else $player.volume = $player.defaultVolume;
  return $player.play();
};
const playerPlayPause = ({ctrlKey}) =>
    ctrlKey                           ? playerStop()
  : $player.paused || $player.pausing ? playerPlay()
  :                                     playerPause();

$player.leftoverSkip = null; // made up field
const doLeftoverSkip = ()=> {
  if (!$player.leftoverSkip) return;
  const t = $player.leftoverSkip; $player.leftoverSkip = null;
  trackSkipTo(t > 0 ? t : $player.duration + t);
};
const trackSkipTo = time => {
  if (!$player.path) return;
  if (time < 0) {
    $player.leftoverSkip = time;
    playerNextPrev(false);
  } else if (isFinite($player.duration) && time > $player.duration) {
    $player.leftoverSkip = time - $player.duration;
    playerNextPrev(true);
  } else {
    $player.currentTime = time;
  }
};
const trackSkip = dir => ({shiftKey, ctrlKey}) => {
  const delta = dir * (ctrlKey ? bigSkip : smallSkip)
                    / (shiftKey ? smallerSkipDiv : 1);
  if ($player.leftoverSkip) $player.leftoverSkip += delta;
  else trackSkipTo($player.currentTime + delta);
};

const playerNextPrev = down => {
  let item = $.player;
  if (!item) return;
  if (document.activeElement == $search && isMainItem(item)) {
    if (search.origin.elt == item || search.origin.type != "audio")
      searchNext(1, loopMode.on);
    item = search.origin && search.origin.elt;
  } else {
    do { item = nextItem(item, down, {wrap: loopMode.on}); }
    while (item && item != $.player && getInfo(item).type != "audio");
  }
  play(item);
};

const playerButtonsPlaying = playing =>
  $("playerbuttons").classList.toggle("playing", playing);
$player.addEventListener("play",  ()=> playerButtonsPlaying(true));
$player.addEventListener("pause", ()=> playerButtonsPlaying(false));
$player.addEventListener("ended", ()=> playerNextPrev(true));
$player.addEventListener("loadeddata", doLeftoverSkip);

$player.path = ""; // made up field
const updateDisplays = (src = $player.path) => {
  if ($player.path != src) $player.src = $player.path = src;
  $("wave-image").src =
    !src ? reddishPNG : "/images" + src.replace(/[.][^.]+$/, ".png");
  updateTimes();
  updateTrackInfo();
  if (!src) visualizer.clear();
};

// ---- navigation ------------------------------------------------------------

const isItem   = elt => elt.classList.contains("item");
const isHidden = elt => elt.offsetParent === null;
const isTop    = elt => elt == $main || elt == $plist;
const getTop   = elt => isTop(elt) ? elt : getTop(elt.parentElement);

const nextItem = (elt, down, opts = {}) => {
  const {wrap = true, sub = true, different = false} = opts;
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
  const start  = (!sub && getInfo(elt).type == "dir") ? elt.parentElement : elt;
  const result = loopUp(start);
  return (!different || result != start) ? result : null;
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
  while (n != 0) {
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
  const swap = result == result.parentElement.firstElementChild ? result
             : result == result.parentElement.lastElementChild  ? null
             : move == "up" ? result : result.nextElementSibling;
  result.parentElement.insertBefore($.selected, swap);
};
const selectEdge = (n, opts) =>
  selectNext(($.selected && !isMainItem($.selected)) ? $plist : $main, n, opts);

const expandDir = (info = getInfo($.selected), expand = "??", focus = true) => {
  let elt = info.elt;
  if (expand == "toggle")
    expand = elt.parentElement.classList.contains("open")
             && !elt.nextElementSibling.classList.contains("only")
             ? false : "??";
  if (expand == "??")
    expand = info.size > autoExpandItems || "deep";
  if (expand) {
    if (info.type != "dir") return;
    if (elt.parentElement.classList.contains("open")
        && elt.nextElementSibling.classList.contains("only")) {
      elt.nextElementSibling.classList.remove("only");
    }
    elt.parentElement.classList.add("open");
    if (expand == "deep")
      for (const e of elt.parentElement.querySelectorAll(".list"))
        e.classList.add("open");
    if (focus) selectNext(elt, 1);
  } else {
    if (info.type != "dir") {
      elt = elt.parentElement.previousElementSibling;
    } else if (isHidden(elt.nextElementSibling)) {
      elt = elt.parentElement.parentElement.previousElementSibling;
    }
    if (focus) elt.focus();
    elt.parentElement.classList.remove("open");
    for (const e of elt.parentElement.querySelectorAll(".list"))
      e.classList.remove("open");
  }
};

const showOnly = (info = getInfo($.selected), focus = true) => {
  const elt0 = $.selected = info.elt;
  if (info.type != "dir") info = info.parent;
  let elt = info.elt;
  const toSelect = elt.parentElement.classList.contains("only")
                   && nextItem(elt, true);
  for (const qs of ["open", "only"])
    for (const e of $main.querySelectorAll("." + qs)) e.classList.remove(qs);
  expandDir(info, U, focus);
  do {
    elt = elt.parentElement; elt.classList.add("open", "only");
    elt = elt.parentElement; elt.classList.add("only");
  } while (elt != $main);
  if (!focus) return;
  if (toSelect) return toSelect.focus();
  const f = elt0 && nextItem(elt0, true); if (f) return f.focus();
};

const mainOrPlistOp = (e, elt = $.selected, info = getInfo(elt)) => {
  stopEvent(e);
  if (e.ctrlKey && info.type != "dir" && info.type != "audio")
    return window.open(info.path, "_blank");
  (e.ctrlKey ? plistOp : mainOp)(e, elt, info);
};

const mainOp = (e, elt = $.selected, info = getInfo(elt)) =>
  info.type == "dir" ? (e.shiftKey ? expandDir(U, "toggle") : showOnly(info)) :
  info.type == "audio" ? play(elt) :
  info.type == "image" ? setBackgroundImage(info.path) :
  window.open(info.path, "_blank");

const bindings = new Map(), bind = (keys, op, filter) =>
  (isArray(keys) ? keys : [keys]).forEach(k => bindings.set(k, [op, filter]));
window.addEventListener("keydown", e => {
  const b = bindings.get(e.key) || bindings.get(e.code);
  if (!b || (b[1] && !b[1](e))) return;
  stopEvent(e);
  b[0](e);
});
const notCtrl = e => !e.ctrlKey;

// ---- playlist --------------------------------------------------------------

const switchMain = ()=> $.altitem && $.altitem.focus();

const plistOp = (e, elt = $.selected, info = getInfo(elt), dragTo) => {
  if (elt == $main) return;
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
    info.type == "dir"     ? info.children.forEach(add)
    : info.type != "audio" ? U
    : $.player == info.elt ? $.player = $.altitem = render(info)
    : $.altitem            ? render(info)
    : $.player             ? $.altitem = render(info)
    :                        play($.altitem = render(info));
  add(info);
  if (e instanceof KeyboardEvent)
    selectNext(U, +1, {wrap: false, sub: false});
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
    nextItem(toDelete, d, {different: true}));
  if (toDelete == $.player) {
    $.player = {previousElementSibling: prev, nextElementSibling: next};
    infoMap.set($.player, getInfo(toDelete));
  } else if ($.player && !($.player instanceof Element)) {
    if ($.player.nextElementSibling == toDelete)
      $.player.nextElementSibling = next;
    if ($.player.previousElementSibling == toDelete)
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
    if (e.target != $plist) {
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
    if (elt != $plist) return;
    if (e.timeStamp - oLast <= 100) return; else oLast = e.timeStamp;
    const di = YtoElt(e);
    if (di) { $.dragitem = di; $.dragitem.classList.remove("bottom"); }
    else if ($.dragitem = $plist.lastElementChild)
      $.dragitem.classList.add("bottom");
    if (di == $plist.firstElementChild)     plist.scrollTop -= 1;
    else if (di == $plist.lastElementChild) plist.scrollTop += 1;
  }));
  elt.addEventListener("dragenter", dragHandle(e =>
    count++ == 0 && elt.classList.add("drag-to")));
  elt.addEventListener("dragleave", dragHandle(e =>
    --count == 0 && elt.classList.remove("drag-to")));
  elt.addEventListener("drop", dragHandle(e => {
    count = 0; elt.classList.remove("drag-to");
    op(e, $drag, U, elt == $plist ? YtoElt(e) : U);
    $drag = null;
    $.dragitem = null;
  }));
};

addDragEvents($("control-panel"), mainOp);
addDragEvents($plist, plistOp);
addDragEvents($main, (e, d) => plistDelete(d), e => !isMainItem($drag));

// ---- toggles ---------------------------------------------------------------

const mkToggle = (id, cb = null, h = null) => {
  const elt = $(id);
  const toggle = e => {
    if (h && h(e)) return;
    elt.classList.toggle("on", (toggle.on = !toggle.on));
    if (cb) cb(toggle.on);
  };
  toggle.on = elt.classList.contains("on");
  elt.addEventListener("click", toggle);
  return toggle;
};
const loopMode = mkToggle("loop");
const fftvizMode = mkToggle("fftviz");
const wavvizMode = mkToggle("wavviz");
const bigvizMode = mkToggle("bigviz", on =>
  $("visualization").classList.toggle("fullsize", on));
const flashyMode = mkToggle("flashy", on => {
  $main.classList.toggle("volumebg", on);
  $plist.classList.toggle("volumebg", on);
}, e => {
  if (!e.shiftKey) return false;
  const win = window.open(
    "", "_blank",
    "resizable=1,scrollbars=0,menubar=0,toolbar=0,location=0,status=0");
  const body = win.document.body;
  body.parentElement.style.background = "#000";
  const setbg = c => body.style.background = c;
  setbg("#000");
  visualizer.addListener(setbg);
  win.addEventListener("unload", ()=> visualizer.delListener(setbg));
  return true;
});

// ---- player interactions ---------------------------------------------------

bind("Enter", mainOrPlistOp);
bind("Tab", switchMain);

const initiateSearch = e => {
  if (e) $search.value = e.key; else $search.select();
  $search.focus(); }
bind("/", ()=> initiateSearch(), notCtrl);
bind("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(l => "Key"+l),
     initiateSearch, notCtrl);

bind(["Backspace", "Delete"], e => plistDelete(e.key == "Backspace"));

bind("+", ()=> expandDir(U, true),   notCtrl);
bind("-", ()=> expandDir(U, false),  notCtrl);
bind("*", ()=> expandDir(U, "deep"), notCtrl);

bind("ArrowUp",   e => selectNext(U, -1, {move: e.ctrlKey}));
bind("ArrowDown", e => selectNext(U, +1, {move: e.ctrlKey}));
bind("PageUp",    e => selectNext(U, -pgSize, {wrap: false, move: e.ctrlKey}));
bind("PageDown",  e => selectNext(U, +pgSize, {wrap: false, move: e.ctrlKey}));
bind("Home",      e => selectEdge(+1, {move: e.ctrlKey}));
bind("End",       e => selectEdge(-1, {move: e.ctrlKey}));

bind([" ", "Numpad5"], playerPlayPause);
bind("ArrowLeft",      trackSkip(-1));
bind("ArrowRight",     trackSkip(+1));
[[null,      "p-pause", "pause",         playerPause],
 [null,      "p-play",  "play",          playerPlay],
 [null,      "p-stop",  "stop",          playerStop],
 ["Numpad4", "p-prev",  "previoustrack", ()=> playerNextPrev(false)],
 ["Numpad6", "p-next",  "nexttrack",     ()=> playerNextPrev(true)],
 ["Numpad1", "p-rew",   "seekbackward",  trackSkip(-2)],
 ["Numpad3", "p-fwd",   "seekbackward",  trackSkip(+2)],
].forEach(([key, id, media, handler]) => {
  if (key)   bind(key, handler);
  if (id)    $(id).addEventListener("click", handler);
  if (media) navigator.mediaSession.setActionHandler(media, handler);
});

const percentJump = e => isFinite($player.duration)
  && ($player.currentTime =
        (+e.code.substring(e.code.length-1)) * $player.duration / 10);
bind("0123456789".split("").map(d => "Digit"+d), percentJump);

$player.defaultVolume = 1; // made up field
const $volume = $("volume"), $volumeMax = +$volume.max;
$volume.value = $volumeMax;
const updateVolume = v => {
  const vol = clip01(v / $volumeMax);
  fadeTo($player.defaultVolume = vol);
  $volume.value = Math.round($volumeMax * vol);
};
$volume.addEventListener("input", ()=> updateVolume(+$volume.value));
$volume.addEventListener("wheel", e => {
  stopEvent(e); updateVolume(+$volume.value + wheelToN(e, -1, 2, 0)); });
bind("Numpad8", ()=> updateVolume(+$volume.value + 1));
bind("Numpad2", ()=> updateVolume(+$volume.value - 1));

$player.defaultPlaybackRate = 1;
const $rate = $("rate"), $rateMax = +$rate.max;
$rate.value = $rateMax / 2;
const updateRate = r => {
  const rate = clip01(r / $rateMax) + 0.5;
  $player.preservesPitch = false;
  $player.defaultPlaybackRate = $player.playbackRate = rate;
  $rate.value = Math.round($rateMax * (rate - 0.5));
};
$rate.addEventListener("input", ()=> updateRate(+$rate.value));
$rate.addEventListener("wheel", e => {
  stopEvent(e); updateRate(+$rate.value + wheelToN(e, -1, 2, 0)); });
bind("Numpad9", ()=> updateRate(+$rate.value + 1));
bind("Numpad7", ()=> updateRate(+$rate.value - 1));

// mouse wheel for convenient song navigation
$("control-panel").addEventListener("wheel", e =>
  trackSkip(wheelToN(e, 0.5, 1, U))(e));

// ---- time display ----------------------------------------------------------

const updateTimes = ()=> {
  const $dur = $("dur"), $time = $("time");
  const formatTime = t => {
    const s = Math.abs(t) % 60;
    return Math.floor(t/60) + ":" + (s<10 ? "0" : "") + s; };
  if (!isFinite($player.duration) || !$.player) {
    updateTimes.shownTime = null;
    updateTimes.shownURL  = null;
    $dur.innerText = $time.innerText = "–:––";
    return;
  }
  if (updateTimes.shownURL != $player.path && $player.duration) {
    updateTimes.shownURL = $player.path;
    $dur.innerText = formatTime(Math.round($player.duration));
  }
  let t = $player.currentTime;
  if (timeRemaining) t = $player.duration - t;
  t = Math.round(t);
  if (updateTimes.shownTime != t) {
    updateTimes.shownTime = t;
    $time.innerText = (timeRemaining ? "-" : "") + formatTime(t);
  }
};

// ---- info display ----------------------------------------------------------

const infoDisplay = (()=> {
  const infoDiv = $("track-info"), textDiv = infoDiv.firstElementChild;
  const START = 0, END = 1, CLEARSTART = 2, CLEAREND = 3, NEWTEXT = 4;
  let initialized = false, state = START, newText = "", moveTo = 0;
  //
  const move = (x, st, {time = tickerTime, text = U, fun = U} = {}) => {
    if (text !== U) {
      textDiv.innerText = text;
      moveTo = infoDiv.offsetWidth - textDiv.scrollWidth;
    }
    if (textDiv.innerText == "" && state == NEWTEXT) return;
    textDiv.style.transition = `left ${time}s ${fun || "ease-in-out"}`;
    textDiv.style.left = `${x}px`;
    state = st;
    if (time <= 0) setTimeout(done, 100);
  };
  //
  const transition = [];
  transition[START]      = ()=> move(0, END);
  transition[END]        = ()=> move(moveTo, START);
  transition[NEWTEXT]    = ()=> move(0, END,
                                     {time: tickerSwapTime, fun: "ease-out"});
  transition[CLEARSTART] = ()=> move(-(textDiv.scrollWidth+1), CLEAREND,
                                     {time: tickerSwapTime, fun: "ease-in"});
  transition[CLEAREND]   = ()=> move(infoDiv.offsetWidth, NEWTEXT,
                                     {time: 0, text: newText});
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
  if (!$player.path) return infoDisplay("");
  const info = $.player && getInfo($.player), sep = " • ";
  let text = "";
  if (info) {
    text += info.title || info.name;
    text += sep;
    text += info.album || info.parent.name;
    if (info.track) text += ` (#${info.track})`;
    if (info.date)  text += `, ${info.date}`;
    text += sep;
    text += info.artist || (info.parent.parent && info.parent.parent.name)
            || "???";
  }
  infoDisplay(text);
};

// ---- waveform control ------------------------------------------------------

const drawPlayerLine = (()=> {
  const canvas = $("wave-canvas"), ctx = canvas.getContext("2d");
  return ()=> {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = waveNeedleColor;
    const loc = $player.currentTime / $player.duration;
    ctx.fillRect(loc * canvas.width - waveNeedleWidth/2, 0,
                 waveNeedleWidth, canvas.height);
  };
})();
$player.addEventListener("timeupdate", drawPlayerLine);

const $wave = $("wave");
$wave.addEventListener("mousedown", e => {
  const move = e => {
    const dur = $player.duration;
    if (isNaN(dur)) return;
    const rect = $wave.getBoundingClientRect();
    $player.currentTime = dur * clip01((e.clientX-rect.left) / rect.width);
    drawPlayerLine();
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

const mkSearcher = (str, {sep = "/", pfxSep = true, sfxSep = false} = {}) => {
  const escape = str => str.replace(/[.*+?^${}()|\[\]\\]/g, "\\$&");
  const seprx = escape(sep);
  const word2rx = str =>
    RegExp(str.split("").map(escape).join(`[^ ${seprx}]*`), "iug");
  const words = str =>
    str.split(/ +/).filter(s => s.length).map(word2rx);
  const seps = str =>
    str.trim().split(sep).map(s => words(s.trim()));
  str = str.trim();
  if (!str.length) return str => true;
  pfxSep &&= str.startsWith(sep) && RegExp(`^ *${seprx}`, "iug");
  if (pfxSep) str = str.slice(1);
  if (!str.length) return str => pfxSep.test(str);
  sfxSep &&= str.endsWith(sep) && RegExp(`${seprx} *$`, "iug");
  if (sfxSep) str = str.slice(0,-1);
  const rxss = str.length ? seps(str) : [];
  const last = rxss[rxss.length-1];
  if (!last.length) rxss.length--;
  const rxsep = RegExp(seprx, "iug");
  return inp => {
    let pos = 0;
    if (pfxSep) {
      pfxSep.lastIndex = pos;
      if (!pfxSep.exec(inp)) return false;
      else pos = pfxSep.lastIndex;
    }
    for (const rxs of rxss) {
      if (rxs.length) {
        const poss = rxs.map(rx =>
          (rx.lastIndex = pos, (rx.exec(inp) ? rx.lastIndex : -1)));
        if (poss.some(p => p < 0)) return false;
        pos = Math.max(...poss);
        if (pos < 0) return false;
        if (rxs === last) break;
      }
      rxsep.lastIndex = pos;
      if (!rxsep.exec(inp)) return false;
      pos = rxsep.lastIndex;
    }
    if (sfxSep) {
      sfxSep.lastIndex = pos;
      if (!sfxSep.exec(inp)) return false;
    }
    return true;
  };
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
  t(" bar foo ");
  t("barfoo");
  t("foobar");
  t("bafoor");
  t("fobaro");
  t("fboaor");
  t("bfaoro");
  t("bar.foo");
  f("rab oof");
  t("foo/bar");
  t("foo / bar");
  t("/foo bar");
  t("bar foo/");
  t("///bar foo///");
  t("///bar/foo///");
  search(" / foo  bar ");
  f("foo bar");
  f(" foo bar ");
  t("/foo bar");
  t("/ bar foo ");
  t(" / bar foo ");
  t("/barfoo");
  t("/foobar");
  t("/xbfaorox");
  t("/bar.foo");
  f("/rab oof");
  t("/foo // bar/");
  search(" / foo  bar / ");
  f("foo bar");
  f(" foo bar ");
  f("/foo bar");
  f("/foo/bar");
  t("/foo/bar/");
  t("/bar/foo/");
  t("/bar/foo/xxx");
  t("/bar/foo/x/x/x/");
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
  if (n0.type != "audio") n0 = n0.nexta;
  const ok = search.ok, fst = all.nexta;
  let n = n0, results = [], later;
  do {
    if (n == fst) { later = results; results = []; }
    const r = ok(n.search);
    n.elt.classList.toggle("found", r);
    if (r) results.push(n);
  } while ((n = n.nexta) != n0);
  later.forEach(x => results.push(x));
  $search.classList.add(results.length > 0 ? "found" : "not-found");
  search.results = results;
  search.cur = (results.length - later.length) % results.length;
  showCurSearch();
};

// const nextSearchTrack = down => {
//   if (!search.ok || !$.player) return;
//   const len = search.results.length;
//   if (len == 0) return;
//   const cur = search.results.indexOf(getInfo($.player));
//   if (cur >= 0) return search.results[mod(cur + (down ? +1 : -1), len)].elt;
//   if (search.origin && search.origin.type == "audio")
//     return search.origin.elt;
//   return search.results[0].elt;
// };

const searchNext = (delta, wrap = true) => {
  if (!search.ok) return;
  const len = search.results.length;
  if (len == 0) return;
  if (wrap) search.cur = mod(search.cur + delta, len);
  else {
    search.cur += delta;
    if (search.cur < 0 || search.cur >= len) search.cur = null;
  }
  search.origin = showCurSearch();
};

const showCurSearch = ()=> {
  const len = search.results.length;
  if (len == 0 || search.cur == null) return null;
  const cur = search.results[search.cur];
  isHidden(cur.elt) ? showOnly(cur, false) : $.selected = cur.elt;
  cur.elt.scrollIntoView(
    {behavior: "auto", block: "nearest", inline: "nearest"});
  $("result-number").innerText = (search.cur + 1) + "/" + len;
  return cur;
};

const removeSearch = ()=> {
  search.results.forEach(n => n.elt.classList.remove("found"));
  $("result-number").innerText = "";
};

const search = e => {
  if (e.type == "blur") {
    if (e.relatedTarget) { search.blurTime = null; return removeSearch(); }
    else { search.blurTime = e.timeStamp; return $search.focus(); }
  }
  if (e.type == "focus") {
    if (search.blurTime && (e.timeStamp - search.blurTime) < 200)
      return search.blurTime = null;
    showSearch(getInfo($.selected));
    if (!search.initial) return;
    $search.value = search.initial; search.initial = null;
  }
  const searchStr = $search.value.toLowerCase().trim().replace(/\s+/g, " ");
  if (search.last == searchStr) return; else search.last = searchStr;
  const searchStrs = searchStr.split(" ");
  search.ok = searchStr == "" ? null : mkSearcher(searchStr);
  if (search.timer) clearTimeout(search.timer);
  search.timer = setTimeout(()=> { search.timer = null; showSearch(); }, 250);
};
search.results = [];

const searchKey = e => {
  const {key, code, shiftKey: shift, ctrlKey: ctrl} = e;
  if (key === "Enter" || code === "Backslash"
      || ((shift || ctrl) && (key === " " || code.startsWith("Numpad")))
      || (ctrl            && code.startsWith("Digit")))
    return;
  e.stopImmediatePropagation();
  if (["Escape", "Tab"].includes(key)) $.selected.focus();
  else if (key == "ArrowUp")   searchNext(-1);
  else if (key == "ArrowDown") searchNext(+1);
  else if (key == "PageUp")    searchNext(-pgSize, false);
  else if (key == "PageDown")  searchNext(+pgSize, false);
  else return;
  e.preventDefault();
};

$search.addEventListener("focus", search);
$search.addEventListener("blur",  search);
$search.addEventListener("input", search);
$search.addEventListener("keydown", searchKey);

// ---- visualizations --------------------------------------------------------

const visualizer = (()=>{
  const r = {};
  const aCtx = new AudioContext();
  const pSrc = aCtx.createMediaElementSource($player);
  const splitter = aCtx.createChannelSplitter(2);
  pSrc.connect(aCtx.destination);
  pSrc.connect(splitter);
  const SIDES = [0, 1];
  const analyzers = SIDES.map(i => {
    const a = aCtx.createAnalyser();
    a.smoothingTimeConstant = analyzerSmoothing;
    a.fftSize = 2 * analyzerBins;
    splitter.connect(a, i);
    return a;
  });
  const bufLen = analyzers[0].frequencyBinCount, aData = new Uint8Array(bufLen);
  const vCanvas = $("visualization"); vCanvas.width *= 4;
  const vizListeners = new Set();
  r.addListener = l => vizListeners.add(l);
  r.delListener = l => vizListeners.delete(l);
  const rootS = document.documentElement.style;
  vizListeners.add(c => rootS.setProperty("--volume", c));
  vCanvas.addEventListener("click", bigvizMode);
  const cCtx = vCanvas.getContext("2d");
  const clear = r.clear = ()=>
    cCtx.clearRect(0, 0, vCanvas.width, vCanvas.height);
  const draw = ()=> {
    requestAnimationFrame(draw);
    if ($player.paused || $player.pausing) return;
    updateTimes();
    clear();
    const w = vCanvas.width / bufLen / 2;
    let avg1 = 0, avg2 = 0;
    if (fftvizMode.on) {
      cCtx.fillStyle = analyzerBinsColor;
      for (const side of SIDES) {
        const d = side === 0 ? -1 : +1;
        analyzers[side].getByteFrequencyData(aData);
        for (let i = 0, x = vCanvas.width / 2; i < bufLen; i++, x += d*w) {
          avg1 += aData[i];
          const barHeight = aData[i]/2 + 1;
          cCtx.fillRect(x, vCanvas.height/2 - barHeight/2, d*(w+1), barHeight);
        }
      }
      avg1 = clip01(avg1 / bufLen / 2 / 128);
    } else avg1 = 0.5;
    if (wavvizMode.on) {
      cCtx.lineWidth = 2; cCtx.strokeStyle = analyzerWaveColor;
      for (const side of SIDES) {
        const d = side === 0 ? -1 : +1;
        analyzers[side].getByteTimeDomainData(aData);
        cCtx.beginPath();
        for (let i = 0, x = vCanvas.width / 2; i < bufLen; i++, x += d*w) {
          avg2 += Math.abs(128 - aData[i]);
          const y = aData[i] * vCanvas.height / 256;
          cCtx.lineTo(x, y);
        }
        cCtx.stroke();
      }
      avg2 = clip01(avg2 / bufLen / 2 / 64);
    } else avg2 = 0.5;
    const color =
      `hsl(${Math.round(120*avg2)}deg, 100%, 50%, ${Math.round(100*avg1)}%)`;
    vizListeners.forEach(l => l(color));
  };
  draw();
  return r;
})();

// ---- initialization --------------------------------------------------------

// Hack these to fit to right side of parent
for (let elt of document.querySelectorAll(".fill-right"))
  elt.style.width = (elt.parentElement.offsetWidth - elt.offsetLeft - 16)+"px";

const init = data => {
  all = data;
  setAllExtras();
  renderItem($main, all, true);
  $main.firstElementChild.classList.add("open");
  selectNext($main, +1);
  updateDisplays("");
};

fetch("info", { method: "HEAD" })
  .then(r => localStorage.date == r.headers.get("last-modified")
             && localStorage.all
             ? init(JSON.parse(localStorage.all))
             : (delete localStorage.all,
                localStorage.date = r.headers.get("last-modified"),
                fetch("info")
                  .then(r => r.json())
                  .then(data => init(processData(data)))));

// ----------------------------------------------------------------------------
