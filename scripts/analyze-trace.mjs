#!/usr/bin/env node
// Streamingly analyze a Chrome/Edge DevTools Performance trace JSON.
// Format: {"metadata":{...},"traceEvents":[{...},{...},...]}
// We split on event boundaries by tracking brace depth + string state to avoid
// loading the full 339MB into memory.

import { createReadStream, statSync } from 'node:fs';

const PATH = process.argv[2];
if (!PATH) { console.error('usage: analyze-trace.mjs <trace.json>'); process.exit(1); }

const stats = {
  totalEvents: 0,
  byCat: new Map(),
  byName: new Map(),
  longTasks: [],                // {name, cat, dur_ms, ts, args}
  fetchCount: 0,
  urls: new Map(),              // url -> count
  timerFireByCallsite: new Map(),// stack hash -> count
  functionTime: new Map(),       // function name -> total dur_ms (FunctionCall/ProfileChunk)
  jsSamples: new Map(),          // sampled function name -> hits (from CpuProfile if present)
  layoutCount: 0,
  recalcStyleCount: 0,
  paintCount: 0,
  rafCallbacks: 0,
  v8Compile: 0,
  evt_TimerFire: 0,
  evt_FunctionCall: 0,
  minTs: Infinity,
  maxTs: -Infinity,
};

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function processEvent(e) {
  stats.totalEvents++;
  if (e.cat) bump(stats.byCat, e.cat);
  if (e.name) bump(stats.byName, e.name);
  if (typeof e.ts === 'number') {
    if (e.ts < stats.minTs) stats.minTs = e.ts;
    if (e.ts > stats.maxTs) stats.maxTs = e.ts;
  }

  const dur = typeof e.dur === 'number' ? e.dur : 0;
  const dur_ms = dur / 1000;

  if (e.name === 'TimerFire') stats.evt_TimerFire++;
  if (e.name === 'FunctionCall') {
    stats.evt_FunctionCall++;
    const fn = e.args?.data?.functionName || '<anon>';
    const url = e.args?.data?.scriptName || e.args?.data?.url || '';
    const key = `${fn} @ ${url}`;
    bump(stats.functionTime, key, dur_ms);
  }
  if (e.name === 'Layout') stats.layoutCount++;
  if (e.name === 'RecalculateStyles' || e.name === 'UpdateLayoutTree') stats.recalcStyleCount++;
  if (e.name === 'Paint') stats.paintCount++;
  if (e.name === 'FireAnimationFrame') stats.rafCallbacks++;
  if (e.name === 'v8.compile') stats.v8Compile++;

  if (e.name === 'ResourceSendRequest') {
    stats.fetchCount++;
    const url = e.args?.data?.url;
    if (url) bump(stats.urls, url);
  }

  // Long task threshold: 50ms = 50000 us
  if (dur >= 50000 && (e.cat?.includes('devtools.timeline') || e.cat === 'disabled-by-default-devtools.timeline' || e.cat?.includes('blink') || e.cat?.includes('v8'))) {
    stats.longTasks.push({
      name: e.name,
      cat: e.cat,
      dur_ms,
      ts: e.ts,
      tid: e.tid,
      argsBrief: briefArgs(e.args),
    });
  }

  // CPU profile samples (if format=profileChunk)
  if (e.name === 'ProfileChunk' && e.args?.data?.cpuProfile?.nodes) {
    // Build node->fn map; bump stats.jsSamples by sample hit (lightweight)
    const nodes = e.args.data.cpuProfile.nodes;
    const samples = e.args.data.cpuProfile.samples || [];
    const fnByNode = new Map();
    for (const n of nodes) {
      const f = n.callFrame;
      fnByNode.set(n.id, `${f.functionName || '<anon>'} @ ${f.url || ''}:${f.lineNumber ?? '?'}`);
    }
    for (const id of samples) {
      const fn = fnByNode.get(id);
      if (fn) bump(stats.jsSamples, fn);
    }
  }
}

function briefArgs(a) {
  if (!a) return undefined;
  try {
    const s = JSON.stringify(a);
    return s.length > 240 ? s.slice(0, 240) + '...' : s;
  } catch { return undefined; }
}

// Streaming splitter: read chunks, scan for event boundaries inside traceEvents array.
// We rely on the fact that events are JSON objects separated by `,\n` inside the array.
const fileSize = statSync(PATH).size;
let inArray = false;       // are we past `"traceEvents":[`
let depth = 0;             // brace depth INSIDE current event
let inString = false;
let escape = false;
let buf = '';
let processedBytes = 0;
let progressTick = 0;

const stream = createReadStream(PATH, { encoding: 'utf8', highWaterMark: 4 * 1024 * 1024 });

stream.on('data', (chunk) => {
  processedBytes += Buffer.byteLength(chunk);
  if (++progressTick % 8 === 0) {
    const pct = ((processedBytes / fileSize) * 100).toFixed(1);
    process.stderr.write(`  ...${pct}% (${stats.totalEvents.toLocaleString()} events)\r`);
  }

  let i = 0;
  if (!inArray) {
    const idx = chunk.indexOf('"traceEvents"');
    if (idx === -1) return; // still in metadata
    const open = chunk.indexOf('[', idx);
    if (open === -1) return;
    i = open + 1;
    inArray = true;
  }

  for (; i < chunk.length; i++) {
    const ch = chunk[i];

    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      buf += ch;
      continue;
    }

    if (ch === '"') { inString = true; buf += ch; continue; }
    if (ch === '{') { depth++; buf += ch; continue; }
    if (ch === '}') {
      depth--;
      buf += ch;
      if (depth === 0) {
        // We have a full event in buf
        const trimmed = buf.trim().replace(/^,/, '').trim();
        if (trimmed.startsWith('{')) {
          try {
            const e = JSON.parse(trimmed);
            processEvent(e);
          } catch (err) {
            // skip malformed
          }
        }
        buf = '';
      }
      continue;
    }

    if (depth === 0) {
      // outside any event (comma, whitespace, or closing ])
      if (ch === ']') {
        // end of traceEvents array; we can stop reading
        stream.destroy();
        return;
      }
      // ignore
      continue;
    }

    buf += ch;
  }
});

stream.on('close', report);
stream.on('end', report);

let reported = false;
function report() {
  if (reported) return;
  reported = true;
  process.stderr.write('\n');

  const durTotalMs = (stats.maxTs - stats.minTs) / 1000;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Trace summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`File: ${PATH}`);
  console.log(`File size: ${(fileSize / 1e6).toFixed(1)} MB`);
  console.log(`Total events: ${stats.totalEvents.toLocaleString()}`);
  console.log(`Wall-clock span: ${(durTotalMs / 1000).toFixed(2)} s`);
  console.log();
  console.log('Aggregate counts');
  console.log('─'.repeat(63));
  console.log(`  ResourceSendRequest:  ${stats.fetchCount}`);
  console.log(`  FunctionCall events:  ${stats.evt_FunctionCall}`);
  console.log(`  TimerFire events:     ${stats.evt_TimerFire}`);
  console.log(`  RAF callbacks:        ${stats.rafCallbacks}`);
  console.log(`  Layout events:        ${stats.layoutCount}`);
  console.log(`  RecalculateStyles:    ${stats.recalcStyleCount}`);
  console.log(`  Paint events:         ${stats.paintCount}`);
  console.log(`  v8.compile:           ${stats.v8Compile}`);
  console.log();

  // Top fetch URLs (group by pathname to spot polling)
  console.log(`Top 20 fetched URLs (total ${stats.fetchCount}):`);
  console.log('─'.repeat(63));
  const urlByPath = new Map();
  for (const [url, count] of stats.urls) {
    try {
      const u = new URL(url);
      const key = `${u.origin}${u.pathname}`;
      bump(urlByPath, key, count);
    } catch {
      bump(urlByPath, url, count);
    }
  }
  const topUrls = [...urlByPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [url, count] of topUrls) {
    console.log(`  ${String(count).padStart(5)}  ${url}`);
  }
  console.log();

  // Top long tasks
  const longSorted = stats.longTasks.sort((a, b) => b.dur_ms - a.dur_ms).slice(0, 20);
  console.log(`Top 20 long tasks (>50ms; total ${stats.longTasks.length}):`);
  console.log('─'.repeat(63));
  for (const t of longSorted) {
    console.log(`  ${t.dur_ms.toFixed(1).padStart(7)} ms  ${t.name.padEnd(28)}  ${t.cat || ''}`);
    if (t.argsBrief) console.log(`         args: ${t.argsBrief}`);
  }
  console.log();

  // Hottest functions by total FunctionCall dur
  const fnSorted = [...stats.functionTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('Top 20 functions by total FunctionCall duration (ms):');
  console.log('─'.repeat(63));
  for (const [fn, ms] of fnSorted) {
    if (ms < 1) break;
    console.log(`  ${ms.toFixed(1).padStart(8)}  ${fn}`);
  }
  console.log();

  // CPU sampler hottest functions
  const jsSorted = [...stats.jsSamples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  if (jsSorted.length) {
    const totalHits = jsSorted.reduce((s, [, n]) => s + n, 0);
    console.log(`Top 25 sampled JS frames (CPU; ${totalHits} hits accumulated):`);
    console.log('─'.repeat(63));
    for (const [fn, hits] of jsSorted) {
      console.log(`  ${String(hits).padStart(6)}  ${fn}`);
    }
    console.log();
  }

  // Top event categories
  const catSorted = [...stats.byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('Top 15 event categories:');
  console.log('─'.repeat(63));
  for (const [c, n] of catSorted) console.log(`  ${String(n).padStart(8)}  ${c}`);
  console.log();

  // Top event names
  const nameSorted = [...stats.byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('Top 20 event names:');
  console.log('─'.repeat(63));
  for (const [c, n] of nameSorted) console.log(`  ${String(n).padStart(8)}  ${c}`);
}
