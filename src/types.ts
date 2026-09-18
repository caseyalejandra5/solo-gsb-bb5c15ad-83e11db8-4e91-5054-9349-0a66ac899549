/** 本地字体文件上传后的解析状态（文件字节仅存内存，不持久化、不上传） */
export interface FontUpload {
  /** 原始文件名 */
  fileName: string;
  /** 文件字节数 */
  fileSize: number;
  status: 'parsing' | 'ok' | 'error';
  /** 解析出的实际覆盖区间（status === 'ok' 时有值，已排序合并） */
  measuredRanges: [number, number][] | null;
  /** 实际覆盖码位总数 */
  measuredCount: number;
  /** 选中的 cmap 子表 */
  selectedSubtable: 'format-4' | 'format-12' | null;
  /** 实际参与合并的 cmap 格式 */
  mergedFormats: Array<4 | 12>;
  cmapRecordCount: number;
  /** 解析失败时的错误信息（只影响本条目） */
  error: string | null;
}

/** 用户录入的字体条目（编辑态） */
export interface FontSpec {
  id: string;
  name: string;
  rangesText: string;
}

/** 解析后的字体条目 */
export interface ParsedFont extends FontSpec {
  /** 声明范围：归一化、合并后的闭区间码位范围（文本解析） */
  ranges: [number, number][];
  /** 声明范围解析错误信息；null 表示可用 */
  error: string | null;
  /** 声明范围覆盖的码位总数 */
  codepointCount: number;
  /** 本地字体文件解析状态；null 表示未上传 */
  upload: FontUpload | null;
  /** 当前求解/展示实际使用的范围（开启实测且文件有效时为 cmap 结果，否则为声明范围） */
  effectiveRanges: [number, number][];
  /** 实际使用范围的来源 */
  rangeSource: 'declared' | 'measured';
}

/** 字素簇的承接状态 */
export type ClusterStatus = 'covered' | 'missing' | 'free';

/** 单个字素簇的审计结果 */
export interface ClusterAudit {
  index: number;
  /** 簇文本（原样） */
  text: string;
  /** 在原文中的 UTF-16 偏移 */
  start: number;
  /** 簇内全部码位 */
  codepoints: number[];
  /** 需要字体实际覆盖的码位（已剔除透明格式字符时） */
  required: number[];
  /** 可完整覆盖该簇的字体下标（相对有效字体列表） */
  candidates: number[];
  /** 仅含透明格式字符，无需专门字体 */
  free: boolean;
  /** 回退链中实际承接它的字体下标；null 表示缺失 */
  assigned: number | null;
  status: ClusterStatus;
  /** 所有字体都不覆盖的码位（仅缺失时有值） */
  missingCodepoints: number[];
}
