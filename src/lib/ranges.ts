/**
 * Unicode 覆盖范围解析与区间运算。
 * 支持 CSS unicode-range 风格语法：
 *   U+0020-007E, U+00A0, 4E00-9FFF, U+4??（通配，等价 U+400-4FF）
 * 多个范围用逗号、分号或空白分隔；解析后排序并合并相邻/重叠区间。
 */

export interface ParseResult {
  ranges: [number, number][];
  error: string | null;
}

const MAX_CP = 0x10ffff;

export function parseUnicodeRanges(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ranges: [], error: '请输入至少一个范围，例如 U+0020-007E' };
  }
  const tokens = trimmed.split(/[,;\s]+/).filter(Boolean);
  const ranges: [number, number][] = [];

  for (const token of tokens) {
    if (token.includes('?')) {
      const m = /^(?:[Uu]\+)?([0-9A-Fa-f?]{1,6})$/.exec(token);
      if (!m || !m[1].includes('?')) {
        return { ranges: [], error: `无法解析通配范围：“${token}”` };
      }
      const start = parseInt(m[1].replace(/\?/g, '0'), 16);
      const end = parseInt(m[1].replace(/\?/g, 'F'), 16);
      if (end > MAX_CP) return { ranges: [], error: `超出 Unicode 上限 U+10FFFF：“${token}”` };
      ranges.push([start, end]);
      continue;
    }
    const m = /^(?:[Uu]\+)?([0-9A-Fa-f]{1,6})(?:-(?:[Uu]\+)?([0-9A-Fa-f]{1,6}))?$/.exec(token);
    if (!m) {
      return { ranges: [], error: `无法解析：“${token}”（示例：U+0020-007E 或 U+4E00）` };
    }
    const start = parseInt(m[1], 16);
    const end = m[2] ? parseInt(m[2], 16) : start;
    if (start > MAX_CP || end > MAX_CP) {
      return { ranges: [], error: `超出 Unicode 上限 U+10FFFF：“${token}”` };
    }
    if (start > end) {
      return { ranges: [], error: `起点大于终点：“${token}”` };
    }
    ranges.push([start, end]);
  }

  return { ranges: mergeRanges(ranges), error: null };
}

/** 排序并合并相邻/重叠的闭区间（供范围解析与 cmap 结果复用） */
export function mergeRanges(input: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = [...input].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 1) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

export function countCodepoints(ranges: readonly (readonly [number, number])[]): number {
  return ranges.reduce((sum, [s, e]) => sum + (e - s + 1), 0);
}

/**
 * 区间差集 a − b（两组区间都应已排序合并）。
 * 返回 a 中不被 b 覆盖的部分。
 */
export function subtractRanges(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
): [number, number][] {
  const out: [number, number][] = [];
  let j = 0;
  for (const [as, ae] of a) {
    while (j < b.length && b[j][1] < as) j++;
    let cur = as;
    for (let k = j; k < b.length && b[k][0] <= ae; k++) {
      const [bs, be] = b[k];
      if (bs > cur) out.push([cur, Math.min(ae, bs - 1)]);
      if (be >= cur) cur = be + 1;
      if (cur > ae) break;
    }
    if (cur <= ae) out.push([cur, ae]);
  }
  return out;
}

/** 两组已合并区间的双向差集及各自码位数量 */
export interface RangeDifference {
  /** a 有而 b 无 */
  onlyA: [number, number][];
  /** b 有而 a 无 */
  onlyB: [number, number][];
  onlyACount: number;
  onlyBCount: number;
}

export function rangeDifference(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
): RangeDifference {
  const onlyA = subtractRanges(a, b);
  const onlyB = subtractRanges(b, a);
  return {
    onlyA,
    onlyB,
    onlyACount: countCodepoints(onlyA),
    onlyBCount: countCodepoints(onlyB),
  };
}

/** U+XXXX（至少 4 位十六进制，补充平面自动变长） */
export function formatCodepointHex(cp: number): string {
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}

export function formatRange([s, e]: readonly [number, number]): string {
  return s === e ? formatCodepointHex(s) : `${formatCodepointHex(s)}-${formatCodepointHex(e)}`;
}

/** 紧凑展示区间：超出 limit 段时折叠为「等 N 段」 */
export function formatRangesCompact(
  ranges: readonly (readonly [number, number])[],
  limit = 6,
): string {
  if (ranges.length === 0) return '（无）';
  const head = ranges.slice(0, limit).map((r) => formatRange(r)).join(', ');
  const rest = ranges.length - limit;
  return rest > 0 ? `${head} 等 ${ranges.length} 段（另 ${rest} 段未展示）` : head;
}
