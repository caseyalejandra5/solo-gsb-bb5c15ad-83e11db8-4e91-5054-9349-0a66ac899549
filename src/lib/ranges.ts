/**
 * Unicode 覆盖范围解析。
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

  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 1) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return { ranges: merged, error: null };
}

export function countCodepoints(ranges: [number, number][]): number {
  return ranges.reduce((sum, [s, e]) => sum + (e - s + 1), 0);
}
