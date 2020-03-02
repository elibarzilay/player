"use strict";

// !!! Delete on playlist: remove item
//     C-Up, C-Down: move items up/down
// !!! "/" implement a search filtering for the main list, using the
//     quickfinder from pl

// ---- utils -----------------------------------------------------------------

const $ = x => document.getElementById(x);
const rec = f => f((...xs) => rec(f)(...xs));
const isArray = Array.isArray;

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
    set: elt => { if (item) item.classList.remove(prop);
                  (item = elt).classList.add(prop); } });
});

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
      info.size = info.children.map(c => c.size || 1).reduce((x,y) => x+y, 0) + 1;
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
const isMainItem = elt => !!elt.id

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

const skipAmounts = [5, 2, 60, 30]; // none, shift, ctrl, shift+ctrl

const $player = $("player");
const play = (elt = $.selected) => {
  if (typeof elt == "string") elt = $(elt);
  if (!elt || getInfo(elt).type != "audio") return;
  const path = getPath(elt);
  $.player = elt;
  $player.src = path; playerPlay().then(startVisualizer).catch(e => {
    if (e.code != e.ABORT_ERR) throw e; });
  $("wave-image").src = "/images" + path.replace(/[.][^.]+$/, ".png");
  setBackgroundImageLoop(1000);
};

let unders = [...document.getElementsByClassName("under")];
const setBackgroundImageLoop = s => {
  if (!s) { setBackgroundImage(); s = 60000; } // cycle
  if (setBackgroundImageLoop.timer)
    clearTimeout(setBackgroundImageLoop.timer);
  setBackgroundImageLoop.timer = setTimeout(setBackgroundImageLoop, s);
};
const setBackgroundImage = (eltOrPath = $.player) => {
  if (!eltOrPath) return setBackgroundImage();
  if (typeof eltOrPath == "string") // explicit: delay cycling for a while
    setBackgroundImageLoop(120000);
  else {
    const info = getInfo(eltOrPath).parent;
    if (!info.images) {
      info.images =
        info.children.filter(n => n.type == "image").map(n => n.path);
      info.curImages = [];
    };
    if (!info.images.length) return;
    if (info.images.length == 1) eltOrPath = info.images[0];
    else {
      if (!info.curImages.length) info.curImages = shuffle(info.images);
      eltOrPath = info.curImages.pop();
    }
  }
  if (unders[0].src == new URL(eltOrPath, document.baseURI).href) return;
  unders[0].style.opacity = "";
  [unders[1], unders[0]] = [...unders];
  unders[0].src = eltOrPath;
  unders[0].style.opacity = 1.0;
};

const fadeTo = (tgt, cb) => {
  fadeTo.target = tgt;
  fadeTo.cb = cb;
  const fade = ()=> {
    $player.volume =
      clip01($player.volume + ($player.volume < fadeTo.target ? +0.02 : -0.02));
    if ($player.volume == fadeTo.target) {
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
                 dir * skipAmounts[(shiftKey?1:0) + 2*(ctrlKey?1:0)]);

const playerNextPrev = down => {
  let item = $.player;
  if (!item) return;
  do { item = nextItem(item, down); if (!item) return; }
  while (item != $.player && getInfo(item).type != "audio");
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
  const {wrap = true, sub = true} = opts;
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
  return loopUp((!sub && getInfo(elt).type == "dir") ? elt.parentElement : elt);
};

let timeRemaining = false;
$("times").addEventListener("click", ()=> timeRemaining = !timeRemaining);

// ---- navigation interactions -----------------------------------------------

const stopEvent = e => { e.preventDefault(); e.stopImmediatePropagation(); };

const selectNext = (elt = $.selected, n = 0, opts) => {
  if (!elt) return;
  let result = null;
  while (n != 0) {
    elt = nextItem(elt, n>0, opts);
    if (!elt) break; else result = elt;
    if (n > 0) n--; else n++;
  }
  if (result) result.focus();
};
const selectEdge = n =>
  selectNext(($.selected && !isMainItem($.selected)) ? $plist : $main, n);

const expandDir = (elt = $.selected, info = getInfo(elt), expand = "maybe") => {
  if (expand == "maybe") expand = info.size > 30 || "deep";
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

const mainOrPlistOp = (ev, ...more) =>
  (stopEvent(ev), (ev.ctrlKey ? plistOp : mainOp)(ev, ...more));

const mainOp = (ev, elt = $.selected, info = getInfo(elt)) =>
  info.type == "dir"   ? showOnly(elt, info) :
  info.type == "audio" ? play(elt) :
  info.type == "image" ? setBackgroundImage(info.path) :
  window.open(info.path, "_blank");

const bindings = new Map(), bind = (keys, op) =>
  (isArray(keys) ? keys : [keys]).forEach(k => bindings.set(k, op));
window.addEventListener("keydown", e => {
  const b = bindings.get(e.key) || bindings.get(e.code);
  if (!b) return;
  stopEvent(e);
  b(e);
});

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
    : info.type != "audio" ? undefined
    : $.altitem ? renderItem($plist, info, false)
    : $.altitem = renderItem($plist, info, false);
  add(info);
  if (ev instanceof KeyboardEvent)
    selectNext(undefined, +1, {wrap: false, sub: false});
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

bind("+", ()=> expandDir(undefined, undefined, true));
bind("-", ()=> expandDir(undefined, undefined, false));
bind("*", ()=> expandDir(undefined, undefined, "deep"));

bind("ArrowUp",   ()=> selectNext(undefined, -1));
bind("ArrowDown", ()=> selectNext(undefined, +1));
bind("PageUp",    ()=> selectNext(undefined, -5, {wrap: false}));
bind("PageDown",  ()=> selectNext(undefined, +5, {wrap: false}));
bind("Home",      ()=> selectEdge(+1));
bind("End",       ()=> selectEdge(-1));

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
$("volume").addEventListener("input", e =>
  fadeTo($player.defaultVolume = e.target.value / 10));

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

// ---- waveform control ------------------------------------------------------

const wCanvas = $("wave-canvas"), ctx = wCanvas.getContext("2d");
const drawPlayerLine = ()=> {
  ctx.clearRect(0, 0, wCanvas.width, wCanvas.height);
  ctx.fillStyle = "#f00";
  ctx.fillRect(($player.currentTime/$player.duration)*wCanvas.width - 1,
               0, 2, wCanvas.height);
};
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

const init = data => {
  all = data;
  setParent(all);
  renderItem($main, all, true);
  $main.firstElementChild.classList.add("open");
  selectNext($main, +1);
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
  const analyser = aCtx.createAnalyser();
  analyser.smoothingTimeConstant = 0.5; analyser.fftSize = 2048;
  playerAudio.connect(analyser);
  playerAudio.connect(aCtx.destination);
  const bufLen = analyser.frequencyBinCount, aData = new Uint8Array(bufLen);
  analyser.getByteTimeDomainData(aData);
  const vCanvas = document.getElementById("visualization");
  let mode = 3;
  vCanvas.addEventListener("click", ()=> mode = (mode+1) % 4);
  const cCtx = vCanvas.getContext("2d");
  const draw = ()=> {
    requestAnimationFrame(draw);
    updateTimes();
    cCtx.clearRect(0, 0, vCanvas.width, vCanvas.height);
    if (!mode) return;
    const sliceWidth = vCanvas.width / bufLen;
    if (mode & 1) {
      analyser.getByteFrequencyData(aData);
      cCtx.fillStyle = "#844";
      for (let i = 0, x = 0; i < bufLen; i++, x += sliceWidth) {
        const barHeight = aData[i]/2 + 1;
        cCtx.fillRect(x, vCanvas.height/2 - barHeight/2, sliceWidth+1, barHeight);
      }
    }
    if (mode & 2) {
      analyser.getByteTimeDomainData(aData);
      cCtx.lineWidth = 2; cCtx.strokeStyle = "#fffc";
      cCtx.beginPath();
      for (let i = 0, x = 0; i < bufLen; i++, x += sliceWidth) {
        const y = aData[i] * vCanvas.height / 256;
        if (i == 0) cCtx.moveTo(x, y); else cCtx.lineTo(x, y);
      }
      cCtx.lineTo(vCanvas.width, vCanvas.height / 2);
      cCtx.stroke();
    }
  }
  draw();
}

// ----------------------------------------------------------------------------
