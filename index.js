"use strict";

// !!! Adding an item to plist => don't play if something is already playing
//     Add it as the currently playing item if we're adding the playing item
// !!! implement a quick-find thing (over just the current displayed list)
// !!! "/" implement a search filtering for the main list, using the
//     quickfinder from pl

// ---- config ----------------------------------------------------------------

const autoExpandItems = 30;
const pgSize = 10;
const bigSkip = 60, smallSkip = 5, smallerSkipDiv = 2;
const imageDelayTime = 2, imageCycleTime = 60, imageExplicitTime = 120;
const tickerTime = 60, tickerSwapTime = 1;
const waveNeedleColor = "#f00a", waveNeedleWidth = 4;
const analyzerSmoothing = 0.5, analyzerBins = 1024;
const analyzerWaveColor = "#ffcc", analyzerBinsColor = "#844";

// ---- utils -----------------------------------------------------------------

const $ = x => document.getElementById(x);
const rec = f => f((...xs) => rec(f)(...xs));
const isArray = Array.isArray;
const U = undefined;

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

["selected", "player", "altitem"].forEach(prop => {
  let item; Object.defineProperty($, prop, {
    get: ()=> item,
    set: elt => { if (item instanceof Element) item.classList.remove(prop);
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

const $main = $("main");
const $plist = $("playlist");

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
  elt.addEventListener("dragstart", drag);
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
  $player.src = path || "";
  $("wave-image").src =
    !elt ? reddishPNG : "/images" + path.replace(/[.][^.]+$/, ".png");
  updateDisplays();
  if (!elt) return playerStop();
  playerPlay().then(startVisualizer).catch(e => {
    if (e.code != e.ABORT_ERR) throw e; });
  setBackgroundImageLoop(imageDelayTime);
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

const fadeTo = (tgt, cb) => {
  fadeTo.target = tgt;
  fadeTo.cb = cb;
  const fade = ()=> {
    $player.volume = $player.paused ? fadeTo.target
      : clip01($player.volume + ($player.volume<fadeTo.target ? +0.02 : -0.02));
    if (Math.abs($player.volume - fadeTo.target) < 0.018) {
      fadeTo.timer = null;
      if (fadeTo.cb) fadeTo.cb();
      return;
    }
    fadeTo.timer = setTimeout(fade, 10);
  };
  if (!fadeTo.timer) fadeTo.timer = setTimeout(fade, 0);
};

const playerStop = ()=> {
  if (!$.player) return;
  if (!$player.paused) $player.pause();
  $player.currentTime = 0;
};
const playerPause = ()=> {
  if (!$.player) return;
  fadeTo(0, () => $player.pause());
};
const playerPlay  = ()=> {
  if (!$.player) return play();
  if ($player.currentTime > 0) fadeTo($player.defaultVolume);
  else $player.volume = $player.defaultVolume;
  return $player.play();
};
const playerPlayPause = ()=>
  $.player && ($player.paused ? playerPlay() : playerPause());

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

const playerButtonsPlaying = playing => ()=> {
  $("playerbuttons").classList.toggle("playing", playing); };
$player.addEventListener("play",  playerButtonsPlaying(true));
$player.addEventListener("pause", playerButtonsPlaying(false));
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

const expandDir = (elt = $.selected, info = getInfo(elt), expand = "maybe") => {
  if (expand == "maybe") expand = info.size > autoExpandItems || "deep";
  if (expand == "deep") {
    if (info.type != "dir") return;
    elt.parentElement.classList.add("open");
    for (const e of elt.parentElement.querySelectorAll(".list"))
      e.classList.add("open");
  } else if (expand) {
    if (info.type == "dir") elt.parentElement.classList.add("open");
    selectNext(elt, 1);
  } else {
    if (info.type != "dir") {
      elt = elt.parentElement.previousElementSibling;
    } else if (isHidden(elt.nextElementSibling)) {
      elt = elt.parentElement.parentElement.previousElementSibling;
    }
    elt.focus();
    elt.parentElement.classList.remove("open");
    for (const e of elt.parentElement.querySelectorAll(".list"))
      e.classList.remove("open");
  }
};

const showOnly = (elt = $.selected, info = getInfo(elt)) => {
  const elt0 = elt;
  const toSelect = elt.parentElement.classList.contains("only")
                   && nextItem(elt, true);
  for (const e of $main.querySelectorAll(".open"))
    e.classList.remove("open");
  for (const e of $main.querySelectorAll(".only"))
    e.classList.remove("only");
  expandDir(elt, info);
  elt.parentElement.classList.add("open");
  while (elt != $main) {
    elt.classList.add("only");
    elt.classList.add("open");
    elt = elt.parentElement;
  }
  if (toSelect) toSelect.focus();
  else { const elt = elt0 && nextItem(elt0, true); if (elt) elt.focus(); }
};

const mainOrPlistOp = (e, ...more) =>
  (stopEvent(e), (e.ctrlKey ? plistOp : mainOp)(e, ...more));

const mainOp = (ev, elt = $.selected, info = getInfo(elt)) =>
  info.type == "dir"   ? showOnly(elt, info) :
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

const plistOp = (ev, elt = $.selected, info = getInfo(elt)) => {
  if (elt == $main) return;
  if (!isMainItem(elt)) {
    showOnly($(info.parent.path));
    $(info.path).focus();
    return;
  }
  const add = info =>
    info.type == "dir" ? info.children.forEach(add)
    : info.type != "audio" ? U
    : $.altitem ? renderItem($plist, info, false)
    : play($.altitem = renderItem($plist, info, false));
  add(info);
  if (ev instanceof KeyboardEvent)
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

const drag = e => e.dataTransfer.setData("text", getPath(e.target));

$("control").addEventListener("dragover", stopEvent);
$("control").addEventListener("drop", ev => {
  ev.preventDefault();
  mainOp(ev, $(e.dataTransfer.getData("text")));
});

// ---- player interactions ---------------------------------------------------

bind("Enter", mainOrPlistOp);
bind("Tab", switchMain);

bind(["Backspace", "Delete"], e => plistDelete(e.key == "Backspace"));

bind("+", ()=> expandDir(U, U, true),   notCtrl);
bind("-", ()=> expandDir(U, U, false),  notCtrl);
bind("*", ()=> expandDir(U, U, "deep"), notCtrl);

bind("ArrowUp",   e => selectNext(U, -1, {move: e.ctrlKey}));
bind("ArrowDown", e => selectNext(U, +1, {move: e.ctrlKey}));
bind("PageUp",    e => selectNext(U, -pgSize, {wrap: false, move: e.ctrlKey}));
bind("PageDown",  e => selectNext(U, +pgSize, {wrap: false, move: e.ctrlKey}));
bind("Home",      e => selectEdge(+1, {move: e.ctrlKey}));
bind("End",       e => selectEdge(-1, {move: e.ctrlKey}));

bind([" ", "Numpad5"], ()=> playerPlayPause());
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

const percentJump = e =>
  $player.currentTime =
    (+e.code.substring(e.code.length-1)) * $player.duration / 10;
bind("0123456789".split("").map(d => "Digit"+d), percentJump);

$player.defaultVolume = 1; $("volume").value = 10;
const $volume = $("volume");
const updateVolume = v => {
  fadeTo($player.defaultVolume = clip01(v));
  $volume.value = Math.round(10 * $player.defaultVolume);
};
$volume.addEventListener("input", ()=> updateVolume((+$volume.value) / 10));
bind("Numpad8", ()=> updateVolume((+$volume.value + 1) / 10));
bind("Numpad2", ()=> updateVolume((+$volume.value - 1) / 10));

// ---- time display ----------------------------------------------------------

const $dur = $("dur"), $time = $("time");
let shownTime = "xxx", shownURL = null;
const formatTime = t => {
  const s = Math.abs(t) % 60;
  return Math.floor(t/60) + ":" + (s<10 ? "0" : "") + s; };

const updateTimes = ()=> {
  if (!Number.isFinite($player.duration) || !$.player) {
    if (shownTime) { shownTime = null; }
    if (shownURL)  { shownTime = null; }
    $dur.innerText = $time.innerText = "–:––";
    return;
  }
  if (shownURL != $player.src && $player.duration) {
    shownURL = $player.src;
    $dur.innerText = formatTime(Math.round($player.duration));
  }
  let t = $player.currentTime;
  if (timeRemaining) t = $player.duration - t;
  t = Math.round(t);
  if (shownTime != t) {
    shownTime = t;
    $time.innerText = (timeRemaining ? "-" : "") + formatTime(t);
  }
};

// ---- info display ----------------------------------------------------------

const infoDisplay = (()=> {
  const infoDiv = $("track-info"), textDiv = infoDiv.firstElementChild;
  const START = 0, END = 1, CLEARSTART = 2, CLEAREND = 3, NEWTEXT = 4;
  let initialized = false, state = START, newText = "", moveTo = 0;
  //
  const move = (x, st, {time = tickerTime, text = undefined,
                        fun = "ease-in-out"} = {}) => {
    if (text !== undefined) {
      textDiv.innerText = text;
      moveTo = infoDiv.offsetWidth - textDiv.scrollWidth;
    }
    if (textDiv.innerText == "" && state == NEWTEXT) return;
    textDiv.style.transition = `left ${time}s ${fun}`;
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

// ---- initialization --------------------------------------------------------

const setParent = parent => parent.children && parent.children.forEach(
  child => { child.parent = parent; setParent(child); });

const updateDisplays = ()=> (updateTimes(), updateTrackInfo());

const init = data => {
  all = data;
  setParent(all);
  renderItem($main, all, true);
  $main.firstElementChild.classList.add("open");
  selectNext($main, +1);
  $("wave-image").src = reddishPNG;
  updateDisplays();
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
  playerAudio.connect(analyzer);
  playerAudio.connect(aCtx.destination);
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
