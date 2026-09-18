import { useRef } from 'react';
import type { FontSpec, FontUpload, ParsedFont } from '../types';
import { countCodepoints, formatRangesCompact, rangeDifference } from '../lib/ranges';

interface FontEditorProps {
  fonts: FontSpec[];
  parsed: ParsedFont[];
  uploads: Record<string, FontUpload | undefined>;
  onUpload: (id: string, file: File) => void;
  onClearUpload: (id: string) => void;
  onUpdate: (id: string, patch: Partial<FontSpec>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 声明范围 vs cmap 实测范围的双向差集 */
function CoverageDiff({
  declared,
  measured,
}: {
  declared: [number, number][];
  measured: [number, number][];
}) {
  const diff = rangeDifference(declared, measured);
  return (
    <div className="font-diff">
      <div className="diff-row">
        <span className="diff-label only-declared" title="声明覆盖但字体中无字形的码位">
          声明有 / 实测无
        </span>
        <span className="diff-count mono">
          {diff.onlyACount.toLocaleString()} 码位 · {diff.onlyA.length} 段
        </span>
      </div>
      <div className="diff-ranges mono">{formatRangesCompact(diff.onlyA, 4)}</div>
      <div className="diff-row">
        <span className="diff-label only-measured" title="字体实际支持但声明范围未列出的码位">
          实测有 / 声明无
        </span>
        <span className="diff-count mono">
          {diff.onlyBCount.toLocaleString()} 码位 · {diff.onlyB.length} 段
        </span>
      </div>
      <div className="diff-ranges mono">{formatRangesCompact(diff.onlyB, 4)}</div>
    </div>
  );
}

/** 单个字体条目下的本地文件上传区（文件框始终保留但视觉隐藏） */
function UploadBox({
  upload,
  setInput,
  onPick,
  onChange,
  onClear,
}: {
  upload: FontUpload | null;
  setInput: (el: HTMLInputElement | null) => void;
  onPick: () => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  const hiddenInput = (
    <input
      ref={setInput}
      type="file"
      accept=".ttf,.otf,font/ttf,font/otf"
      className="upload-input"
      onChange={onChange}
    />
  );
  if (!upload) {
    return (
      <div className="upload-box">
        <button type="button" className="btn small ghost upload-btn" onClick={onPick}>
          ⤒ 上传 TTF / OTF（仅本地解析，不上传）
        </button>
        {hiddenInput}
      </div>
    );
  }
  return (
    <div className={`upload-box status-${upload.status}`}>
      {upload.status === 'parsing' && (
        <span className="upload-line">
          <span className="spin">◌</span> 正在解析 <code>{upload.fileName}</code>（
          {formatSize(upload.fileSize)}）…
        </span>
      )}
      {upload.status === 'ok' && (
        <span className="upload-line">
          <span className="upload-ok">✓</span>
          <code>{upload.fileName}</code>
          <span className="muted small">
            {formatSize(upload.fileSize)} · cmap{' '}
            {upload.mergedFormats.map((f) => `format ${f}`).join(' + ')}
            {upload.selectedSubtable === 'format-12' ? '（format 12 优先）' : ''} ·{' '}
            {upload.cmapRecordCount} 条编码记录
          </span>
          <button type="button" className="btn small ghost" onClick={onPick}>
            重新选择
          </button>
          <button type="button" className="btn small ghost" onClick={onClear}>
            清除文件
          </button>
        </span>
      )}
      {upload.status === 'error' && (
        <span className="upload-line">
          <span className="upload-bad">✕</span>
          <code>{upload.fileName}</code>
          <span className="font-msg error">解析失败：{upload.error}</span>
          <button type="button" className="btn small ghost" onClick={onPick}>
            重新选择
          </button>
          <button type="button" className="btn small ghost" onClick={onClear}>
            清除文件
          </button>
        </span>
      )}
      {hiddenInput}
    </div>
  );
}

/**
 * 字体列表编辑器：顺序即回退偏好（第 1 位最优先）。
 * 范围语法：U+0020-007E、U+4E00、U+4??（通配），逗号/空白分隔。
 */
export default function FontEditor({
  fonts,
  parsed,
  uploads,
  onUpload,
  onClearUpload,
  onUpdate,
  onMove,
  onRemove,
  onAdd,
}: FontEditorProps) {
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  return (
    <div className="font-editor">
      <div className="font-list">
        {fonts.map((f, i) => {
          const p = parsed[i];
          const upload = uploads[f.id] ?? null;
          return (
            <div
              className={`font-row${p?.error ? ' has-error' : ''}${
                p?.rangeSource === 'measured' ? ' measured' : ''
              }`}
              key={f.id}
            >
              <div className="font-order" title="偏好顺序（1 = 最优先）">
                {i + 1}
              </div>
              <div className="font-fields">
                <input
                  className="font-name"
                  value={f.name}
                  placeholder="字体名称，如 Han Sans SC"
                  onChange={(e) => onUpdate(f.id, { name: e.target.value })}
                />
                <input
                  className="font-ranges mono"
                  value={f.rangesText}
                  placeholder="U+0020-007E, U+4E00-9FFF（支持 U+4?? 通配）"
                  spellCheck={false}
                  onChange={(e) => onUpdate(f.id, { rangesText: e.target.value })}
                />
                {p?.error ? (
                  <div className="font-msg error">{p.error}</div>
                ) : p ? (
                  <div className="font-msg">
                    声明覆盖 {p.codepointCount.toLocaleString()} 个码位 · {p.ranges.length} 段
                    {p.rangeSource === 'measured' && (
                      <span className="source-tag" title="当前求解使用字体文件 cmap 实测覆盖">
                        · 求解改用实测 {(p.upload?.measuredCount ?? 0).toLocaleString()} 码位
                      </span>
                    )}
                  </div>
                ) : null}
                <UploadBox
                  upload={upload}
                  setInput={(el) => {
                    fileInputs.current[f.id] = el;
                  }}
                  onPick={() => fileInputs.current[f.id]?.click()}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUpload(f.id, file);
                    e.target.value = '';
                  }}
                  onClear={() => onClearUpload(f.id)}
                />
                {upload?.status === 'ok' && !p?.error && p && (
                  <CoverageDiff declared={p.ranges} measured={upload.measuredRanges ?? []} />
                )}
                {upload?.status === 'ok' && p?.error && (
                  <div className="font-msg">
                    声明范围无法解析；字体实测覆盖{' '}
                    {countCodepoints(upload.measuredRanges ?? []).toLocaleString()} 码位 ·{' '}
                    {(upload.measuredRanges ?? []).length} 段
                  </div>
                )}
              </div>
              <div className="font-actions">
                <button
                  className="btn icon"
                  title="上移（提高优先级）"
                  disabled={i === 0}
                  onClick={() => onMove(f.id, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn icon"
                  title="下移（降低优先级）"
                  disabled={i === fonts.length - 1}
                  onClick={() => onMove(f.id, 1)}
                >
                  ↓
                </button>
                <button className="btn icon danger" title="删除字体" onClick={() => onRemove(f.id)}>
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn ghost add-font" onClick={onAdd}>
        ＋ 添加字体
      </button>
    </div>
  );
}
