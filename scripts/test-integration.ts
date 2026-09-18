/**
 * 集成模拟：复刻 App.tsx 的数据流，用真实 DejaVuSans.ttf 的 cmap 结果
 * 验证「按实测覆盖求解」开关开启/关闭/清除文件时的行为。
 */
import { readFileSync } from 'node:fs';
import { parseFontCmap } from '../src/lib/sfnt';
import { parseUnicodeRanges, rangeDifference } from '../src/lib/ranges';
import { analyzeCoverage, findMissingCodepoints } from '../src/lib/coverage';
import { segmentGraphemes } from '../src/lib/grapheme';
import { solveFallbackChain } from '../src/lib/solver';
import type { FontSpec, FontUpload, ParsedFont } from '../src/types';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (!cond) {
    failures++;
    console.log(`  FAIL: ${name} ${extra}`);
  } else console.log(`  ok: ${name}`);
}

// ---- 构造「解析后的字体列表」，与 App.tsx useMemo 逻辑一致 ----
function buildParsed(
  specs: FontSpec[],
  uploads: Record<string, FontUpload | undefined>,
  useMeasured: boolean,
): ParsedFont[] {
  return specs.map((f) => {
    const { ranges, error } = parseUnicodeRanges(f.rangesText);
    const upload = uploads[f.id] ?? null;
    const measuredOk = upload?.status === 'ok' && upload.measuredRanges;
    const rangeSource: 'declared' | 'measured' =
      useMeasured && measuredOk ? 'measured' : 'declared';
    const effectiveRanges =
      rangeSource === 'measured' && upload?.measuredRanges ? upload.measuredRanges : ranges;
    return {
      ...f,
      ranges,
      error,
      codepointCount: error ? 0 : ranges.reduce((s, [a, b]) => s + (b - a + 1), 0),
      upload,
      effectiveRanges,
      rangeSource,
    };
  });
}

const solve = (parsedList: ParsedFont[], text: string) => {
  const validEntries = parsedList
    .map((font, order) => ({ font, order }))
    .filter((e) => !e.font.error && e.font.effectiveRanges.length > 0);
  const validFonts = validEntries.map((e) => e.font);
  const analysis = analyzeCoverage(segmentGraphemes(text), validFonts, true);
  const sol = solveFallbackChain({
    fontCount: validFonts.length,
    preference: validEntries.map((e) => e.order),
    patterns: analysis.patterns,
    lengthPriority: 0.7,
  });
  let missing = 0;
  for (const c of analysis.clusters) {
    if (c.free) continue;
    const assigned = sol.selected.find((f) => c.candidates.includes(f));
    if (assigned === undefined) {
      missing++;
      void findMissingCodepoints(c.required, validFonts);
    }
  }
  return { selected: sol.selected, missing, validFonts };
};

// ---- 真实字体 ----
const buf = readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
const cmap = await parseFontCmap(
  new File([new Uint8Array(buf)], 'DejaVuSans.ttf', { type: 'font/ttf' }),
);

const specs: FontSpec[] = [
  // 故意把声明范围写「大」：声明覆盖整个 BMP，但字体实际只有约 5900 码位
  { id: 'a', name: 'DejaVu', rangesText: 'U+0020-FFFF' },
  // 第二个字体不动
  { id: 'b', name: 'Basic', rangesText: 'U+0020-007E' },
];

// 文本：ASCII 一定能覆盖；中 （U+4E2D）不在 DejaVu 也不在 Basic
const text = 'Hello 中';

console.log('开关关闭（声明范围）:');
{
  const p = buildParsed(specs, {}, false);
  check('source declared', p[0].rangeSource === 'declared');
  const r = solve(p, text);
  check('声明 BMP 范围 → 全部可覆盖（missing=0）', r.missing === 0, `missing=${r.missing}`);
  check('只需要 DejaVu 一种字体', r.selected.length === 1, `selected=${r.selected.length}`);
}

console.log('开关开启 + 上传成功（cmap 实测）:');
const okUpload: FontUpload = {
  fileName: 'DejaVuSans.ttf',
  fileSize: buf.length,
  status: 'ok',
  measuredRanges: cmap.ranges,
  measuredCount: cmap.codepointCount,
  selectedSubtable: cmap.selectedSubtable,
  mergedFormats: cmap.mergedFormats,
  cmapRecordCount: cmap.cmapRecordCount,
  error: null,
};
{
  const p = buildParsed(specs, { a: okUpload }, true);
  check('source measured', p[0].rangeSource === 'measured');
  check('effective = cmap ranges', p[0].effectiveRanges === cmap.ranges);
  const r = solve(p, text);
  check('实测不含中 → 缺失 1 簇', r.missing === 1, `missing=${r.missing}`);
  check('Hello 仍被覆盖（链非空）', r.selected.length >= 1);
}

console.log('开关开启但未上传 → 仍用声明:');
{
  const p = buildParsed(specs, {}, true);
  check('source declared (no file)', p[0].rangeSource === 'declared');
  const r = solve(p, text);
  check('missing=0', r.missing === 0);
}

console.log('开关开启但该条目解析失败 → 回退声明，且不影响其他字体:');
{
  const errUpload: FontUpload = { ...okUpload, status: 'error', error: 'bad', measuredRanges: null };
  const p = buildParsed(specs, { a: errUpload }, true);
  check('source declared on error', p[0].rangeSource === 'declared');
  const r = solve(p, text);
  check('其他字体不受影响，Basic 仍有效', r.validFonts.length === 2, `valid=${r.validFonts.length}`);
  check('用声明范围 missing=0', r.missing === 0);
}

console.log('清除文件 → 立即恢复声明范围:');
{
  const before = buildParsed(specs, { a: okUpload }, true);
  check('清除前 measured', before[0].rangeSource === 'measured');
  const after = buildParsed(specs, {}, true);
  check('清除后 declared', after[0].rangeSource === 'declared');
  check('清除后 effective = 声明', JSON.stringify(after[0].effectiveRanges) === JSON.stringify(before[0].ranges));
}

console.log('声明范围写「小」于实测 → 实测有/声明无 差集非空:');
{
  const small: FontSpec[] = [{ id: 'a', name: 'D', rangesText: 'U+0020-007E' }];
  const p = buildParsed(small, { a: okUpload }, false);
  const diff = rangeDifference(p[0].ranges, cmap.ranges);
  check('声明有/实测无 = 0（可打印 ASCII 全覆盖）', diff.onlyACount === 0, `${diff.onlyACount}`);
  check('实测有/声明无 > 0', diff.onlyBCount > 0, `${diff.onlyBCount}`);
}

console.log(failures === 0 ? '\nALL INTEGRATION CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
