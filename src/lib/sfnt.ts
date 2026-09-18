/**
 * sfnt 容器（TTF / OTF / 带 font 头的 wOFF 不在支持范围）cmap 解析，
 * 纯浏览器端完成：文件字节只存在于内存，不上传服务端、不写持久化存储。
 *
 * 仅解析 cmap 中最常用的两种子表：
 *   - format 4：BMP 码位（U+0000–U+FFFF）分段映射
 *   - format 12（segmented coverage）：全 Unicode 码位分段映射
 * 两种子表的结果合并为实际覆盖的码位区间（glyphId === 0 视为未覆盖）。
 *
 * 所有表偏移、长度与分段均做边界与合法性校验，任一非法即抛出 SfntParseError，
 * 由调用方只在对应字体条目上展示错误。
 */

import { mergeRanges } from './ranges';

export class SfntParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SfntParseError';
  }
}

export interface MeasuredCmap {
  /** 合并后的实际覆盖码位区间 */
  ranges: [number, number][];
  /** 覆盖码位总数 */
  codepointCount: number;
  /** 参与求解的子表格式（按平台/编码优先级挑选） */
  selectedSubtable: 'format-4' | 'format-12';
  /** 合并了哪些子表格式 */
  mergedFormats: Array<4 | 12>;
  cmapRecordCount: number;
}

const SFNT_TRUE_TYPE = 0x00010000;
const SFNT_OPENTYPE = 0x4f54544f; // 'OTTO'
const SFNT_TYPO1 = 0x74727565; // 'true'（Apple 变体）
const SFNT_TYPO2 = 0x74797031; // 'typ1'
const MAX_CP = 0x10ffff;

interface CmapRecordRef {
  platformID: number;
  encodingID: number;
  offset: number;
}

/**
 * 选择优先级：全平面（format 12）优先于 BMP（format 4），
 * 同格式内按 Windows(3,1/10) → Unicode(0,*) → Macintosh(1,0) 排序。
 */
function recordScore(r: { platformID: number; encodingID: number }, fmt: number): number {
  let s = 0;
  if (fmt === 12) s += 1000;
  if (r.platformID === 3) s += r.encodingID === 10 ? 60 : 50;
  else if (r.platformID === 0) s += 40;
  else if (r.platformID === 1 && r.encodingID === 0) s += 10;
  return s;
}

export async function parseFontCmap(file: File): Promise<MeasuredCmap> {
  if (file.size < 12) throw new SfntParseError('文件过小，不是有效的 TTF/OTF 字体');
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const fileLen = buffer.byteLength;

  const readU16 = (off: number): number => view.getUint16(off, false);
  const readU32 = (off: number): number => view.getUint32(off, false);
  const readTag = (off: number): string =>
    String.fromCharCode(
      view.getUint8(off),
      view.getUint8(off + 1),
      view.getUint8(off + 2),
      view.getUint8(off + 3),
    );

  // ---- sfnt 头 ----
  const sfntVersion = readU32(0);
  if (
    sfntVersion !== SFNT_TRUE_TYPE &&
    sfntVersion !== SFNT_OPENTYPE &&
    sfntVersion !== SFNT_TYPO1 &&
    sfntVersion !== SFNT_TYPO2
  ) {
    throw new SfntParseError(
      '不是 sfnt 字体（需 TTF/OTF；TTC 合集与 WOFF/WOFF2 压缩包暂不支持）',
    );
  }

  const numTables = readU16(4);
  if (numTables === 0 || numTables > 1000 || 12 + numTables * 16 > fileLen) {
    throw new SfntParseError('字体表目录非法（表数量或长度超出文件边界）');
  }

  // ---- 定位 cmap 表 ----
  let cmapOffset = -1;
  let cmapLength = -1;
  for (let i = 0; i < numTables; i++) {
    const recOff = 12 + i * 16;
    const tag = readTag(recOff);
    const offset = readU32(recOff + 8);
    const length = readU32(recOff + 12);
    if (tag === 'cmap') {
      cmapOffset = offset;
      cmapLength = length;
      break;
    }
  }
  if (cmapOffset < 0) throw new SfntParseError('字体缺少 cmap 表');
  if (cmapLength < 4 || cmapOffset + cmapLength > fileLen) {
    throw new SfntParseError('cmap 表偏移或长度非法（超出文件边界）');
  }
  const cmapEnd = cmapOffset + cmapLength;

  // ---- cmap 头与子表记录 ----
  const numRecords = readU16(cmapOffset + 2);
  if (cmapOffset + 4 + numRecords * 8 > cmapEnd) {
    throw new SfntParseError('cmap 子表记录数量非法（超出 cmap 表边界）');
  }
  const records: CmapRecordRef[] = [];
  for (let i = 0; i < numRecords; i++) {
    const rOff = cmapOffset + 4 + i * 8;
    records.push({
      platformID: readU16(rOff),
      encodingID: readU16(rOff + 2),
      offset: readU32(rOff + 4),
    });
  }

  // 收集 format 4 / format 12 候选；偏移非法（超出 cmap 表或文件）直接判错
  interface Candidate extends CmapRecordRef {
    fmt: 4 | 12;
    abs: number;
    score: number;
  }
  const candidates: Candidate[] = [];
  for (const rec of records) {
    const abs = cmapOffset + rec.offset;
    if (rec.offset < 4 || abs + 2 > cmapEnd || abs + 2 > fileLen) {
      throw new SfntParseError('cmap 子表偏移非法（超出 cmap 表边界）');
    }
    const fmt = readU16(abs);
    if (fmt !== 4 && fmt !== 12) continue;
    candidates.push({ ...rec, fmt, abs, score: recordScore(rec, fmt) });
  }
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    throw new SfntParseError('cmap 中没有 format 4 或 format 12 子表，无法提取码位覆盖');
  }

  const parseFormat4 = (abs: number): [number, number][] => {
    // 头部：format(u16) length(u16) language(u16) segCountX2(u16)
    //       searchRange(u16) entrySelector(u16) rangeShift(u16)
    if (abs + 14 > cmapEnd) throw new SfntParseError('cmap format 4 长度字段非法');
    const length = readU16(abs + 2);
    if (length < 16 || abs + length > cmapEnd) {
      throw new SfntParseError('cmap format 4 子表长度非法（超出 cmap 表边界）');
    }
    const segCountX2 = readU16(abs + 6);
    if (segCountX2 === 0 || segCountX2 % 2 !== 0 || segCountX2 > 0xffff) {
      throw new SfntParseError('cmap format 4 分段数量非法');
    }
    const segCount = segCountX2 >> 1;
    // 各数组起点（相对子表）：endCode[14] reservedPad[+2] startCode[+4]
    // idDelta[+4] idRangeOffset[+4] glyphIdArray[+2]
    const need = 14 + segCount * 2 * 4 + 2;
    if (need > length) {
      throw new SfntParseError('cmap format 4 分段数组长度非法（超出子表边界）');
    }
    const endCodeOff = abs + 14;
    const reservedOff = endCodeOff + segCount * 2;
    const startCodeOff = reservedOff + 2;
    const idDeltaOff = startCodeOff + segCount * 2;
    const idRangeOff = idDeltaOff + segCount * 2;
    if (readU16(reservedOff) !== 0) {
      throw new SfntParseError('cmap format 4 保留字段非 0');
    }

    const covered: [number, number][] = [];
    let runStart = -1;
    let runEnd = -1;
    const pushRun = (cp: number) => {
      if (runStart < 0) {
        runStart = runEnd = cp;
      } else if (cp === runEnd + 1) {
        runEnd = cp;
      } else {
        covered.push([runStart, runEnd]);
        runStart = runEnd = cp;
      }
    };

    for (let s = 0; s < segCount; s++) {
      const end = readU16(endCodeOff + s * 2);
      const start = readU16(startCodeOff + s * 2);
      // 末段必须是 0xFFFF 哨兵
      if (s === segCount - 1) {
        if (start !== 0xffff || end !== 0xffff) {
          throw new SfntParseError('cmap format 4 缺少 0xFFFF 结束哨兵段');
        }
        continue;
      }
      if (start > end) {
        throw new SfntParseError('cmap format 4 存在起点大于终点的分段');
      }
      const delta = readU16(idDeltaOff + s * 2); // 按 u16 存储，按 i16 语义相加
      const rangeOffsetAddr = idRangeOff + s * 2;
      const rangeOffset = readU16(rangeOffsetAddr);

      for (let cp = start; cp <= end; cp++) {
        let gid: number;
        if (rangeOffset === 0) {
          gid = (cp + delta) & 0xffff;
        } else {
          // offset 从该字体对应的 rangeOffset 字段自身起算，每个码位 +2
          const gAddr =
            rangeOffsetAddr + rangeOffset + (cp - start) * 2;
          if (gAddr + 2 > abs + length) {
            gid = 0; // 偏移表指向子表外：该码位无有效映射
          } else {
            const g = readU16(gAddr);
            gid = g === 0 ? 0 : (g + delta) & 0xffff;
          }
        }
        if (gid !== 0) pushRun(cp);
      }
    }
    if (runStart >= 0) covered.push([runStart, runEnd]);
    return covered;
  };

  const parseFormat12 = (abs: number): [number, number][] => {
    // format(u16) reserved(u16) length(u32) language(u32) numGroups(u32)
    if (abs + 16 > cmapEnd) throw new SfntParseError('cmap format 12 长度字段非法');
    const length = readU32(abs + 4);
    if (length < 16 || abs + length > cmapEnd) {
      throw new SfntParseError('cmap format 12 子表长度非法（超出 cmap 表边界）');
    }
    const numGroups = readU32(abs + 12);
    if (numGroups === 0 || 16 + numGroups * 12 > length || numGroups > 0x100000) {
      throw new SfntParseError('cmap format 12 分组数量非法（超出子表边界）');
    }
    const ranges: [number, number][] = [];
    for (let g = 0; g < numGroups; g++) {
      const gOff = abs + 16 + g * 12;
      const start = readU32(gOff);
      const end = readU32(gOff + 4);
      const startGlyph = readU32(gOff + 8);
      if (start > MAX_CP || end > MAX_CP || start > end) {
        throw new SfntParseError('cmap format 12 存在非法或起点大于终点的分组');
      }
      if (startGlyph > 0xffff) {
        throw new SfntParseError('cmap format 12 起始字形 ID 超出范围');
      }
      if (startGlyph !== 0) ranges.push([start, end]);
    }
    return ranges;
  };

  // ---- 各取优先级最高的一个 format 12 与一个 format 4，合并 ----
  const top12 = candidates.find((c) => c.fmt === 12);
  const top4 = candidates.find((c) => c.fmt === 4);
  const mergedFormats: Array<4 | 12> = [];
  let ranges: [number, number][] = [];
  if (top12) {
    ranges.push(...parseFormat12(top12.abs));
    mergedFormats.push(12);
  }
  if (top4) {
    ranges.push(...parseFormat4(top4.abs));
    mergedFormats.push(4);
  }

  const merged = mergeRanges(ranges);

  return {
    ranges: merged,
    codepointCount: merged.reduce((sum, [s, e]) => sum + (e - s + 1), 0),
    selectedSubtable: top12 ? 'format-12' : 'format-4',
    mergedFormats,
    cmapRecordCount: numRecords,
  };
}
