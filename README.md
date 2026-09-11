# NBA Card Arena · NBA球星卡抽卡组阵容

> 抽选 NBA 球星闪卡，组建你的梦幻五人首发。
> 卡面遵循 `holo-card-studio` 技能的四层素材规范，网页端用其实时镭射着色器渲染：
> 视差分层、彩虹镭射、扫光、星点、Bloom。

仓库：https://github.com/klT45/nba-card-arena

## 快速开始

```bash
npm install
npm run build:cards     # 依据球员库生成 9 张卡的图层与静态图
npm run dev             # http://127.0.0.1:5173 （同时提供卡库管理接口）
npm run preview         # http://127.0.0.1:4174 （生产构建预览）
```

## 球员库（可扩展到二三十人）

单一数据源：**`cards/library/players.json`**，每位球员一条记录；图片放在
**`cards/library/<id>/`** 下：

```
cards/library/
├── players.json            # 元数据（入库）
└── <id>/
    ├── photo.jpg           # 你上传/下载的原图（本地，不入库）
    └── cutout.png          # rembg 抠好的带 alpha 主体（本地，不入库）
```

新增一位球员只需要三步：

1. 放入 `cards/library/<id>/photo.jpg`；
2. 在 `players.json` 追加一条记录（或在后台点「新增球员」）；
3. 跑 `npm run cutouts` 抠图，再跑 `npm run build:cards`。

或者直接打开 **卡库管理后台** 用界面完成：上传图片会自动抠图并只重建这一张卡。

## 卡库管理后台

本地开发模式下访问 **http://127.0.0.1:5173/admin.html**（展厅页脚也有「卡库管理 ↗」入口）。

- 逐位球员编辑：姓名、号码、球队、称号、稀有度、**卡面风格**、多选位置、主辅色、素材署名；
- 上传 / 拖拽替换该球员的图片 → 自动调用 rembg 抠图 → 自动重建该卡 → 即时预览；
- 新增球员、删除球员、单卡重建、全部重建；
- 底部显示构建日志。

> 后台依赖 `npm run dev` 注入的本地接口（`scripts/vite-admin-plugin.mjs`），
> 生产静态站中不可用，会给出提示。接口无鉴权，仅在本机开发时启用。

## 卡面风格（5 套，可逐卡选择）

风格由 `scripts/card_styles.py` 定义，同时决定背景配方、文字配色和着色器参数
（foil 强度、视差缩放/深度）：

| id | 名称 | 说明 |
| --- | --- | --- |
| `arena` | 霓虹竞技场 | 深色球场渐变 + 光柱 + 团队色霓虹 |
| `atelier` | 幻光典藏 | 技能默认：墨蓝底 + 古金描边 + 菱纹 |
| `gold` | 鎏金典藏 | 金属拉丝金 + 高亮金边 |
| `ink` | 水墨 | 宣纸米白 + 墨晕 + 朱红印章 |
| `prism` | 棱镜虹彩 | 高饱和多色渐变 + 强虹光 |

在后台把某位球员的「卡面风格」改掉、保存即可重出该卡；也可以直接改 `players.json` 的 `style`。

## 功能

- **展厅**：按位置、球队、卡面风格三重筛选；卡片拖拽只更新 CSS 变换，保持流畅。
- **实时镭射卡面**：详情弹窗、首页主卡、抽卡揭晓由 `src/holo.js` 实时渲染，复用技能的四层着色器。
- **抽卡**：随机抽取 → 卡面揭晓 → 选择位置 → 确认加入（确认后自动关闭弹窗）→ 或「暂不加入」。
- **阵容**：五个位置各限一人；多位置球星自由选择；同一球员不可重复上阵；显示已上阵人数。
- **无评分**：不含球员评分/能力值，卡面展示球队、位置、编号与称号。
- **中文排版**：中文标题使用中文字体栈，行高与字距按中文调整。

## 素材管线

```
scripts/source_players.py   # （可选）从 Wikimedia Commons 检索候选照片并客观打分选优
scripts/make_cutout.py      # 单张照片 → rembg 抠图
scripts/make_cutouts.py     # 批量抠图（--force / --only）
scripts/build_cards.py      # 依据球员库 + 风格生成四层素材、静态卡面与 manifest
scripts/card_styles.py      # 五套卡面风格定义
src/holo.js                 # 技能着色器的网页端实现（薄卡片网格，无需逐卡 Blender 导出）
```

`build_cards.py` 为每位球员输出等尺寸图层（1024×1493）：`layers/subject.png`（真实 alpha）、
`layers/background.png`、`layers/lineart.png`（白底墨线）、`layers/text.png`（仅文字），
以及 `front.webp` / `thumb.webp`、`card.json` 与技能兼容的 `card-config.json`。
图层通过技能 `validate_assets.py` 的等价校验。

## 从 holo-card-studio 复用了什么

- **四层素材规范**与**校验规则**：沿用技能 `validate_assets.py`（本仓库按其规则校验，可直接用技能脚本复核）。
- **实时着色器**：`src/holo.js` 移植技能 `assets/web-holographic/app.js` 的 GLSL（视差 / 光谱 / 扫光 / 星尘 / Bloom）。
- **`atelier` 风格**：取自技能默认的墨蓝 + 古金视觉。
- **展厅元数据模式**：沿用技能 `references/gallery-distribution.md` 的「一卡一目录 + 元数据 + 生成清单 + 多维筛选」思路。
- **未复用** Blender 管线（`build_card.py` / `export_web.py`）：它们按技能自有中文对象名导出 GLB，
  逐卡跑 Blender 对二三十张卡的批量维护过重，因此网页端改为薄卡片网格 + 同一套着色器。

## 目录结构

```
nba-card-arena/
├── cards/
│   ├── library/              # 球员库：players.json（入库）+ 各球员图片（本地）
│   ├── lebron-james-001/     # 技能产出的首张卡（Blender 工程 + 四层图 + 本地 3D 预览）
│   └── _work/                # 抓取/抠图缓存（不入库）
├── public/
│   ├── cards/<id>/           # 生成的卡面与图层（入库）
│   └── legacy/lebron/        # 首张卡的 Three.js 3D 预览（静态托管）
├── scripts/                  # 素材管线 + 后台接口插件
├── src/                      # 站点代码（main.js / holo.js / admin.js / style.css / admin.css）
├── admin.html                # 卡库管理后台
└── index.html
```

## 素材与权利声明（重要）

- 除 LeBron 外，全部球员照片来自 **Wikimedia Commons**，以 **CC BY 2.0 / CC BY-SA 4.0** 授权，
  已在 `public/cards/manifest.json` 的 `sourceUrl` / `sourceCredit` 逐张署名；原始照片不入库。
- LeBron 主体图来自 pngdownload.io（**CC BY-NC 4.0：署名、非商业**），原始文件不入库。
- 球员肖像权、NBA / 球队商标归各自权利人所有。本仓库仅作**技术演示与个人学习**，不得用于商业发行。
- 代码部分 MIT（见 LICENSE）。
