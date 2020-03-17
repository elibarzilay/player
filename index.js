"use strict";

// next/prev track should be limited to found tracks when search is active
// when focus goes back to search, revive focus marks etc for the search text

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

const shuffle = xs => {
  xs = xs.slice();
  xs.forEach((x,i) => {
    const j = i + Math.floor(Math.random() * (xs.length - i));
    xs[i] = xs[j], xs[j] = x;
  });
  return xs;
};

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
  $.player = elt;
  const path = elt ? getPath(elt) : null;
  const doPlay = ()=> {
    $player.volume = $player.defaultVolume;
    if (!elt) return playerStop();
    updateDisplays(path);
    playerPlay().then(startVisualizer).catch(e => {
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

const trackSkip = dir => ({shiftKey, ctrlKey}) =>
  $.player && ($player.currentTime +=
                 dir * (ctrlKey ? bigSkip : smallSkip)
                     / (shiftKey ? smallerSkipDiv : 1));

const playerNextPrev = down => {
  let item = $.player;
  if (!item) return;
  do { item = nextItem(item, down); }
  while (item && item != $.player && getInfo(item).type != "audio");
  if (item != $.player) play(item);
};

const playerButtonsPlaying = playing =>
  $("playerbuttons").classList.toggle("playing", playing);
$player.addEventListener("play",  ()=> playerButtonsPlaying(true));
$player.addEventListener("pause", ()=> playerButtonsPlaying(false));
$player.addEventListener("ended", ()=> playerNextPrev(true));

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
  // debugger;
  const move = opts && opts.move && (n>0 ? "down" : "up");
  if (!elt) return;
  if (move && isMainItem(elt)) return;
  let result = null;
  while (n != 0) {
    elt = nextItem(elt, n>0, opts);
    if (!elt) break; else result = elt;
    if (n > 0) n--; else n++;
  }
  if (!result) return;
  if (!move) return result.focus();
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

const plistDelete = back => {
  const item = $.selected;
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

const addDragEvents = (elt, op) => {
  let count = 0;
  const YtoElt = e => {
    if (e.target != $plist) {
      return e.pageY - e.target.offsetTop > e.target.offsetHeight / 2
             ? e.target.nextElementSibling : e.target;
    } else {
      const fst = $plist.firstElementChild;
      if (fst && e.pageY <= fst.offsetTop) return fst;
      return null;
    }
  };
  elt.addEventListener("dragover", e => {
    if (!$drag) return;
    stopEvent(e);
    if (elt != $plist) return;
    const di = YtoElt(e);
    if (di) { $.dragitem = di; $.dragitem.classList.remove("bottom"); }
    else if ($.dragitem = $plist.lastElementChild)
      $.dragitem.classList.add("bottom");
  });
  elt.addEventListener("dragenter", e => {
    if (!$drag) return;
    stopEvent(e);
    if (count++ == 0); elt.classList.add("drag-to");
  });
  elt.addEventListener("dragleave", e => {
    if (!$drag) return;
    stopEvent(e);
    if (--count == 0) elt.classList.remove("drag-to"); });
  elt.addEventListener("drop", e => {
    if (!$drag) return;
    stopEvent(e); count = 0; elt.style.backgroundColor = "";
    op(e, $drag, U, elt == $plist ? YtoElt(e) : U);
    $drag = null;
    $.dragitem = null;
  });
};

addDragEvents($("control-panel"), mainOp);
addDragEvents($plist, plistOp);

// ---- player interactions ---------------------------------------------------

bind("Enter", mainOrPlistOp);
bind("Tab", switchMain);
bind("/", ()=> { $search.focus(); $search.select(); });

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
const $volume = $("volume"); $volume.value = 10;
const updateVolume = v => {
  fadeTo($player.defaultVolume = clip01(v));
  $volume.value = Math.round(10 * $player.defaultVolume);
};
$volume.addEventListener("input", ()=> updateVolume((+$volume.value) / 10));
bind("Numpad8", ()=> updateVolume((+$volume.value + 1) / 10));
bind("Numpad2", ()=> updateVolume((+$volume.value - 1) / 10));

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

// ---- search ----------------------------------------------------------------

const $search = $("search");

const showSearch = ()=> {
  if (!search.ok) return removeSearch();
  let n0 = search.origin; if (n0.type != "audio") n0 = n0.nexta;
  const ok = search.ok, fst = all.nexta;
  let n = n0, results = [], later;
  do {
    if (n == fst) { later = results; results = []; }
    const r = ok(n);
    n.elt.classList.toggle("found", r);
    if (r) results.push(n);
  } while ((n = n.nexta) != n0);
  later.forEach(x => results.push(x));
  $search.classList.toggle("not-found", results.length == 0);
  search.results = results;
  search.cur = (results.length - later.length) % results.length;
  showCurSearch();
};

const searchNext = (delta, wrap = true) => {
  if (!search.ok) return;
  const len = search.results.length;
  if (len == 0) return;
  search.cur = wrap ? mod(search.cur + delta, len)
                    : clipRange(0, search.cur + delta, len-1);
  search.origin = showCurSearch();
};

const showCurSearch = ()=> {
  const len = search.results.length;
  if (len == 0) return;
  const cur = search.results[search.cur];
  isHidden(cur.elt) ? showOnly(cur, false) : $.selected = cur.elt;
  cur.elt.scrollIntoView(
    {behavior: "auto", block: "nearest", inline: "nearest"});
  $("result-number").innerText = (search.cur+1) + "/" + len;
  return cur;
};

const removeSearch = ()=> {
  search.results.forEach(n => n.elt.classList.remove("found"));
  $("result-number").innerText = "";
};

const search = e => {
  if (e.type == "focus") return search.origin = getInfo($.selected);
  if (e.type == "blur")  return removeSearch();
  const searchStr = $search.value.toLowerCase().trim().replace(/\s+/g, " ");
  if (search.last == searchStr) return; else search.last = searchStr;
  const searchStrs = searchStr.split(" ");
  search.ok = searchStr == "" ? null
            : n => searchStrs.every(s => n.search.includes(s));
  if (search.timer) clearTimeout(search.timer);
  search.timer = setTimeout(()=> { search.timer = null; showSearch(); }, 250);
};
search.results = [];

const searchKey = e => {
  if (e.key == "Enter") return;
  e.stopImmediatePropagation();
  if (["Escape", "Tab"].includes(e.key)) {
    e.preventDefault(); $.selected.focus(); }
  else if (e.key == "ArrowUp")   searchNext(-1);
  else if (e.key == "ArrowDown") searchNext(+1);
  else if (e.key == "PageUp")    searchNext(-pgSize, false);
  else if (e.key == "PageDown")  searchNext(+pgSize, false);
};

$search.addEventListener("focus", search);
$search.addEventListener("blur",  search);
$search.addEventListener("input", search);
$search.addEventListener("keydown", searchKey);

// ---- initialization --------------------------------------------------------

const addLazyProp = (o, name, get) =>
  Object.defineProperty(o, name, {configurable: true, get: ()=> {
    const value = get(o);
    Object.defineProperty(o, name, {value, writable: true});
    return value;
  }});

const addLazyProps = info => {
  addLazyProp(info, "elt", ()=> $(info.path));
  if (info.type != "audio") return;
  const txt = x => x ? " " + x : "";
  addLazyProp(info, "search", ()=>
    (info.path + txt(info.title) + txt(info.album) + txt(info.track)
     + txt(info.date) + txt(info.artist)).toLowerCase());
};

const setExtras = ()=> {
  let first = null, last = null, border = [all], nexts = [all];
  const loop = parent => parent.children.forEach(child => {
    child.parent = parent;
    if (last) child.preva = last; else border.push(child);
    if (child.type == "audio") {
      if (!first) first = child;
      nexts.forEach(n => n.nexta = child); nexts.length = 0;
      last = child;
    }
    nexts.push(child);
    if (child.children) loop(child);
    addLazyProps(child);
  });
  loop(all);
  addLazyProps(all);
  nexts .forEach(n => n.nexta = first); nexts .length = 0;
  border.forEach(n => n.preva = last ); border.length = 0;
};

$player.path = ""; // made up field
const updateDisplays = (src = $player.path) => {
  if ($player.path != src) $player.src = $player.path = src;
  $("wave-image").src =
    !src ? reddishPNG : "/images" + src.replace(/[.][^.]+$/, ".png");
  updateTimes();
  updateTrackInfo();
};

const init = data => {
  all = data;
  setExtras();
  renderItem($main, all, true);
  $main.firstElementChild.classList.add("open");
  selectNext($main, +1);
  updateDisplays("");
};

fetch("/.player/info", {method: "HEAD"})
  .then(r => localStorage.date == r.headers.get("last-modified")
             && localStorage.all
             ? init(JSON.parse(localStorage.all))
             : (delete localStorage.all,
                localStorage.date = r.headers.get("last-modified"),
                fetch("/.player/info")
                  .then(r => r.json())
                  .then(data => init(processData(data)))));

// ---- visualizations --------------------------------------------------------

const startVisualizer = ()=> {
  if (startVisualizer.aCtx) return;
  const aCtx = startVisualizer.aCtx = new AudioContext();
  const playerAudio = aCtx.createMediaElementSource($player);
  const analyzer = aCtx.createAnalyser();
  analyzer.smoothingTimeConstant = analyzerSmoothing;
  analyzer.fftSize = 2 * analyzerBins;
  playerAudio.connect(aCtx.destination);
  playerAudio.connect(analyzer);
  const bufLen = analyzer.frequencyBinCount, aData = new Uint8Array(bufLen);
  analyzer.getByteTimeDomainData(aData);
  const vCanvas = document.getElementById("visualization");
  let mode = 3;
  const rootS = document.documentElement.style;
  vCanvas.addEventListener("click", ()=> mode = (mode+1) % 4);
  vCanvas.addEventListener("contextmenu", e => {
    $main.classList.toggle("volumebg");
    $plist.classList.toggle("volumebg");
    stopEvent(e);
  });
  const cCtx = vCanvas.getContext("2d");
  const draw = ()=> {
    requestAnimationFrame(draw);
    updateTimes();
    cCtx.clearRect(0, 0, vCanvas.width, vCanvas.height);
    if (!mode) return;
    const sliceWidth = vCanvas.width / bufLen;
    let avg1 = 0, avg2 = 0;
    if (mode & 1) {
      analyzer.getByteFrequencyData(aData);
      cCtx.fillStyle = analyzerBinsColor;
      for (let i = 0, x = 0; i < bufLen; i++, x += sliceWidth) {
        avg1 += aData[i];
        const barHeight = aData[i]/2 + 1;
        cCtx.fillRect(x, vCanvas.height/2 - barHeight/2,
                      sliceWidth+1, barHeight);
      }
      avg1 = clip01(avg1 / bufLen / 128);
    } else avg1 = 0.5;
    if (mode & 2) {
      analyzer.getByteTimeDomainData(aData);
      cCtx.lineWidth = 2; cCtx.strokeStyle = analyzerWaveColor;
      cCtx.beginPath();
      for (let i = 0, x = 0; i < bufLen; i++, x += sliceWidth) {
        avg2 += Math.abs(128 - aData[i]);
        const y = aData[i] * vCanvas.height / 256;
        if (i == 0) cCtx.moveTo(x, y); else cCtx.lineTo(x, y);
      }
      cCtx.lineTo(vCanvas.width, vCanvas.height / 2);
      cCtx.stroke();
      avg2 = clip01(avg2 / bufLen / 64);
    } else avg2 = 0.5;
    rootS.setProperty(
      "--volume",
      `hsl(${Math.round(120*avg2)}deg, 100%, 50%, ${Math.round(100*avg1)}%)`);
  }
  draw();
};

// ----------------------------------------------------------------------------
