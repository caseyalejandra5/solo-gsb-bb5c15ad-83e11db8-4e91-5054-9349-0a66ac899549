import type { FontSpec, ParsedFont } from '../types';

interface FontEditorProps {
  fonts: FontSpec[];
  parsed: ParsedFont[];
  onUpdate: (id: string, patch: Partial<FontSpec>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

/**
 * 字体列表编辑器：顺序即回退偏好（第 1 位最优先）。
 * 范围语法：U+0020-007E、U+4E00、U+4??（通配），逗号/空白分隔。
 */
export default function FontEditor({ fonts, parsed, onUpdate, onMove, onRemove, onAdd }: FontEditorProps) {
  return (
    <div className="font-editor">
      <div className="font-list">
        {fonts.map((f, i) => {
          const p = parsed[i];
          return (
            <div className={`font-row${p?.error ? ' has-error' : ''}`} key={f.id}>
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
                    覆盖 {p.codepointCount.toLocaleString()} 个码位 · {p.ranges.length} 段
                  </div>
                ) : null}
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
