# NBA Card Arena · NBA球星卡抽卡组阵容

> 抽选 NBA 球星闪卡，组建你的梦幻阵容。
> 每张卡由 `holo-card-studio` 技能制作：Blender 全息材质 + Three.js 可交互网页（拖拽旋转 / 翻面 / 镭射 / 手机适配）。

仓库：https://github.com/klT45/nba-card-arena

## 首张卡 · LeBron James No.23（已交付）

- 目录：`cards/lebron-james-001/`
- 配置：湖人紫金配色，`CHOSEN ONE / 4× NBA Champion · All-Time Scoring King`，编号 `001 / 023`
- 产物：
  - `card.blend` — 可编辑 Blender 工程（已兼容 Blender 5.x，见下）
  - `renders/hero.png` — 渲染图
  - `web/` — 本地预览站（`node server.mjs` 后打开 http://127.0.0.1:4173）
  - `assets/` — background / subject / lineart / text 四层图 + `card-config.json`
  - `verification.json` + `asset-validation.json` — 构建报告

本地预览：

```bash
cd cards/lebron-james-001/web
npm install --ignore-scripts --no-audit --no-fund
node server.mjs
# 打开 http://127.0.0.1:4173
```

## 目录结构

```
nba-card-arena/
├── cards/
│   └── lebron-james-001/   # 首张：LeBron James 全息镭射卡
├── docs/                   # （规划）抽卡概率、阵容规则
├── app/                    # （规划）抽卡 + 阵容前端
└── README.md
```

## 路线图

- [x] 技能包接入（`holo-card-studio`）
- [x] 首张闪卡：LeBron James 全息卡 + 本地预览验证
- [ ] 第 2–5 张卡（库里 / 杜兰特 / 约基奇 / 字母哥 …）
- [ ] 多卡展厅（参考技能 `references/gallery-distribution.md`）
- [ ] 抽卡系统（概率 / 保底 / 重复分解）
- [ ] 阵容系统（5 人首发 + 能力值 + 羁绊）

## 制卡方式（给未来的自己）

技能已安装到：

- `C:/Users/lu/.agents/skills/holo-card-studio/`（自动加载）
- `C:/Users/lu/.config/opencode/skills/holo-card-studio/`（全局）

新卡流程（全息路线）：准备 1024×1536 四层 PNG → 写 `card-config.json` →
`generate_typography.py` 生成文字层 → `validate_assets.py` 校验 →
`scripts/holographic/run_pipeline.py --project <dir>` 构建。

> 兼容性补丁：原技能只支持 Blender 4.5（`scene.node_tree`），
> 本机 Blender 5.1 已通过补丁兼容（`compositing_node_group` + Glare 节点兜底），
> 改动在技能目录 `scripts/holographic/build_card.py` 与 `scripts/build_card.py`。

## 素材与权利声明（重要）

- 首张卡主体图来源：https://pngdownload.io/png-image/lebron-james-in-lakers-jersey-nba-superstar-transparent-png-image/ ，
  License 为 **CC BY-NC 4.0（需署名、非商业）**，原始下载文件未入库，仅保留署名与链接。
- 球员肖像权、NBA / 球队商标归各自权利人所有。本仓库首张卡仅作**技术演示与个人学习**，
  不得用于商业发行。如需公开发行请替换为正版授权素材或原创画作。
- 代码部分 MIT（见 LICENSE）。
