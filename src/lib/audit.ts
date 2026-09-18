import type { ClusterAudit, ParsedFont } from '../types';
import { formatCodepoint } from './grapheme';

/** 转义 CSS 字符串中的引号与反斜杠 */
export function cssStringEscape(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildFontFamily(chainNames: string[], generic = 'sans-serif'): string {
  return [...chainNames.map((n) => `"${cssStringEscape(n)}"`), generic].join(', ');
}

export interface ChainEntry {
  /** 有效字体列表下标 */
  fontIndex: number;
  name: string;
  preference: number;
  assignedClusters: number;
}

export function buildCssExport(chain: ChainEntry[], generatedAt: string): string {
  const lines = [
    `/* 由 Unicode 字体回退链审计台生成 · ${generatedAt} */`,
    '/* 回退链（按优先级从高到低）：',
    ...chain.map(
      (e, i) => `   ${i + 1}. "${e.name}" — 承接 ${e.assignedClusters} 个字素簇`,
    ),
    '   缺失字素簇不在任何字体覆盖范围内，详见审计 JSON。',
    '*/',
    '.audited-text {',
    `  font-family: ${buildFontFamily(chain.map((e) => e.name))};`,
    '}',
  ];
  return lines.join('\n');
}

export interface AuditInput {
  text: string;
  fonts: ParsedFont[];
  /** 有效字体在原始列表中的下标 */
  validFontOrder: number[];
  lengthPriority: number;
  ignoreFormatCodepoints: boolean;
}

export interface AuditResultData {
  feasible: boolean;
  exact: boolean;
  objective: number;
  nodesExplored: number;
  chain: ChainEntry[];
  unselected: { name: string; preference: number }[];
  clusters: ClusterAudit[];
  validFonts: ParsedFont[];
}

export function buildAuditReport(
  input: AuditInput,
  result: AuditResultData,
  generatedAt: string,
) {
  const { validFonts } = result;
  const fontName = (i: number | null) => (i === null ? null : validFonts[i].name);
  const covered = result.clusters.filter((c) => c.status !== 'missing').length;
  const missing = result.clusters.length - covered;

  return {
    tool: 'unicode-font-fallback-audit',
    version: 1,
    generatedAt,
    input: {
      text: input.text,
      options: {
        lengthPriority: input.lengthPriority,
        ignoreFormatCodepoints: input.ignoreFormatCodepoints,
      },
      fonts: input.fonts.map((f, i) => ({
        preference: i + 1,
        name: f.name,
        ranges: f.rangesText,
        parsedRanges: f.error
          ? null
          : f.ranges.map(([s, e]) => [formatCodepoint(s), formatCodepoint(e)]),
        error: f.error,
      })),
    },
    result: {
      feasible: result.feasible,
      solverExact: result.exact,
      objective: Number(result.objective.toFixed(9)),
      nodesExplored: result.nodesExplored,
      graphemeCount: result.clusters.length,
      coveredCount: covered,
      missingCount: missing,
      chain: result.chain.map((e, i) => ({
        order: i + 1,
        font: e.name,
        preference: e.preference + 1,
        assignedClusters: e.assignedClusters,
      })),
      unselectedFonts: result.unselected.map((u) => ({
        font: u.name,
        preference: u.preference + 1,
      })),
      clusters: result.clusters.map((c) => ({
        index: c.index,
        text: c.text,
        codepoints: c.codepoints.map(formatCodepoint),
        requiredCodepoints: c.required.map(formatCodepoint),
        status: c.status,
        assignedFont: fontName(c.assigned),
        candidateFonts: c.candidates.map((i) => validFonts[i].name),
        missingCodepoints: c.missingCodepoints.map(formatCodepoint),
      })),
      missing: result.clusters
        .filter((c) => c.status === 'missing')
        .map((c) => ({
          index: c.index,
          text: c.text,
          codepoints: c.codepoints.map(formatCodepoint),
          missingCodepoints: c.missingCodepoints.map(formatCodepoint),
        })),
    },
    css: `font-family: ${buildFontFamily(result.chain.map((e) => e.name))};`,
  };
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 回退：隐藏 textarea + execCommand（兼容非安全上下文）
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
