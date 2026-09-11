# NBA Card Arena · NBA球星卡抽卡组阵容

> 抽选 NBA 球星闪卡，组建你的梦幻五人首发。
> 卡面由 `holo-card-studio` 技能的四层素材规范制作，网页端用其实时镭射着色器渲染：
> 视差分层、彩虹镭射、扫光、星点、Bloom。

仓库：https://github.com/klT45/nba-card-arena

## 在线体验

```bash
npm install
npm run build:cards   # 生成 9 张卡的图层与静态图（需要 cards/_work/cut/*.png）
npm run dev           # http://127.0.0.1:5173
# 或
npm run preview       # http://127.0.0.1:4174
```

## 卡池（9 位 · 覆盖五个位置）

| 球员 | 位置 | OVR | 稀有度 |
| --- | --- | --- | --- |
| LeBron James | PG / SF | 98 | MYTHIC |
| Stephen Curry | PG | 97 | MYTHIC |
| Luka Doncic | PG / SG | 97 | MYTHIC |
| Devin Booker | SG / PG | 94 | ELITE |
| Kevin Durant | SF / PF | 97 | MYTHIC |
| Jayson Tatum | SF / PF | 96 | MYTHIC |
| Giannis Antetokounmpo | PF / C | 97 | MYTHIC |
| Victor Wembanyama | PF / C | 96 | MYTHIC |
| Nikola Jokic | C | 98 | MYTHIC |

## 功能

- **展厅**：按位置筛选，卡片拖拽时只更新 CSS 变换（不持续跑后处理），保持滑动流畅。
- **实时镭射卡面**：详情弹窗与首页主卡由 `src/holo.js` 实时渲染，复用技能的四层着色器。
- **抽卡**：随机抽取 → 卡面揭晓 → 选择位置 → 确认加入（确认后自动关闭弹窗）→ 或「暂不加入」。
- **阵容**：五个位置各限一人；多位置球星可自由选择；同一球员不可重复上阵；TEAM OVR 实时计算。
- **中文排版**：标题使用中文字体栈（Noto Sans SC / PingFang SC / 微软雅黑），修正了此前中文继承
  拉丁紧排参数导致的字距/行高错乱。

## 素材管线

```
scripts/source_players.py   # 从 Wikimedia Commons 检索候选照片 → rembg(u2net_human_seg) 抠图 → 客观打分选优
scripts/build_cards.py      # 生成四层素材 + 静态卡面，并写出 manifest.json
src/holo.js                 # 技能着色器的网页端实现（薄卡片网格，无需逐卡 Blender 导出）
```

`build_cards.py` 为每位球员输出与前缀一致的等尺寸图层（1024×1493）：
`layers/subject.png`（带真实 alpha）、`layers/background.png`、`layers/lineart.png`（白底墨线）、
`layers/text.png`（仅文字，带 alpha），以及展厅/抽卡用的合成 `front.webp` / `thumb.webp`。
图层通过技能 `validate_assets.py` 的等价校验（尺寸一致、主体与文字同时存在可见与透明像素、线稿深色压白底）。

## 目录结构

```
nba-card-arena/
├── cards/
│   ├── lebron-james-001/     # 技能产出的首张卡（Blender 工程 + 四层图 + 本地 3D 预览）
│   └── _work/                # 本地缓存：候选原图与抠图（不入库）
├── public/
│   ├── cards/<id>/           # 生成的卡面与图层（入库）
│   └── legacy/lebron/        # 首张卡的 Three.js 3D 预览（静态托管）
├── scripts/                  # 素材管线
├── src/                      # 站点代码（main.js / holo.js / style.css）
└── index.html
```

## 素材与权利声明（重要）

- 除 LeBron 外，全部球员照片来自 **Wikimedia Commons**，以 **CC BY 2.0 / CC BY-SA 4.0** 授权，
  已在 `public/cards/manifest.json` 的 `sourceUrl` / `sourceCredit` 中逐张署名。原始照片不入库。
- LeBron 主体图来源：https://pngdownload.io/png-image/lebron-james-in-lakers-jersey-nba-superstar-transparent-png-image/
  （**CC BY-NC 4.0：署名、非商业**），原始文件不入库。
- 球员肖像权、NBA / 球队商标归各自权利人所有。本仓库仅作**技术演示与个人学习**，不得用于商业发行。
- 代码部分 MIT（见 LICENSE）。
