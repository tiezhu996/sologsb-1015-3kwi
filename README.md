# 古诗格律校勘台

面向诗词编辑与校勘人员的浏览器工作台。可逐字标注平仄、韵组和停顿，建立对仗关系，记录每条判断依据，并对多个异文版本进行并排定位。

## 功能

- 录入诗句并按五言、七言格律模板逐字对照。
- 平仄、停顿、韵组、判断依据和批注可逐字维护。
- 自动提示出律位置、一三五位置可接受变体、待标字和重复用韵。
- 建立句间对仗关系，记录关系说明。
- 多版本独立校勘，字符级并排比较与上下处差异定位。
- 校勘员批次（如宋刻本逐字标注）合流：来源正文生成只读快照，平仄、韵组、停顿、对仗先入候选。
- 异文按句 LCS 对齐、逐字并列保留；选定来源前不覆盖当前稿，正文一改按位置重算标注，只有真改字转“待复核”（带来源）。
- 合流失败保留批次与已确认选择，重试复用快照、不重复生成版本；可整体撤销回到合流前。
- 文档级撤销/重做、键盘巡校和浏览器本地持久化。
- 导出包含字音标注、检查记录、待复核清单、合流来源和版本对照的 Markdown 校对稿。
- 针对平板和桌面优化布局，支持长时编辑。

## 校勘员批次格式

在“宋刻本合流”页粘贴 JSON（也可点“载入示例批次”）：

```json
{
  "batchId": "song-chunxiao-01",
  "source": "宋蜀刻本《孟浩然诗集》",
  "name": "宋刻本 · 春晓批校",
  "lines": ["春眠不觉晓，", "处处闻鸣鸟。"],
  "marks": [{ "line": 1, "position": 3, "char": "鸣", "tone": "平", "rhyme": "", "pauseAfter": false, "basis": "宋本作鸣", "note": "异文：啼→鸣" }],
  "antithesis": [{ "leftLine": 0, "rightLine": 3, "note": "起结相应" }]
}
```

- `source` 必填，`lines` 与 `text` 二选一；`line/position` 从 0 开始、不含标点。
- 校验失败不会改动当前稿，修正输入后直接重试即可，已确认选择保留。
- 候选默认全部“保留当前稿”，逐条或整句选择“取宋刻本”，应用后真改字自动转待复核。

## 技术栈

- Angular 19（standalone components）
- TypeScript
- NG-ZORRO
- RxJS 与 Angular Signals
- Less
- 原生 `localStorage`

## 本地开发

```bash
npm install
npm start
```

浏览器打开终端提供的本地地址。

## 生产构建

```bash
npm run build
```

生产文件位于 `dist/app/browser/`。

## 键盘操作

| 快捷键 | 操作 |
| --- | --- |
| `↑ / ↓ / ← / →` | 在字格中移动 |
| `1 / 2 / 3` | 标为平 / 仄 / 中 |
| `R` | 循环切换韵组 |
| `Space` | 切换停顿标记 |
| `Ctrl/Cmd + Z` | 撤销 |
| `Ctrl/Cmd + Shift + Z` 或 `Ctrl/Cmd + Y` | 重做 |
| `Ctrl/Cmd + S` | 本地保存提示 |

## Docker

容器内由 nginx 监听端口 `80`，源码不硬编码宿主端口。

```bash
docker build -t classical-poetry-meter-editor .
docker run --rm -p 10015:80 classical-poetry-meter-editor
```

宿主端口 `10015` 仅用于本地运行示例，实际端口由根编排文件统一管理。
