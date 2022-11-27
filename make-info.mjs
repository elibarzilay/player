#!/usr/bin/env node

const conf = {
  infoDir:   "",
  infoFile:  "info.json",
  rawFile:   "info-raw.json",
  musicDir:  "..",
  imagesDir: "images",
  beatsDir:  "beats",
  imageSize: "960x160",
};

const types = {
  mp3: "audio", ogg: "audio", m4a: "audio", wma: "audio",
  jpg: "image", png: "image",
  mpg: "video",
  pdf: "other", txt: "other", flp: "other",
};

// * Test mp3 errors with mp3val -si ...file...; fix with -f
// * There is also mpck (checkmate), needs to install from source, does't find
//   more problems than mp3val

// ----------------------------------------------------------------------------

import { join, basename, dirname, relative } from "path";
import * as fs from "fs";
import * as os from "os";

const failWith = msg => { console.error(`Error, ${msg}`); process.exit(1); };

import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

const home = path => "~/" + relative(os.homedir(), path);

const newerFile = (file1, file2) => {
  const [s1, s2] = [file1, file2].map(f =>
    fs.statSync(f, { bigint: true, throwIfNoEntry: false }));
  return s1 && s2 && s1.mtimeMs > s2.mtimeMs;
};

import { spawnSync } from "child_process";
const runGeneric = stdio => (cmd, ...args) => {
  const p = spawnSync(cmd, args, { stdio });
  if (p.status) failWith(`${cmd} failed with error code: ${p.status}`);
  if (p.signal) failWith(`${cmd} aborted with signal: ${p.signal}`);
  if (p.error) failWith(`${cmd} errored: ${p.error.message ?? p.error}`);
  const hasOut = stdio[1] === "pipe", hasErr = stdio[2] === "pipe";
  const out = hasOut && p.stdout.toString().trim();
  const err = hasErr && p.stderr.toString().trim();
  return hasOut && hasErr ? [ out, err ] : hasOut ? out : err;
};
const run = runGeneric([ "ignore", "inherit", "inherit" ]);
const runGet = runGeneric([ "ignore", "pipe", "inherit" ]);
const runGetBoth = runGeneric([ "ignore", "pipe", "pipe" ]);

const mapGetSet = (map, key, val) => {
  const v1 = map.get(key);
  if (v1) return v1;
  if (typeof val === "function") val = val();
  map.set(key, val);
  return val;
};

// const crypto = require("crypto");
// const fileHash = path =>
//   crypto.createHash("sha1").update(fs.readFileSync(path)).digest("hex");
import mPkg from "murmurhash-native";
const { murmurHash } = mPkg;

const fileHash = path => murmurHash(fs.readFileSync(path)).toString(36);

import * as zlib from "zlib";
const readFile = file => {
  const tryReading = (file, decompress) => {
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!(st && st.isFile())) return null;
    const data = fs.readFileSync(file);
    if (!decompress) return data;
    return decompress(data);
  };
  return tryReading(file, null)
      || tryReading(file + ".gz", zlib.gunzipSync)
      || tryReading(file + ".br", zlib.brotliDecompressSync);
};
const writeFile = (file, contents) =>
  fs.writeFileSync(
    file,
    file.endsWith(".br")   ? zlib.brotliCompressSync(contents)
    : file.endsWith(".gz") ? zlib.gzipSync(contents)
    : contents);

const verCompare = (s1, s2) => {
  let i1 = 0, i2 = 0;
  const isDigit = c => "0" <= c && c <= "9";
  while (i1 < s1.length && i2 < s2.length) {
    const c1 = s1[i1], c2 = s2[i2];
    if (!(isDigit(c1) && isDigit(c2))) {
      if (c1 === c2) { i1++; i2++; continue; }
      return c1 < c2 ? -1 : +1;
    }
    const getNum = (s, i0) => {
      let i = i0 + 1;
      while (i < s.length && isDigit(s[i])) i++;
      return [+s.substring(i0, i), i];
    }
    let n1, n2;
    [n1, i1] = getNum(s1, i1);
    [n2, i2] = getNum(s2, i2);
    if (n1 !== n2) return n1 < n2 ? -1 : +1;
  }
  return i1 === s1.length && i2 === s2.length ? 0 : i1 === s1.length ? -1 : +1;
};

const isPlainObject = x => {
  if (typeof x !== "object" || x === null) return false;
  const prototype = Object.getPrototypeOf(x);
  return prototype === Object.prototype || prototype === null;
};

const kvMap = (fk, fv) => {
  const loop = x =>
    Array.isArray(x) ? x.map(loop)
    : !isPlainObject(x) ? fv(x)
    : Object.fromEntries(Object.entries(x).map(([k, v]) => [fk(k), loop(v)]));
  return loop;
};

// set conf.*Dir and conf.*File to actual paths
Object.keys(conf).forEach(k => {
  const t = k.match(/[A-Z][a-z]+$/)?.[0];
  if (!["Dir", "File"].includes(t)) return;
  conf[k] = join(__dirname, conf[k]);
  if (t !== "Dir") return;
  try {
    if (!fs.statSync(conf[k]).isDirectory()) { throw true; }
  } catch (e) {
    failWith(`missing directory for conf.${k}: ${conf[k]}`);
  }
});

const hostname = runGet("hostname", "-s");
let totalPaths = 0;

const getInfo = dir => {
  const ps = fs.readdirSync(dir ?? ".", { withFileTypes: true })
               .sort((p1, p2) => verCompare(p1.name, p2.name));
  const children = [];
  ps.forEach(p => {
    const name = p.name, path = !dir ? name : join(dir, name);
    if (!dir && name.startsWith(".")) return;
    if (p.isSymbolicLink()) failWith(`unexpected symlink: ${path}`);
    if (p.isDirectory()) return children.push(getInfo(path));
    if (!p.isFile()) return failWith(`unknown file type: ${path}`);
    if (!dir) return failWith(`bad toplevel file: ${p.name}`);
    const type = types[name.replace(/^.*\./, "")];
    if (!type) failWith(`unknown file type: ${path}`);
    const st = fs.statSync(path, { bigint: true });
    const stamp =
      ["size", "mtimeMs", "ctimeMs"].map(k => st[k].toString(36)).join(" ");
    children.push({ name, m: { path, stamp }, type });
  });
  totalPaths += children.length;
  return { name: dir ? basename(dir) : "", type: "dir",
           m: { path: dir ?? "." }, children };
};

const makeCounter = what => {
  if (!what) return () => {};
  let n = totalPaths, last = null;
  return done => {
    if (n === null) return;
    if (done || --n < 0) {
      n = null;
      return process.stdout.write(`${what} ... done\n`);
    }
    const pct = Math.ceil(100 * n / totalPaths);
    if (last === pct) return;
    process.stdout.write(`${what} ...${String(last = pct).padStart(3)}%\r`);
  };
};

const getCachedInfo = () => {
  let data = null;
  const warn = msg =>
    console.error(`Warning, no old info in: ${conf.rawFile}, ${msg}`);
  data = readFile(conf.rawFile);
  if (!data) return warn(`missing file`);
  try {
    data = JSON.parse(data);
  } catch (e) {
    return warn(`could not parse data`);
  }
  if (!(data?.hostname && data?.info)) return warn(`bad data`);
  const sameHost = data.hostname === hostname;
  if (!sameHost)
    console.error(`Warning, running on a different host,`
                  + ` using only hashes (ignoring timestamps)`);
  const updateEntry = (info, cache) => {};
  const c = makeCounter(`Merging cached values`);
  const loopBoth = (info, cache) => {
    c();
    if (!cache || info.type !== cache.type) return;
    if (info.type === "dir")
      return info.children.forEach(child =>
        loopBoth(child, cache.children.find(c => c.name === child.name)));
    if (sameHost && info.m.stamp === cache.m.stamp)
      return info.m = Object.assign({}, cache.m, info.m);
    info.m.hash = fileHash(info.m.path);
    if (info.m.hash === cache.m.hash)
      return info.m = Object.assign({}, cache.m, info.m);
  };
  loopBoth(info, data.info);
  c(true);
};

const infoForEach = (what, dirs, f) => {
  const c = makeCounter(what);
  const loop = info => {
    c();
    const isDir = info.type === "dir";
    if (!isDir || dirs) f(info);
    if (isDir) info.children.forEach(loop);
  };
  loop(info);
  c(true);
};

const sanityTests = () => infoForEach(
  "Sanity tests", true, ({ name, type, m: { path }, children }) => {
    const isDir = type === "dir";
    const bad = what => failWith(`${what} in: ${path}`);
    const has = (fs.statSync(path).mode & 0o777).toString(8);
    const want = isDir ? "755" : "644";
    if (has !== want) bad(`bad permissions, expected ${want}, got ${has}`);
    const badChar = name.match(/[^\w.+-]/)?.[0];
    if (badChar) bad(`bad char (${badChar})`);
    if (isDir && name.match(/\./)) bad(`dot in directory name`);
    if (!isDir && name.match(/\..*\./)) bad(`two dots`);
    if (name.match(/^\W/)) bad(`initial separator`);
    if (name.match(/\W\W/)) bad(`consecutive separators`);
    if (isDir) {
      const audios = children
        .filter(c => c.type === "audio")
        .map(c => c.name.replace(/\..*$/, ""));
      if ((new Set(audios)).size !== audios.length)
        bad(`duplicate base names`);
    }
  });

const findDuplicates = () => {
  const hashes = new Map();
  infoForEach("Compute hashes and find duplicates", false, ({ m }) =>
    mapGetSet(hashes, (m.hash ??= fileHash(m.path)), ()=>[])
      .push(m.path));
  for (const paths of hashes.values())
    if (paths.length > 1)
      console.log(`Duplicates:\n  ${paths.join("\n  ")}`);
};

const cleanupData = kvMap(
  // downcase keys, redundant quotes, and silly \\x0 (from amazon)
  s => s.toLowerCase(),
  v => typeof v !== "string" ? v : v.trim()
    .replace(/^"\s*(.*)\s*"$/, "$1").replace(/^(?:\\x00)+$/, ""),
);
const getAudioData = () => infoForEach("Reading metadata", false, info => {
  if (info.type !== "audio") return;
  info.m.audioData ??= cleanupData(JSON.parse(runGet(
    "ffprobe",
    "-hide_banner",
    "-loglevel", "error",
    "-show_error",
    "-show_format",
    "-show_streams",
    "-show_programs",
    "-show_chapters",
    "-show_private_data",
    "-print_format", "json",
    info.m.path)));
  const format = info.m.audioData.format;
  const streams =
    info.m.audioData.streams.filter(s => s.codec_type === "audio");
  if (streams.length !== 1)
    failWith(`${streams.length ? "more than one" : "no"
              } audio stream for ${info.m.path}`);
});

const safeWrite = (what, data, file) => {
  const temp = join(dirname(file), "TEMP-" + basename(file));
  console.log(`Writing ${what} to ${home(file)}`);
  writeFile(temp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(temp, file);
};

const setAudioData = () => infoForEach(
  "Setting audio metadata", false, info => {
    if (info.type !== "audio") return;
    const ad = info.m.audioData;
    const streams = ad.streams.filter(s => s.codec_type === "audio");
    const str = streams.length === 1 ? streams[0]
          : failWith(`${streams.length ? "more than one" : "no"
                       } audio stream for ${info.m.path}`);
    const fmt = ad.format;
    const props = Object.assign({}, fmt, str, fmt.tags, str.tags);
    const pCopy = (o1, k1, o2, k2) =>
      k1 in o1 && !(k2 in o2) && (o2[k2] = o1[k1]);
    pCopy(props, "tracknumber", props, "track");
    pCopy(props, "totaltracks", props, "tracktotal");
    if (props.track && props.tracktotal && !props.track.includes("/"))
      props.track = `${props.track}/${props.tracktotal}`;
    pCopy(props, "album_artist", props, "artist");
    pCopy(props, "albumartist", props, "artist");
    if (str.duration && fmt.duration && str.duration !== fmt.duration)
      failWith(`${info.m.path}: str = ${str.duration}, fmt = ${fmt.duration}`);
    ["title", "track", "album", "artist", "genre", "date", "duration"
    ].forEach(k => pCopy(props, k, info, k));
  });

const removeMetaInfo = () => infoForEach(null, true, info => delete info.m);

const genFiles = (genDir, ext, gen) => {
  const dotExt = "." + ext;
  const del = path => {
    if (!del.shown) console.log(`Removing junk contents in ${home(genDir)}`);
    del.shown = true;
    console.log(`  ${home(path)}`);
    fs.rmSync(path, { recursive: true, force: true });
  };
  const rmLoop = (dir, children) =>
    fs.readdirSync(dir, { withFileTypes: true }).forEach(p => {
      const rm = () => del(join(dir, p.name));
      if (p.isSymbolicLink()) return rm();
      if (p.isDirectory()) {
        const sub = children.find(s => s.type === "dir" && s.name === p.name);
        return !sub ? rm() : rmLoop(join(dir, p.name), sub.children);
      }
      const noExt = p.name.slice(0, -ext.length);
      if (!(p.isFile() && p.name.endsWith(dotExt)
            && children.find(s => s.type === "audio"
                               && s.name.startsWith(noExt))))
        return rm();
    });
  const mkLoop = info => {
    if (info.type === "dir") {
      fs.mkdirSync(join(genDir, info.m.path), { recursive: true });
      return info.children.forEach(mkLoop);
    }
    if (info.type !== "audio") return;
    const src = info.m.path;
    const tgtExt = info.m.path.replace(/\.[^.\/]+$/, dotExt);
    const tgt = join(genDir, tgtExt);
    if (newerFile(tgt, src)) return;
    if (!mkLoop.shown) console.log(`Making files in ${home(genDir)}`);
    mkLoop.shown = true;
    console.log(`  ${tgtExt}`);
    fs.rmSync(tgt, { recursive: true, force: true });
    gen(src, tgt);
    if (!newerFile(tgt, src)) failWith(`Failed to generate ${home(tgt)}`);
  };
  rmLoop(genDir, info.children);
  mkLoop(info);
};

const imageGen = [
  // https://trac.ffmpeg.org/wiki/Waveform
  `[0:a]compand,channelsplit=channel_layout=stereo[FL][FR]`,
  `[FR]showwavespic=s=${conf.imageSize}:colors=white,crop=iw:ih/2:0:0[r]`,
  `[FL]showwavespic=s=${conf.imageSize}:colors=white,crop=iw:ih/2:0:ih/2[l]`,
  `color=s=${conf.imageSize}:color=#00000000[bg]`,
  `[bg][r]overlay=format=auto[t]`,
  `[t][l]overlay=y=main_h/2:format=auto`,
].join(";");
const mkImage = (src, tgt) =>
  run("ffmpeg", "-hide_banner", "-loglevel", "error",
      "-i", src, "-filter_complex", imageGen, "-frames:v", "1", tgt);

// Note: `aubiotrack` is a binary, `aubio beat` is a python script. Also, the
// man page is outdated, the default bufsize/hopsize are 1024/512 (= the listed
// default for `aubio beat`). Also, ignore some stderr lines that are
// unavoidable(?).
const mkAubio = exe => (src, tgt) => {
  const [data, err] = runGetBoth(exe, "-i", src);
  if (!data.match(/^\d+\.\d+\n/)) failWith(`failed to get beats from: ${src}`);
  const realErr = (err + "\n")
    .replace(/.*timestamps for (?:skipped|discarded) samples.*\n/g, "")
    .replace(/.*overread, skip .* enddists:.*\n/g, "")
    .replace(/\n$/, "");
  if (realErr.length) console.error(realErr);
  writeFile(tgt, `[\n${data.replace(/\n/g, ",\n")}\n]\n`);
};
const mkBeats = mkAubio("aubiotrack");
const mkOnsets = mkAubio("aubioonset"); // might be useful for visualizations?

process.chdir(conf.musicDir);

const info = getInfo(null, true);
console.log(`${totalPaths} paths found`);
getCachedInfo();
sanityTests();
findDuplicates();
getAudioData();
safeWrite("raw data", { hostname, info }, `${conf.rawFile}.gz`);
setAudioData();
genFiles(conf.imagesDir, "png", mkImage);
genFiles(conf.beatsDir, "json", mkBeats);
removeMetaInfo();
safeWrite("info", info, `${conf.infoFile}`);
