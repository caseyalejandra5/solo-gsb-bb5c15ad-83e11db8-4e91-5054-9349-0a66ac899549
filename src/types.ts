/** 用户录入的字体条目（编辑态） */
export interface FontSpec {
  id: string;
  name: string;
  rangesText: string;
}

/** 解析后的字体条目 */
export interface ParsedFont extends FontSpec {
  /** 归一化、合并后的闭区间码位范围 */
  ranges: [number, number][];
  /** 解析错误信息；null 表示可用 */
  error: string | null;
  /** 覆盖的码位总数 */
  codepointCount: number;
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
