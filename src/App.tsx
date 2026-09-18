import { useMemo, useState } from 'react';
import type { ClusterAudit, FontSpec, ParsedFont } from './types';
import { segmentGraphemes } from './lib/grapheme';
import { countCodepoints, parseUnicodeRanges } from './lib/ranges';
import { analyzeCoverage, findMissingCodepoints } from './lib/coverage';
import { solveFallbackChain } from './lib/solver';
import type { AuditInput, ChainEntry } from './lib/audit';
import { SAMPLE_TEXT, sampleFonts, uid } from './lib/sample';
import FontEditor from './components/FontEditor';
import ResultsPanel from './components/ResultsPanel';

export default function App() {
  const [text, setText] = useState(SAMPLE_TEXT);
  const [fonts, setFonts] = useState<FontSpec[]>(sampleFonts);
  const [lengthPriority, setLengthPriority] = useState(0.7);
  const [ignoreFormat, setIgnoreFormat] = useState(true);

  // ---- 字体范围解析 ----
  const parsed: ParsedFont[] = useMemo(
    () =>
      fonts.map((f) => {
        const { ranges, error } = parseUnicodeRanges(f.rangesText);
        return {
          ...f,
          ranges,
          error,
          codepointCount: error ? 0 : countCodepoints(ranges),
        };
      }),
    [fonts],
  );

  // 有效字体及其在原始列表中的位次（位次即偏好顺序）
  const validEntries = useMemo(
    () =>
      parsed
        .map((font, order) => ({ font, order }))
        .filter((e) => !e.font.error && e.font.ranges.length > 0),
    [parsed],
  );
  const validFonts = useMemo(() => validEntries.map((e) => e.font), [validEntries]);

  // ---- 字素簇切分 + 覆盖分析 ----
  const graphemes = useMemo(() => segmentGraphemes(text), [text]);
  const analysis = useMemo(
    () => analyzeCoverage(graphemes, validFonts, ignoreFormat),
    [graphemes, validFonts, ignoreFormat],
  );

  // ---- 回退链求解 ----
  const solution = useMemo(
    () =>
      solveFallbackChain({
        fontCount: validFonts.length,
        preference: validEntries.map((e) => e.order),
        patterns: analysis.patterns,
        lengthPriority,
      }),
    [validFonts.length, validEntries, analysis.patterns, lengthPriority],
  );

  // ---- 承接分配：每个簇由链中第一种可覆盖字体承接（与浏览器回退语义一致） ----
  const clusters: ClusterAudit[] = useMemo(() => {
    const chainOrder = solution.selected; // 已按偏好排序
    return analysis.clusters.map((c) => {
      if (c.free) {
        return {
          ...c,
          assigned: chainOrder.length > 0 ? chainOrder[0] : null,
          status: 'free' as const,
          missingCodepoints: [],
        };
      }
      const assigned = chainOrder.find((f) => c.candidates.includes(f)) ?? null;
      if (assigned === null) {
        return {
          ...c,
          assigned: null,
          status: 'missing' as const,
          missingCodepoints: findMissingCodepoints(c.required, validFonts),
        };
      }
      return { ...c, assigned, status: 'covered' as const, missingCodepoints: [] };
    });
  }, [analysis.clusters, solution.selected, validFonts]);

  // ---- 链上每种字体承接的簇数 ----
  const chain: ChainEntry[] = useMemo(() => {
    const counts = new Map<number, number>();
    for (const c of clusters) {
      if (c.assigned !== null && c.status !== 'free') {
        counts.set(c.assigned, (counts.get(c.assigned) ?? 0) + 1);
      }
    }
    return solution.selected.map((fontIndex) => ({
      fontIndex,
      name: validFonts[fontIndex].name,
      preference: validEntries[fontIndex].order,
      assignedClusters: counts.get(fontIndex) ?? 0,
    }));
  }, [clusters, solution.selected, validFonts, validEntries]);

  const unselected = useMemo(
    () =>
      validEntries
        .filter((_, i) => !solution.selected.includes(i))
        .map((e) => ({ name: e.font.name, preference: e.order })),
    [validEntries, solution.selected],
  );

  const auditInput: AuditInput = useMemo(
    () => ({
      text,
      fonts: parsed,
      validFontOrder: validEntries.map((e) => e.order),
      lengthPriority,
      ignoreFormatCodepoints: ignoreFormat,
    }),
    [text, parsed, validEntries, lengthPriority, ignoreFormat],
  );

  // ---- 字体列表编辑 ----
  const updateFont = (id: string, patch: Partial<FontSpec>) =>
    setFonts((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const moveFont = (id: string, dir: -1 | 1) =>
    setFonts((fs) => {
      const i = fs.findIndex((f) => f.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeFont = (id: string) => setFonts((fs) => fs.filter((f) => f.id !== id));
  const addFont = () =>
    setFonts((fs) => [...fs, { id: uid(), name: '', rangesText: '' }]);

  const codepointCount = useMemo(() => [...text].length, [text]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Unicode 字体回退链审计台</h1>
          <p className="subtitle">
            按字素簇审计字体覆盖 · 在「顺序偏好」与「最短链」之间求解可行回退链 · 导出 CSS / JSON
          </p>
        </div>
        <span className="badge-soft">无需登录 · 全部本地计算</span>
      </header>

      <main className="layout">
        <section className="panel">
          <h2>
            <span className="step">1</span> 待渲染文本
          </h2>
          <textarea
            className="text-input mono"
            value={text}
            placeholder="粘贴需要渲染的文本…"
            rows={7}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row-between">
            <span className="muted small">
              {graphemes.length} 字素簇 · {codepointCount} 码位 · {text.length} UTF-16 单元
            </span>
            <span className="row-actions">
              <button className="btn small ghost" onClick={() => setText(SAMPLE_TEXT)}>
                载入示例
              </button>
              <button className="btn small ghost" onClick={() => setText('')}>
                清空
              </button>
            </span>
          </div>

          <h2>
            <span className="step">2</span> 字体与 Unicode 覆盖范围
          </h2>
          <p className="muted small">
            列表顺序即回退偏好（↑ 更优先）。范围语法：<code>U+0020-007E</code>、<code>U+4E00</code>、
            <code>U+4??</code>，逗号或空白分隔。
          </p>
          <FontEditor
            fonts={fonts}
            parsed={parsed}
            onUpdate={updateFont}
            onMove={moveFont}
            onRemove={removeFont}
            onAdd={addFont}
          />

          <h2>
            <span className="step">3</span> 求解偏好
          </h2>
          <div className="slider-row">
            <span className="slider-label">顺序优先</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(lengthPriority * 100)}
              onChange={(e) => setLengthPriority(Number(e.target.value) / 100)}
            />
            <span className="slider-label">链长优先</span>
            <span className="slider-value mono">{Math.round(lengthPriority * 100)}%</span>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={ignoreFormat}
              onChange={(e) => setIgnoreFormat(e.target.checked)}
            />
            忽略透明格式字符（ZWJ、变体选择符等，随簇内其它字符渲染）
          </label>
        </section>

        <section className="panel results-panel">
          <ResultsPanel
            clusters={clusters}
            validFonts={validFonts}
            chain={chain}
            unselected={unselected}
            feasible={solution.feasible}
            exact={solution.exact}
            objective={solution.objective}
            nodesExplored={solution.nodesExplored}
            auditInput={auditInput}
            hasText={text.length > 0}
          />
        </section>
      </main>

      <footer className="app-footer">
        字素簇切分基于 Intl.Segmenter · 求解器：唯一候选强制 + 支配约简 + 分支定界（预算内精确，超时退回贪心/局部搜索）
      </footer>
    </div>
  );
}
