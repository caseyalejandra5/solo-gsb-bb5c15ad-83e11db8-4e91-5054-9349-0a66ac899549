import { readFileSync, writeFileSync } from 'node:fs';
import { parseFontCmap, SfntParseError } from '../src/lib/sfnt';
import { rangeDifference } from '../src/lib/ranges';

async function fromPath(path: string) {
  const buf = readFileSync(path);
  const file = new File([new Uint8Array(buf)], path.split('/').pop()!, {
    type: 'font/ttf',
  });
  return parseFontCmap(file);
}

function covers(ranges: [number, number][], cp: number) {
  return ranges.some(([s, e]) => cp >= s && cp <= e);
}

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${name} ${extra}`);
  } else {
    console.log(`  ok: ${name}`);
  }
}

// ---- 1. 真实字体 DejaVu Sans ----
console.log('DejaVuSans.ttf:');
const cmap = await fromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
console.log(
  `  records=${cmap.cmapRecordCount} formats=${cmap.mergedFormats} selected=${cmap.selectedSubtable} segs=${cmap.ranges.length} cps=${cmap.codepointCount}`,
);
check('covers ASCII A U+0041', covers(cmap.ranges, 0x41));
check('covers space U+0020', covers(cmap.ranges, 0x20));
check('covers U+00E4 (ä)', covers(cmap.ranges, 0xe4));
check('covers U+2026 (…)', covers(cmap.ranges, 0x2026));
check('does NOT cover U+0000', !covers(cmap.ranges, 0x0));
check('does NOT cover U+FFFF', !covers(cmap.ranges, 0xffff));
// 区间必须有序且不重叠（mergeRanges 性质）
let sorted = true;
for (let i = 1; i < cmap.ranges.length; i++) {
  if (cmap.ranges[i][0] <= cmap.ranges[i - 1][1]) sorted = false;
}
check('ranges sorted & disjoint', sorted);
// DejaVu Sans has U+1F600? It has some emoji but maybe not; check a known one: U+1F621 is in DejaVu
if (cmap.mergedFormats.includes(12)) {
  check('format 12 merged', true);
  console.log(`  sample SMP coverage: U+1F621=${covers(cmap.ranges, 0x1f621)}, U+1F600=${covers(cmap.ranges, 0x1f600)}`);
} else {
  console.log('  (font has no format 12)');
}

// ---- 1b. format 4 / format 12 子表对 BMP 的覆盖应一致（自洽交叉校验） ----
console.log('DejaVuSans format4 vs format12 BMP consistency:');
{
  const buf = readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = v.getUint16(4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    if (tag === 'cmap') cmapOff = v.getUint32(o + 8);
  }
  const nRec = v.getUint16(cmapOff + 2);
  let f4abs = -1;
  let f12abs = -1;
  for (let i = 0; i < nRec; i++) {
    const r = cmapOff + 4 + i * 8;
    const plat = v.getUint16(r);
    const enc = v.getUint16(r + 2);
    const off = v.getUint32(r + 4);
    const fmt = v.getUint16(cmapOff + off);
    if (fmt === 4 && f4abs < 0 && plat === 3 && enc === 1) f4abs = cmapOff + off;
    if (fmt === 12 && f12abs < 0 && plat === 3) f12abs = cmapOff + off;
  }
  const bmpSet = (abs: number, fmt: 4 | 12): Set<number> => {
    const s = new Set<number>();
    if (fmt === 4) {
      const segX2 = v.getUint16(abs + 6);
      const seg = segX2 >> 1;
      const endB = abs + 14;
      const startB = endB + seg * 2 + 2;
      const deltaB = startB + seg * 2;
      const roB = deltaB + seg * 2;
      for (let k = 0; k < seg; k++) {
        const end = v.getUint16(endB + k * 2);
        const start = v.getUint16(startB + k * 2);
        const delta = v.getUint16(deltaB + k * 2);
        const roAddr = roB + k * 2;
        const ro = v.getUint16(roAddr);
        if (end === 0xffff) continue;
        for (let cp = start; cp <= end; cp++) {
          let gid: number;
          if (ro === 0) gid = (cp + delta) & 0xffff;
          else gid = v.getUint16(roAddr + ro + (cp - start) * 2);
          if (gid !== 0) s.add(cp);
        }
      }
    } else {
      const ng = v.getUint32(abs + 12);
      for (let g = 0; g < ng; g++) {
        const o = abs + 16 + g * 12;
        const st = v.getUint32(o);
        const en = v.getUint32(o + 4);
        const sg = v.getUint32(o + 8);
        if (sg === 0 || st > 0xffff) continue;
        for (let cp = st; cp <= Math.min(en, 0xffff); cp++) s.add(cp);
      }
    }
    return s;
  };
  if (f4abs >= 0 && f12abs >= 0) {
    const a = bmpSet(f4abs, 4);
    const b = bmpSet(f12abs, 12);
    let onlyA = 0;
    for (const cp of a) if (!b.has(cp)) onlyA++;
    let onlyB = 0;
    for (const cp of b) if (!a.has(cp)) onlyB++;
    check(`f4/f12 BMP coverage identical (f4=${a.size}, f12Bmp=${b.size})`, onlyA === 0 && onlyB === 0, `only4=${onlyA} only12=${onlyB}`);
  } else {
    console.log('  (skipped: f4 or f12 not found)');
  }
}

// ---- 2. 双向差集 ----
console.log('rangeDifference:');
// a = U+20-7E；b = U+30-79 → 声明独有被切成 U+20-2F、U+7A-7E 两段
let d = rangeDifference([[0x20, 0x7e]], [[0x30, 0x79]]);
check(
  'only declared split = U+20-2F + U+7A-7E',
  JSON.stringify(d.onlyA) === JSON.stringify([[0x20, 0x2f], [0x7a, 0x7e]]),
  JSON.stringify(d.onlyA),
);
check('b contained in a -> empty onlyB', JSON.stringify(d.onlyB) === '[]');
check('only declared count', d.onlyACount === (0x2f - 0x20 + 1) + (0x7e - 0x7a + 1));
// b 伸出 a 的右端 → 实测独有 U+7F-99
d = rangeDifference([[0x20, 0x7e]], [[0x70, 0x99]]);
check('only declared left = U+20-6F', JSON.stringify(d.onlyA) === JSON.stringify([[0x20, 0x6f]]), JSON.stringify(d.onlyA));
check('only measured right = U+7F-99', JSON.stringify(d.onlyB) === JSON.stringify([[0x7f, 0x99]]), JSON.stringify(d.onlyB));
check('only measured count', d.onlyBCount === 0x99 - 0x7f + 1);
// 边界相切：a 结束于 b 起点前一位，不应有差
const d2 = rangeDifference([[0x20, 0x30]], [[0x31, 0x40]]);
check('touching intervals leave full a', JSON.stringify(d2.onlyA) === JSON.stringify([[0x20, 0x30]]));
const d3 = rangeDifference([[0x20, 0x40]], [[0x20, 0x40]]);
check('identical intervals -> empty diff', d3.onlyA.length === 0 && d3.onlyB.length === 0);

// ---- 3. 损坏文件：非法情况逐个只影响该条目 ----
console.log('error cases:');
const expectError = async (name: string, bytes: Uint8Array) => {
  try {
    await parseFontCmap(new File([bytes], 'bad.ttf'));
    check(name, false, 'should have thrown');
  } catch (e) {
    check(name, e instanceof SfntParseError, (e as Error).message);
    console.log(`      └ ${(e as Error).message}`);
  }
};

await expectError('tiny file', new Uint8Array([0, 1, 2]));
await expectError('bad magic', new Uint8Array(128).fill(0xff));
{
  // sfnt header with numTables=1 but table directory runs past EOF
  const b = new Uint8Array(16);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  await expectError('directory past EOF', b);
}
{
  // sfnt header: 1 table, no cmap
  const b = new Uint8Array(64);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set([0x68, 0x65, 0x61, 0x64], 12); // 'head'
  v.setUint32(20, 100);
  v.setUint32(24, 10);
  await expectError('missing cmap', b);
}
{
  // cmap exists, offset past file
  const b = new Uint8Array(64);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set([0x63, 0x6d, 0x61, 0x70], 12); // 'cmap'
  v.setUint32(20, 5000);
  v.setUint32(24, 100);
  await expectError('cmap offset out of bounds', b);
}
{
  // cmap table valid but claims numRecords running past its length
  const cmapBody = new Uint8Array(20);
  const cv = new DataView(cmapBody.buffer);
  cv.setUint16(0, 0);
  cv.setUint16(2, 5); // 5 records, only 16 bytes available
  const b = new Uint8Array(64);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set([0x63, 0x6d, 0x61, 0x70], 12);
  v.setUint32(20, 28);
  v.setUint32(24, 20);
  b.set(cmapBody, 28);
  await expectError('records past cmap length', b);
}
{
  // subtable offset out of cmap bounds
  const cmapBody = new Uint8Array(20);
  const cv = new DataView(cmapBody.buffer);
  cv.setUint16(2, 1);
  cv.setUint16(4, 3); // platform 3
  cv.setUint16(6, 1); // encoding 1
  cv.setUint32(8, 9999); // bad offset
  const b = new Uint8Array(64);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set([0x63, 0x6d, 0x61, 0x70], 12);
  v.setUint32(20, 28);
  v.setUint32(24, 20);
  b.set(cmapBody, 28);
  await expectError('subtable offset illegal', b);
}
{
  // valid record pointing to format 0 (unsupported) → no supported subtable
  const sub = new Uint8Array(4);
  const sv = new DataView(sub.buffer);
  sv.setUint16(0, 0);
  const cmapBody = new Uint8Array(16);
  const cv = new DataView(cmapBody.buffer);
  cv.setUint16(2, 1);
  cv.setUint16(4, 3);
  cv.setUint16(6, 1);
  cv.setUint32(8, 4);
  const b = new Uint8Array(64);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set([0x63, 0x6d, 0x61, 0x70], 12);
  v.setUint32(20, 28);
  v.setUint32(24, 20);
  b.set(cmapBody, 28);
  b.set(sub, 28 + 4);
  await expectError('only unsupported format', b);
}

// ---- 4. 手工构造一个正确的 format 4：映射 U+0041-0042 → gid 1-2, U+0061 → gid 3 ----
console.log('synthetic format 4:');
{
  // 2 个数据段 + 1 个 0xFFFF 哨兵；用显式偏移构造，避免再手算 rangeOffset
  const segCount = 3;
  const endCodeOff = 14;
  const reservedOff = endCodeOff + segCount * 2; // 20
  const startCodeOff = reservedOff + 2; // 22
  const idDeltaOff = startCodeOff + segCount * 2; // 28
  const idRangeOff = idDeltaOff + segCount * 2; // 34
  // seg1 的 rangeOffset 字段（36）+6 = 42，落在哨兵段空闲字段区内，作为 glyph slot
  const subLen = 44;
  const sub = new Uint8Array(subLen);
  const sv = new DataView(sub.buffer);
  const setArr = (base: number, i: number, val: number) => sv.setUint16(base + i * 2, val);
  sv.setUint16(0, 4);
  sv.setUint16(2, subLen);
  sv.setUint16(6, segCount * 2);
  sv.setUint16(8, 4);
  sv.setUint16(10, 0);
  sv.setUint16(12, 0);
  // seg 0: 0x41-0x42，idDelta = -0x40 ⇒ gid 1,2
  setArr(endCodeOff, 0, 0x42);
  setArr(startCodeOff, 0, 0x41);
  setArr(idDeltaOff, 0, (-0x40) & 0xffff);
  setArr(idRangeOff, 0, 0);
  // seg 1: 0x61-0x61 via glyph array（delta=0，slot 在 +6 处，值 3）
  setArr(endCodeOff, 1, 0x61);
  setArr(startCodeOff, 1, 0x61);
  setArr(idDeltaOff, 1, 0);
  setArr(idRangeOff, 1, 6);
  sv.setUint16(idRangeOff + 2 + 6, 3); // gid 3 @ offset 42
  // sentinel
  setArr(endCodeOff, 2, 0xffff);
  setArr(startCodeOff, 2, 0xffff);
  setArr(idDeltaOff, 2, 1);
  const cmapLen = 4 + 8 + subLen;
  const cmapBody = new Uint8Array(cmapLen);
  const cv = new DataView(cmapBody.buffer);
  cv.setUint16(2, 1);
  cv.setUint16(4, 3);
  cv.setUint16(6, 1);
  cv.setUint32(8, 12);
  cmapBody.set(sub, 12);
  const total = 28 + cmapLen;
  const b = new Uint8Array(total);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  b.set([0x63, 0x6d, 0x61, 0x70], 12);
  v.setUint32(20, 28);
  v.setUint32(24, cmapLen);
  b.set(cmapBody, 28);
  const r = await parseFontCmap(new File([b], 'syn.ttf'));
  check('synthetic ranges equal 41-42,61', JSON.stringify(r.ranges) === JSON.stringify([[0x41, 0x42], [0x61, 0x61]]), JSON.stringify(r.ranges));
  check('synthetic cps = 3', r.codepointCount === 3);
  check('synthetic selected format-4', r.selectedSubtable === 'format-4');
  writeFileSync('/tmp/syn.ttf', b);
}

// ---- 5. 手工构造 format 12（含 SMP 码位） ----
console.log('synthetic format 12:');
{
  const numGroups = 2;
  const subLen = 16 + numGroups * 12;
  const sub = new Uint8Array(subLen);
  const sv = new DataView(sub.buffer);
  sv.setUint16(0, 12);
  sv.setUint16(2, 0);
  sv.setUint32(4, subLen);
  sv.setUint32(8, 0);
  sv.setUint32(12, numGroups);
  // group 0: U+1F300-1F302 → gids 10..12
  sv.setUint32(16, 0x1f300);
  sv.setUint32(20, 0x1f302);
  sv.setUint32(24, 10);
  // group 1: U+41-41 → gid 0 (uncovered)
  sv.setUint32(28, 0x41);
  sv.setUint32(32, 0x41);
  sv.setUint32(36, 0);
  const cmapLen = 4 + 8 + subLen;
  const cmapBody = new Uint8Array(cmapLen);
  const cv = new DataView(cmapBody.buffer);
  cv.setUint16(2, 1);
  cv.setUint16(4, 3);
  cv.setUint16(6, 10);
  cv.setUint32(8, 12);
  cmapBody.set(sub, 12);
  const total = 28 + cmapLen;
  const b = new Uint8Array(total);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x4f54544f); // OTTO (CFF OTF)
  v.setUint16(4, 1);
  b.set([0x63, 0x6d, 0x61, 0x70], 12);
  v.setUint32(20, 28);
  v.setUint32(24, cmapLen);
  b.set(cmapBody, 28);
  const r = await parseFontCmap(new File([b], 'syn.otf'));
  check('format 12 SMP ranges', JSON.stringify(r.ranges) === JSON.stringify([[0x1f300, 0x1f302]]), JSON.stringify(r.ranges));
  check('gid-0 group skipped', !r.ranges.some(([s]) => s === 0x41));
  check('selected format-12', r.selectedSubtable === 'format-12');
  check('OTTO accepted', true);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
