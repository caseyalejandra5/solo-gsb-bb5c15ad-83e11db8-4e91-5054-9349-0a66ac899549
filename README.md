# Unicode 字体回退链审计台

无需登录的纯前端审计工具（React + TypeScript + Vite）：粘贴待渲染文本、录入字体名称及其
Unicode 覆盖范围，系统按**字素簇**（grapheme cluster）计算每种字体可覆盖的字符并标出缺失项；
核心求解器在**保持字体顺序偏好**与**链长度最短**之间折中，求出可行回退链，解释每个字素簇由
哪种字体承接，并导出 **CSS font-family** 与**审计 JSON**。

## 一键启动（Docker Compose）

```bash
docker compose up --build
```

启动后访问：**http://localhost:8080**

- 端口映射：宿主机 `8080` → 容器 `80`（在 `docker-compose.yml` 的 `ports` 中可改）
- 后台运行：`docker compose up -d --build`
- 停止：`docker compose down`

也可以只用 Docker：

```bash
docker build -t font-fallback-audit .
docker run --rm -p 8080:80 font-fallback-audit
# 访问 http://localhost:8080
```

## 本地开发

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 类型检查 + 产物构建（输出 dist/）
npm run preview    # 预览构建产物 http://localhost:4173
```

## 使用说明

1. **待渲染文本**：粘贴文本，系统用 `Intl.Segmenter` 切分为字素簇（正确处理
   ZWJ 表情序列、组合符、旗帜等）。
2. **字体与覆盖范围**：逐行录入字体名称与 Unicode 范围，**列表顺序即回退偏好**
   （可用 ↑↓ 调整）。范围语法：
   - `U+0020-007E`（区间）、`U+4E00`（单码位）、`U+4??`（通配，等价 `U+400-4FF`）
   - 多个范围用逗号、分号或空白分隔；`U+` 前缀可省略
3. **求解偏好**：滑杆在「顺序优先」与「链长优先」之间调节权重；可勾选是否忽略
   透明格式字符（ZWJ、变体选择符等，默认忽略，随簇内其它字符渲染）。
4. **结果**：概览统计、最优回退链（每种字体承接多少簇）、缺失告警、逐字素簇明细
   （可筛选），以及一键复制/下载的 CSS 与审计 JSON。

## 求解模型

- 每个字素簇要求：簇内全部「需覆盖码位」都落在某字体范围内，该字体才可承接此簇。
- 求解目标：为所有可覆盖的簇选出字体子集（hitting set），最小化
  `λ·链长 + (1-λ)·偏好位次代价`，λ 由滑杆控制；选出的字体按偏好顺序排列即为
  CSS font-family 回退顺序，每个簇由链中第一种可覆盖字体承接（与浏览器回退语义一致）。
- 算法：无可覆盖字体的簇直接标记**缺失** → 唯一候选字体强制入选 → 支配约简 →
  贪心 + 删除/交换局部搜索得到初始解 → **分支定界**在节点预算内求精确最优
  （超预算或规模过大时自动退回启发式解，并在界面标注「启发式」）。

## 目录结构

```
├── Dockerfile             # 多阶段：node 构建 → nginx 托管
├── docker-compose.yml     # 一键启动，端口 8080:80
├── nginx.conf             # SPA 回退 + 静态资源缓存
├── index.html
└── src/
    ├── App.tsx            # 状态编排：文本/字体 → 分析 → 求解 → 展示
    ├── lib/
    │   ├── grapheme.ts    # 字素簇切分（Intl.Segmenter）、透明码位
    │   ├── ranges.ts      # Unicode 范围解析（含 U+4?? 通配）
    │   ├── coverage.ts    # 逐簇覆盖分析
    │   ├── solver.ts      # 回退链求解（分支定界 + 启发式兜底）
    │   └── audit.ts       # CSS / 审计 JSON 导出
    └── components/        # 字体编辑器、明细表、结果面板
```
