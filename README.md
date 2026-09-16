# NBA Card Arena · NBA球星卡抽卡组阵容

> 抽选 NBA 球星闪卡，组建你的梦幻五人首发。
> 卡面遵循 `holo-card-studio` 技能的四层素材规范，网页端用其实时镭射着色器渲染：
> 视差分层、彩虹镭射、扫光、星点、色彩分级。

仓库：https://github.com/klT45/nba-card-arena

## 快速开始

```bash
npm install
npm run doctor          # 检查 Python 解释器与依赖是否就绪（换图前建议先跑）
npm run source:players  # （可选）从 Wikimedia Commons 采集候选比赛照并自动选优
npm run cutouts         # BiRefNet 抠图 → cards/library/<id>/cutout.png
npm run build:cards     # 依据球员库生成 22 张卡的图层与静态图
npm run dev             # http://127.0.0.1:5173 （同时提供卡库管理接口）
npm run preview         # http://127.0.0.1:4174 （生产构建预览）
```

> 前端运行时依赖三个包：`three`（实时镭射卡面）、`gsap`（抽卡时间轴）、
> `canvas-confetti`（粒子爆发）。GSAP 自 2025-05 由 Webflow 赞助后**全部插件免费**，
> 含商业用途，无需 license key。
>
> 抠图与素材采集依赖 `rembg` + `onnxruntime`。本机用的是隔离环境
> `~/.workbuddy-ai/binaries/python/envs/holo`，直接跑
> `~/.workbuddy-ai/binaries/python/envs/holo/Scripts/python.exe scripts/...` 即可。
> 其余脚本（`build_cards.py`）只用 Pillow / numpy / opencv / scipy。
> 后台/脚本用哪个解释器，可用 `CARD_ARENA_PYTHON` 指定；不指定时按
> `npm run doctor` 打印的候选顺序自动挑第一个存在的。
>
> **所有 Python 的 npm 脚本都经 `scripts/pyrun.mjs` 转发**，而不是裸 `python`。
> 原因：本项目没有自己的 venv，而 PATH 上的 `python` 可能解析到一个**没装依赖**的
> 运行时（本机就是——`python -c "import PIL"` 会 ModuleNotFoundError，但
> `npm run doctor` 却报「全部就绪」，因为 doctor 是按候选顺序解析的）。
> `pyrun.mjs` 复用同一个 `pythonBin()`，让命令行和后台 API 用同一个解释器，
> 并保留 `CARD_ARENA_PYTHON` 覆盖和退出码透传（`&&` 链能正常短路）。

## 卡面构成（海报式三层）

每张卡由三层合成，再叠加镭射：

| 层 | 内容 | 说明 |
| --- | --- | --- |
| `layers/background.png` | 真实比赛照片 → 队伍色双色调 + 模糊 + 暗角 + 光柱/网点/速度线 | 照片里原本的人物会用 `cv2.inpaint` 抹掉，避免和主体重影 |
| `layers/subject.png` | BiRefNet 抠出的球员主体 | 按宽度铺满卡面，身高超过 1.9:1 时裁成「七分身」海报构图，截断处正好落在名牌后面；带队伍色背光与接触阴影 |
| `layers/text.png` | 队名 / 位置 / 稀有度 / 姓名 / 称号 / 编号 | Bahnschrift Condensed 展示字体，底部名牌压住人物下半身 |

`lineart.png` 由主体 alpha 的 Canny 边缘生成，供着色器描边使用。

## 卡池（22 位 · 4 档稀有度 · 覆盖五个位置）

| 稀有度 | 球员 | 位置 | 球队 | 卡面风格 |
| --- | --- | --- | --- | --- |
| MYTHIC | LeBron James | PG / SF | PHI | 幻光典藏 |
| MYTHIC | Stephen Curry | PG | GSW | 霓虹竞技场 |
| MYTHIC | Kevin Durant | SF / PF | HOU | 水墨 |
| ELITE | Giannis Antetokounmpo | PF / C | MIA | 霓虹竞技场 |
| ELITE | Nikola Jokic | C | DEN | 鎏金典藏 |
| ELITE | Luka Doncic | PG / SG | LAL | 棱镜虹彩 |
| ELITE | Jayson Tatum | SF / PF | BOS | 鎏金典藏 |
| ELITE | Shai Gilgeous-Alexander | PG / SG | OKC | 棱镜虹彩 |
| RARE | Devin Booker | PG / SG | PHX | 霓虹竞技场 |
| RARE | Victor Wembanyama | PF / C | SAS | 棱镜虹彩 |
| RARE | Anthony Edwards | SG / SF | MIN | 霓虹竞技场 |
| RARE | Joel Embiid | C | PHI | 鎏金典藏 |
| RARE | Anthony Davis | PF / C | WAS | 霓虹竞技场 |
| RARE | Tyrese Haliburton | PG / SG | IND | 棱镜虹彩 |
| COMMON | Darius Garland | PG / SG | LAC | 棱镜虹彩 |
| COMMON | Trae Young | PG | WAS | 霓虹竞技场 |
| COMMON | Cade Cunningham | PG / SG | DET | 鎏金典藏 |
| COMMON | Josh Giddey | SG / PG | CHI | 幻光典藏 |
| COMMON | Franz Wagner | SF / PF | ORL | 霓虹竞技场 |
| COMMON | Evan Mobley | PF / C | CLE | 棱镜虹彩 |
| COMMON | Alperen Sengun | C / PF | HOU | 鎏金典藏 |
| COMMON | Rudy Gobert | C | MIN | 水墨 |

## 抽卡规则

抽卡在 `src/draw/draw.js` 的 `drawCandidate()` 里，两条规则：

1. **不会抽到已在首发阵容里的球员。** 抽之前先把 `state.lineup` 里的 id 排除掉，
   所以连抽会持续给出新面孔，而不是反复抽到同一个人。
   如果五个位置都已满（22 人全上阵），池子回退成整池，卡面下方会提示
   「首发五人已满，本抽不再排除已上阵球员」。
2. **按稀有度加权。** 权重写在 `RARITY_WEIGHT`：

   | 档位 | 含义 | 人数 | 权重 | 单档概率 | 人均概率 |
   | --- | --- | --- | --- | --- | --- |
   | MYTHIC | 神话级 | 3 | 2 | 约 5% | 约 1.7% |
   | ELITE | 精英级 | 5 | 3 | 约 13% | 约 2.6% |
   | RARE | 稀有级 | 6 | 5 | 约 26% | 约 4.3% |
   | COMMON | 普通级 | 8 | 8 | 约 56% | 约 7.0% |

   权重是整数、每次抽取按当前池重新归一化，所以排除掉已上阵球员后曲线不会走样。
   COMMON 是最底档，RARE 在它之上——这样命名才跟卡牌游戏通行的
   Common < Rare < Epic < Legendary 阶梯一致。

稀有度分级不写死在代码里，改的是 `cards/library/players.json` 的 `rarity` 字段。
想整体重排可以直接编辑 `scripts/retier.py` 里的 `TIERS` 再跑：

```bash
npm run retier -- --dry-run   # 先看会改哪些人
npm run retier                # 写回 players.json
npm run build:cards           # 让新稀有度进入卡面与 manifest
```

脚本会双向校验 `TIERS` 与球员库是否一一对应，多一个或少一个都会报错退出。
也可以只在后台逐位球员改稀有度，不必跑脚本。

### 抽卡动效

编排在 `src/draw/draw.js`，用 **GSAP 时间轴**串起四拍，配 **canvas-confetti** 做粒子爆发：

| 拍 | 内容 |
| --- | --- |
| 1 撕包 | `.pack` 待机时无限上下浮动；点击后 `pack-rip .62s` 放大旋转淡出 |
| 2 蓄力 | `.draw-charge` 光团。**抽取结果在这时候就已经定了**，光团颜色就是该档位的颜色（MYTHIC 绿 / ELITE 冰蓝 / RARE 紫 / COMMON 骨白），整个 `--rarity` 会同时染到背景、光柱、星点、火花上。档位越高蓄力越久（750 / 900 / 1150 / 1400ms），光柱在这期间转得更快 |
| 3 爆闪 | 光团炸开（`charge-burst`）+ 白闪（`flaring`）+ 彩带（双段：主爆发 + 90ms 后一圈更宽更慢的扩散）+ 舞台震动（振幅按档位 4 / 6 / 9 / 13px）。爆炸也按档位多停一会儿（0.5 / 0.58 / 0.66 / 0.78s），高档的停顿本身就是稀有度信号 |
| 4 揭晓 | 卡面 3D 飞入（`card-land`）+ 16 颗火花 + **姓名逐字翻入**（GSAP `stagger`），稀有度/位置/选位器依次淡入 |

两个容易踩的坑，代码里都有注释：

- **彩带画布必须挂在 `.draw-stage` 内部。** `<dialog showModal()>` 渲染在 top layer，
  canvas-confetti 默认那个 `position:fixed` 的全屏 canvas 会被模态框整个盖住。
- **揭晓时不能直接 `innerHTML = ...`。** 那一刻彩带还在落，重写 DOM 会把画布一起干掉。
  `revealDraw()` 先把画布节点取出来，写完新结构再挂回去——动画绑的是 canvas 元素本身，
  跟它在树里的位置无关。

整条链路是一个 GSAP timeline（`drawTl`），关闭弹窗时 `killDraw()` 一次性 kill 掉
timeline + 所有被 `track()` 记下的 tween + `confetti.reset()`。
（旧写法是嵌套 `setTimeout`，弹窗关了它还在跑，会在用户看不见的地方改写 `#draw-content`。）

`prefers-reduced-motion: reduce` 下所有循环动画关闭、蓄力缩短到 120ms、GSAP 时长归零、
彩带直接不发射（`disableForReducedMotion`）。

首屏 hero 之前**完全无视**这个设置：实测两种模式下卡面都在转、轮播 9s 后都从
LeBron 切到 Curry。它是唯一一个没有任何暂停控件的卡面（详情与抽卡弹窗都有「自动赏卡」
按钮），所以只能靠操作系统设置来关。现在两处都接上了：卡面的 `autoDefault()`
与 8s 轮播的 `reduceMotion.matches`（后者读的是 `.matches` 而不是一次性快照，
改系统设置即时生效）。**有意保留**：MYTHIC 的动态立绘在降级模式下仍然活着——
关掉它之后卡面完全静止，说明残余动效全部来自立绘，别无其它。`npm run test:reduced` 守。

### 组件选型（评估过什么，为什么只留这两个）

| 候选 | 结论 | 原因 |
| --- | --- | --- |
| **GSAP 3.15** | ✅ 采用 | 需要一条**能被 kill 的时间轴**，这是嵌套 `setTimeout` 做不到的。自 2025-05 由 Webflow 赞助后全插件免费（含商用） |
| **canvas-confetti 1.9.4** | ✅ 采用 | 只做"爆发"这一件事，~2KB gzip，可按档位调 count/spread/velocity/colors |
| tsParticles | ✗ | 功能全但体积是 confetti 的几倍，我们要的只是几个爆发点，配置面用不上 |
| party.js | ✗ | 与 confetti 同类，维护活跃度和生态都更弱 |
| anime.js / Motion One | ✗ | 时间轴编排能力不如 GSAP，且 GSAP 已能满足；Motion One 偏 WAAPI 封装，语义更绕 |
| Lottie / dotLottie | ✗ | 要 AE 导出的 JSON 素材，我们没有对应美术管线 |
| Rive | ✗ | 要 `.riv` 美术文件 + 运行时，同样缺素材来源 |
| Live2D Cubism SDK | ✗ | 要分层 PSD + 在 Cubism Editor 里绑骨骼，且 SDK 授权有商业限制 |
| Spine | ✗ | 要骨架 + 图集美术资源 |
| Three.js `EffectComposer` / `UnrealBloom` | ✗ | 上一轮已否决：bloom 会在卡片外写入半透明黑，dest alpha 让页面背景发黑 |

**共同结论：所有"动起来的人物"方案（Live2D / Rive / Lottie / Spine）都要求外部美术资源，
而我们的主体是单张静态 PNG——所以只能走着色器路线**，见下一节。

### 动态立绘（仅 MYTHIC）

最高档卡片里的人物是活的，实现在 `src/render/holo.js` 的前向着色器里。

**为什么不用 Live2D / Rive / Lottie：** 这三者都需要外部美术资源（分层 PSD、矢量工程、
AE 工程），而我们的主体是**一张静态 PNG**——没有骨骼、没有分层，绑不了。

**做法：位移采样坐标，而不是移动几何体。** `aliveWarp()` 给贴图采样点加一个小偏移，
并按高度加权（`h = clamp((p.y - .10) / .90, 0, 1)`，`h²` 收窄）：

```glsl
float breath  = sin(uTime * 1.9)            * .0055 * hh;  // 呼吸：整体上下
float sway    = sin(uTime * 1.15 + .7)      * .0068 * hh;  // 摇摆：左右
float shear   = sin(uTime * .9 + p.y * 6.)  * .0028 * hh;  // 剪切：躯干有体积感
float tremble = sin(uTime * 7.3 + p.y * 42.)* .0007 * hh;  // 微颤：避免机械感
```

权重让**脚踩得稳、上身活**，读起来像一个待机循环而不是一张飘起来的贴纸。
在这之上再叠三样：脉冲轮廓光（`aliveRim()` 用 alpha 梯度取边）、上升能量粒子、
扫过光带。这些叠加都放在 **text 合成之前**，所以姓名和编号不会被辉光糊掉。

`uAlive` 是着色器门控，`ALIVE_RARITIES` 与 `supportsAlive()` 从 `render/holo.js` 导出给
`cards/holo-controls.js` 用——门控和 UI 开关共用同一份定义，不会各改各的而漂移。
赏卡面板里的「开启动态立绘 / 关闭动态立绘」按钮只在 MYTHIC 卡上出现。

`prefers-reduced-motion: reduce` 时降到 `ALIVE_REDUCED = 0.4`：保留轮廓光与粒子，
但 UV 形变不产生实际位移，画面是静止的。

## 回归脚本

以下脚本需要先 `npm run dev` 起服务（默认打 `http://127.0.0.1:5173`，
可用 `BASE=http://127.0.0.1:xxxx` 覆盖）。它们共用 `scripts/_pw.cjs` 解析
`playwright-core` 与 Chromium，不需要预先设 `NODE_PATH`。

| 命令 | 作用 |
| --- | --- |
| `npm run test:exports` | 断言 `src/core.js` 这个 re-export 桶仍然导出拆分前的全部 31 个符号（名单直接从 `git HEAD` 的旧文件里读，不靠手抄），且类型未变 |
| `npm run test:tokens` | 逐个页面解析它真正加载的样式表（跟随 `@import`），断言每一处 `var(--x)` 都能在该页面范围内找到定义。带 fallback 的 `var(--x, …)` 不算问题；JS 运行时写入的令牌（如 `draw.js` 给火花内联的 `--tx`/`--ty`）会被认作已定义 |
| `npm run test:a11y` | 运行时无障碍：可聚焦控件是否都有可访问名（WCAG 4.1.2）、`img` 是否都有 `alt`（1.1.1）、每页是否恰好一个 `h1` 且标题层级不跳级（1.3.1）、打开的 `<dialog>` 是否有可访问名、**滚动名单有没有能用的暂停控件**（2.2.2，行为判据：位移归零）、以及**弹窗焦点管理**（焦点进入 / Tab 不逃逸 / 关闭后归还给触发元素）。**按运行时 DOM 判**，因为大部分交互面是 JS 渲染的 |
| `npm run test:holo` | 卡面挂载契约：`.holo-stage.is-ready` 必须对应一个活着的 `__holo` 句柄。覆盖「在揭晓瞬间关窗」这个异步窗口（`mountHolo` 的 `await show()` 期间弹窗关闭会 dispose 掉刚存进去的实例）。另外在 `--disable-webgl` 的上下文里覆盖无 WebGL 设备的降级：hero / 详情弹窗 / 抽卡揭晓三处都要落到静态卡面图，且不能留下失效的控制面板 |
| `npm run test:lineup` | 阵容完整性：localStorage 里的阵容**不能持有 manifest 里不存在的球员 id**。覆盖加载时修剪、修剪后计数/进度条/槽位三者一致、幽灵位置能被正常填充、真实占用仍然拦得住、以及脏形状（`"hello"` / `123` / `true` / `[]` / `null`）不会让阵容不可用 |
| `npm run test:escaping` | 静态扫描：公开渲染路径里**不能有任何未转义的球员字段**（后台可编辑 → 模板字符串直出，没有框架兜底）。另外 `href` 单独要求走 `safeUrl()` 协议白名单 |
| `npm run test:controls` | 赏卡面板与键盘：面板的按钮文案/滑杆读数必须跟随**真实**状态（键盘 `f`、拖拽、`r` 这些面板看不见的路径也要跟），以及卡面不能把方向键从需要滚动的弹窗那里抢走。含「弹窗不溢出时方向键仍应转卡」这条防过矫正断言 |
| `npm run test:reduced` | 降级动效：在 `prefers-reduced-motion: reduce` 与 `no-preference` 两个上下文里跑同一段首页流程并对照。断言默认模式下自动旋转和 8s 轮播**仍然**工作（防过矫正：直接删掉轮播也能让降级断言变绿），降级模式下两者都停下 |
| `npm run draw:anim` | 逐档强制抽一次，截图卡包 / 蓄力 / 爆闪 / 揭晓四帧到 `output/shots/draw-{pack,charge,result}-{tier}.png` 与 `draw-burst-{tier}.jpg`；并断言四拍全部触发、彩带画布在揭晓后仍存活、姓名已逐字拆包、动态立绘只在 MYTHIC 生效（降级模式下逐帧 A/B 验证）、中途关窗后时间轴已停止 |
| `npm run shot:pages` | 首页 / 抽卡 / 展厅 / 详情四页截图 + 断言零 404、零 console error |
| `npm run shot:admin` | 后台回归：`[hidden]` 是否真的隐藏、球员列表与编辑器是否正常载入 |
| `npm run shot:devices` | 多设备布局审计：5 档视口（375×667 / 393×852 / 412×915 / 768×1024 / 844×390 横屏）逐页量横向溢出、越界元素的**根因**、抽卡弹窗底部是否超出视口、赏卡按钮右边界、以及详情弹窗「加入首发」是否落在**用户可滚动的祖先**里，并把截图落到 `output/shots/devices/` |
| `npm run shot:sheet` | 把上面 25 张截图拼成一张总览图 `output/shots/devices-sheet.png`（需先跑 `shot:devices`），一眼看完 5 台设备 × 5 个界面 |
| `npm run test:admin` | 后台接口契约：新建一个临时球员（借用两位真实球员的素材）→ 上传一个假图片 → 上传一个真图片 → 触发一次会失败的重建 → 删除。断言**上传失败不能动原来的照片和抠图**（字节级比对）、**重建失败必须在 `ok` 字段上标明**（服务端仍返回 200，因为元数据已落盘）、**删除后 `manifest.json` 必须同步**（公开页面读 manifest，后台列表读 `players.json`，两者只在重建时才碰面）。临时球员与两个 JSON 在 `finally` 里还原 |
| `npm run test:rarity` | 在后台里真的把某位球员改档并存盘，验证四档下拉齐全 + manifest 同步（`TARGET="Rudy Gobert"` 可换人） |
| `npm run check` | 上面全部串起来跑一遍。**改完样式或结构后跑这个。** |

> **不要用截图哈希来证明「动效没变」。** 抽卡截图里包含随机抽到的球员、
   `Math.random()` 撒的火花、以及还在下落的彩带，逐字节比对永远不相等——试过一次，
   17 张全 FAIL，什么也证明不了。能证明零回归的是上面这些**断言**（拍点、彩带存活、
   逐字、帧率、导出面名单、多设备量出来的数字）。

### `var()` 引用未定义令牌为什么需要单独一道门禁

`var(--x)` 里的 `--x` 如果从来没被定义，这条声明会在**计算值阶段**失效（IACVT）。
关键点是它**不会回退到本来会生效的另一条规则**——浏览器把它当作 `unset` 处理。
于是「写了但没生效」和「没写」看起来完全一样，不报错、不进 console、截图 diff 也看不出来。

真实案例：`src/gallery.css` 有 6 处引用 `--lime` / `--ink`，这两个令牌只定义在
`admin.css` 里，而 `gallery.html` 并不加载那个文件。结果展厅页「已上阵」的阵容条
渲染成白色 `#f2f4f8`，而不是 `pages.css` 里本该生效的柠檬绿——因为 `gallery.css`
在 `style.css` 之后加载，它那条**无效声明**赢了层叠，然后变成 `unset`。
补上令牌定义后实测：边框 `rgb(242,244,248)` → `rgb(215,255,56)`。

`npm run test:tokens` 就是为这一类 bug 存在的。它**按页面**归因（同一个令牌，
`index.html` 通过而 `gallery.html` 报错，才是正确的输出），并且反向验证过：
撤掉令牌定义 → 精确报出 `gallery.html: src/gallery.css 用了未定义的 --lime/--ink`。

### 卡面挂载契约：`is-ready` 不能比 `__holo` 活得久

`cards/mount.js` 定义了卡面的 DOM 契约：容器上有 `__holo`（活着的实例）和
`is-ready`（「实例已挂载并正在渲染」）。两者必须同时存在。

破坏它的是一个异步窗口：`mountHolo` 里 `await inst.show(player)` 是贴图加载，
**如果这期间弹窗被关掉**，`dialogs.js` 会调 `unmountHolo()` 把刚存进去的实例 dispose 掉、
`__holo` 置空；等 await 恢复，`mountHolo` 仍然往容器上加 `is-ready`——
于是 stage 声称「已就绪」，背后却是一个已销毁的渲染器。实测在揭晓瞬间关窗，
**6/6 次**命中这个窗口。

修法是 await 之后确认句柄还是自己那个：

```js
if (container.__holo !== inst) return null;
container.classList.add("is-ready");
```

`npm run test:holo` 守这条不变量，反向验证过：撤掉守卫 → `{"total":2,"broken":1,"ready":2}`，
精确指出那个「`is-ready` 挂在空句柄上」的 stage。

**两个失败的可观测判据（别再试了）：**

| 判据 | 为什么没有信号 |
| --- | --- |
| `document.querySelectorAll('canvas').length` | 每次抽卡都会整体重写 `#draw-content`，旧 canvas 是被这次 innerHTML 换掉的，跟 `dispose()` 有没有跑无关。**把 `dispose()` 注释掉，这个数照样是平的。** |
| 给每个 WebGL 上下文挂绘制调用计数器，数「还在发调用的上下文」 | A/B 实测（`dispose()` 注释掉 vs 恢复）**数字完全相同**。`renderer.dispose()` 释放的是 three.js 侧的纹理/几何/材质，**并不释放 GL 上下文**；而旧上下文停止绘制是因为脱离 DOM 后画布报 `0x0`、`resize()` 直接 bail。外部没有廉价判据能区分「已 dispose」和「没 dispose」。 |

### 后台删除与重建：两个「看不见」的不同步

后台列表渲染自 `players.json`，而首页 / 展厅 / 抽卡池读的是 `public/cards/manifest.json`。
两者只在**重建**时才碰面，所以任何漏掉重建的写入都会让后台显示的和公开页面不一致：

- **删除球员原先不触发重建。** 实测删完 `players.json` 22 人、manifest 仍 23 人——
  那张卡在公开页面上继续存在，直到有人按「重建全部」。现在删除会重建
  （只需重建一张：`build_cards.py` 每次运行都会用完整 `players.json` 重写 manifest，
  全量重建要多花一分钟、结果一样）。删掉最后一人时 `build_cards.py` 会以
  `no players matched` 拒绝运行，这条路由改为直接写空 manifest。
- **重建失败原先被报成成功。** 服务端对「元数据已写、卡面没重建出来」这种复合结果
  仍返回 HTTP 200（只有 `ok: false`），而 `api()` 只检查 `res.ok` → 页面照样提示「已重建」。
  实测触发方式：手改 `players.json` 把 `accent` 写成一个 `build_cards.py` 解析不了的值
  （后台 UI 里 `accent` 是 `<input type="color">`，走不出这条路径；`library_import.py`
  的 `NEW_PLAYERS` 表也全是合法值，所以只有手改库文件才会遇到）。
  现在 `api()` 单独检查 `ok === false`，并区分「元数据已保存，但重建失败」和「保存失败」。

另外两处顺手加固：`players.json` 改为**临时文件 + rename** 写入（`writeFileSync` 不原子，
写一半崩溃会让所有页面起不来）；所有由请求 id 拼出的路径都要先过 `SAFE_ID`（slug 白名单），
不依赖 URL 解析器自己的归一化行为。

- **上传失败会连原来的照片一起毁掉。** 路由原先先把新文件写成 `photo.<ext>`、顺手删掉其它扩展名的
  旧照片，**然后**才跑 `make_cutout.py`——而抠图正是会失败的那一步（不是图片 / 模型报错 / 内存不够）。
  实测上传一个纯文本文件：返回干净的 500「抠图失败」，但原本 450 KB 的照片已经变成 46 字节垃圾，
  而且 `cutout.png` 也被一起删了。`cards/library/` 不在 git 里，**这是不可恢复的**。
  现在改为：先写暂存文件（`photo.upload.<ext>` / `cutout.upload.png`，`find_photo()` 按精确名匹配所以
  不会被认错），抠图成功后才 `rename` 覆盖；失败就删掉暂存，原来的照片和抠图一个字节都不动。

`npm run test:admin` 守这一整组（21 条）。

顺带查过**并发**，实测没有竞态：① `PUT` 的读-改-写里确实夹着 `await`，但 Node 在每个事件回调之间
清空微任务队列，并发请求被天然串行化（5 个并发 PUT 全部落地）；② 3 个并发**全量**重建（99.7s）后
manifest 能解析、22 人齐全、所有 `front.webp` / `thumb.webp` 魔数与 `card.json` 都完好。
但①是事件循环的性质、不是这份代码的性质，所以门禁留了「并发保存不会互相覆盖」这条断言——
在 `readLibrary()` 和 `writeLibrary()` 之间插一个 `await` 它就会红。

### 滚动名单必须能暂停（WCAG 2.2.2）

首屏那条球员名 ticker 是 `animation: marquee 44s linear infinite`（22 人时约 107 秒一轮），
**自动开始、一直不停、与其它内容并行**——正好是 WCAG 2.2.2 描述的形状，而它是 **Level A**：
这类内容必须提供暂停机制。`prefers-reduced-motion` 只覆盖了主动设置了这个偏好的用户。

修法：ticker 右侧加了一个真实的暂停按钮（`aria-pressed` + 随状态变化的 `aria-label`），
切换 `.ticker.paused` 类让 `animation-play-state: paused` —— 暂停会停在当前位置而不是弹回开头。
遮罩从 `.ticker` 移到了新的 `.ticker-view` 上，否则右边缘的渐隐会把按钮一起淡掉。

`npm run test:a11y` 用**行为**判而不是读 `animation-play-state`：采样 `transform` 的位移量，
断言「默认在动 → 点了停下 → 再点又动」。「默认在动」这条是防过矫正——直接把动画关掉
也能让「点了停下」变绿。三种变异反向验证过（撤掉 paused 规则 → 红「点暂停后停止」；
去掉按钮 → 红「有暂停控件」；`animation: none` → 红「默认在动」和「再点又动」）。

### 无 WebGL 设备上的降级

`createHoloCard` 的第一件事是 `new THREE.WebGLRenderer(...)`，**没有 GPU / 关掉硬件加速 /
驱动进了浏览器黑名单时它会直接抛**。这些正是本项目要照顾的低端设备上的常态，而原先这个调用
落在 `mountHolo` 的 `try` **之外**，抛出的异常逃逸了：

- hero 区一片空白，**连静态兜底图都没有**
- hero 轮播永不启动
- `main.js` 把渲染器失败误判成素材缺失，报「加载失败 / 请先运行 npm run build:cards」

修法是把 `createHoloCard` 移进 `try`（`let inst = null` 提前声明，catch 里 `inst?.dispose()`）。
三个挂载点（hero / `openDetail` / `revealDraw`）走的是同一个 `mountHolo`，所以一处修好三处受益。

另外两个调用点拿到 `null` 实例后还会继续执行——它们**没有**给 `bindHoloControls` 加 `?.`，
靠的是函数内部 `if (!inst) { panel.hidden = true; return; }` 早退。实测三处都正确降级：

| 场景 | 结果 |
| --- | --- |
| hero | 静态卡面图（`.holo-fallback`，`naturalWidth > 0`），文案仍是球员名，22 个圆点齐全 |
| 详情弹窗 | 静态卡面图 + `#detail-controls` 隐藏，无 canvas |
| 抽卡揭晓 | 揭晓结构正常落地 + 静态卡面图 + `#draw-controls` 隐藏 |

**`test:holo` 的无 WebGL 段反向验证过两次，用两种不同的变异**——因为「全绿」本身不证明任何事：

| 变异 | 变红的断言 |
| --- | --- |
| `createHoloCard` 挪回 `try` 之外 | 3 条兜底/文案 + 详情兜底 + 抽卡兜底 + pageerror，共 5 条。**两条「控制面板」断言保持绿**（`openDetail` 在到达 `bindHoloControls` 之前就抛了，而面板在 markup 里本来就带 `hidden`）——它们对这个 bug 零信号 |
| 删掉 `holo-controls.js` 里的 `if (!inst)` 早退 | 恰好那两条「控制面板」变红（`controlsHidden=false`），外加 pageerror 捕获到后续的 `Cannot read properties of null (reading 'getParams')` |

**注**：无 WebGL 场景下 `console.error` 是**预期**的（three.js 会说明为什么建不出上下文，
`mountHolo` 也会记录它接住的失败），断言的是「页面降级到静态卡面」而不是「什么都不打日志」。

### 阵容完整性：失效球员 id 会让一个位置永久不可填

`loadLineup()` 把 `state.lineup` 直接从 localStorage 恢复，而**球员 id 是会离开卡池的**——
后台本来就是围绕「先加球员、再传图」设计的（`public/cards/test-star/` 就是那个流程的残留）。
用户在那位球员还在时把他排进首发，他就成了一个悬空 id。

三个读取方对它的判断**互相矛盾，而且全是静默的**：

| 读取方 | 行为 |
| --- | --- |
| `renderLineup()` | `playerById()` 返回 `undefined` → 该槽画成**空**，`filled` 被摘掉 |
| `positionsFor()` | `occupant` 是 `undefined` → `blocked: false` → 芯片**可选中** |
| `addPlayerAt()` | `if (state.lineup[pos])` 为**真** → 用 `playerById(...).name` 拼提示 → **TypeError** |

那个 throw 发生在委托点击处理器内部，所以下一行的 `closeDialog()` 不会执行、toast 也不会出现。
实测（修复前）：

```
board:  {"slotFilledClass":false,"slotHasPlayer":false}
picker: {"pos":"PG","blocked":false,"disabled":false}
click:  {"dialogStillOpen":true,"toasts":[],"lineup":"{\"PG\":\"ghost…\"}"}
error:  pageerror: Cannot read properties of undefined (reading 'name')
```

用户看到的是：位置是空的、芯片能点、点下去**什么都没发生**，而且从此再也填不进去。
同一时刻竞技场首页的计数器还会说 `1 / 5`，而进度条和五个槽位全画成空——同一个幽灵被报成三种样子。

**两处独立修复**，各自单独反向验证过：

- `pruneLineup()`（在 `loadManifest()` 里调用）丢掉 roster 里不存在的 id 并写回存储，
  让**存储的状态与已经在画的状态一致**。manifest 未加载时是 no-op，否则空 roster 会清空用户阵容。
- `addPlayerAt()` 先查出 occupant 再判空，把悬空 id 当作**空位**（直接覆盖）而不是占用。
  单独验证方式：把 `pruneLineup()` 注释掉，点击依然成功、弹窗关闭、零 pageerror。

另外 `loadLineup()` 原来只判真假（`|| {}`），但 `JSON.parse` 返回字符串/数字/数组同样开心。
基本类型会让 `state.lineup[pos] = id` 直接抛（ES 模块永远是严格模式）；数组更安静——
赋值被接受，但 `JSON.stringify([])` 会丢掉非索引属性，于是**加入操作静默地永不落盘**。
现在改成判形状。`npm run test:lineup` 守这一整组，反向验证时 13 条里红 9 条。

### 赏卡面板失同步：文案说的是上一帧的状态

`bindHoloControls` 根据实例生成文案，但只在**自己的点击处理器**里重新同步。任何其他改状态的路径
——键盘 `f` / `r`、拖拽卡面、滚轮——都不会通知它，于是面板描述的是**上一帧**。实测（左边真实状态，右面板显示）：

| 操作 | 真实 | 面板说 | 后果 |
| --- | --- | --- | --- |
| 键盘 `f` | `flipped=true` | 「翻看背面」 | 文案与下一次点击的结果**正好相反** |
| 拖拽卡面 | `auto=false` | 「暂停赏卡」 | 点下去**开始**了它声称要暂停的旋转 |
| 滑杆改 foil 后按 `r` | `foil=0.62` | `0.10` | 滑杆显示一个卡面已经不是的值 |

修法是给渲染器加状态变更通知（`onChange`），面板订阅。**两条同步路径是故意的**：订阅管面板看不见的
变化，点击处理器里的显式调用管它自己的动作——否则通知链路一坏，**所有**文案一起失效（实测会红 3 条），
而且拖拽那条断言会因为「标签从没变成过『暂停赏卡』」而**级联绿**。

`setParam()` 故意**不**通知：唯一调用方就是面板自己的滑杆，它已经更新过读数了，而且拖拽滑杆时重写
`input.value` 会跟拖拽打架。

### 卡面不该把方向键从需要滚动的弹窗那里抢走

`onKey` 对四个方向键都调了 `preventDefault()`，而详情弹窗是个滚动容器——横屏时 1703px 内容压在 388px 里。
实测 A/B：焦点在弹窗内的按钮上时 ArrowDown 让弹窗滚动 `462 → 502`；焦点在卡面上时 `44 → 44`，**完全不动**。

**如实说明**：这不是硬陷阱。PageDown / Space / End 从来没被拦截（同样条件下分别滚到 339 / 339 / 1315），
所以键盘用户有别的路。问题是**方向键是键盘滚动的主键，却被静默接管了**。

修法是**只在没有祖先可滚动时才接管方向键**（`scrollableAncestor()`）。配套有一条防过矫正断言：
弹窗不溢出时方向键仍应转卡——因为偷懒的修法是直接删掉方向键处理。

**这条断言一开始是零信号的**，两次都被我自己的判据骗了：

| 判据 | 问题 |
| --- | --- |
| 「舞台像素变了」 | 删掉方向键处理后它照样**报绿**：`openDetail` 会播入场动画，卡面自己在动，像素本来就变 |
| 加「卡面静止」对照 | LeBron 是 MYTHIC，动态立绘开着时 `uTime` 持续推进，卡面**永远**静止不下来，对照组直接失效 |
| 关掉动态立绘 + 布尔比较 | 仍然零信号：WebGL 画布每帧重绘，连续两帧本来就不保证逐字节相同 |

最终判据是**差分比例**：解码两张截图，统计显著不同的像素占比。关掉动态立绘、卡面静止后
（`idleRatio = 0`）按三次方向键，`rotatedRatio = 0.5878`——58.8% 的像素变化；删掉处理后是 `0`。
阈值取 2%，有 30 倍余量。

`npm run test:controls` 守这一整组（10 条）。三种变异分别反向验证：删订阅 → 红 3 条且归因干净
（外部变更红、面板自己的操作绿）；删 `scrollableAncestor()` 守卫 → 精确红 1 条；删方向键处理 → 红防过矫正那条。

### 球员字段必须逐点转义：后台写入没有任何校验

球员字段全部可在后台编辑，而管理接口（`scripts/vite-admin-plugin.mjs`）**没有鉴权也没有校验**，
收到什么就 `writeFileSync` 什么。公开页面是用模板字符串直出的，没有框架兜底，
所以每个插值点都得自己转义。

扫描出来并修掉的几类 sink：

| 位置 | 问题 |
| --- | --- |
| `detail.js` `href="${p.sourceUrl}"` | **转义在这里不够**。`javascript:alert(1)` 不含任何会被转义的字符，且是合法 href → 必须配协议白名单 `safeUrl()` |
| `grid.js` `style="--accent:${p.accent}"` | 属性值里未转义，一个 `"` 就能闭合属性并开新的 |
| `grid.js` / `draw.js` `${p.teamShort}` `${positionText(p)}` `${p.rarity}` | 纯文本未转义，与紧邻的其它字段不一致 |
| `lineup.js` / `main.js` `url('${p.assets.thumb}')` | **`esc()` 在这里无效**——HTML 实体在 CSS 看到之前就解码了。用 `encodeURI()`（对这些 ASCII 路径是无操作） |

`npm run test:escaping` 守这一整组。两个容易做错的实现细节已写进脚本注释：
wrapper 在 `${` **之后**不在之前；判断要用**整个前缀**，因为 wrapper 的 `(` 正好落在字段名的下标上，
固定宽度窗口会把它切掉。反向验证：撤掉任意一处转义都能按文件+行报出（如 `<<< .teamShort`）。

**这次转义没有改变任何当前输出**——manifest 里所有 `accent` 已经是 `#rrggbb`、所有 `sourceUrl`
已经是 `https:`、资源路径全是 ASCII，所以 `esc()` / `encodeURI()` / `safeUrl()` 今天都是无操作。

## 无障碍

`npm run test:a11y` 在**运行时 DOM** 上判，不是扫静态 HTML——交互面大多由 JS 渲染
（抽卡结果面板、阵容选择器、后台编辑器、卡片网格），而 `aria-label` 恰恰最容易在这些地方漏掉。

修掉的四处：

| 问题 | 性质 | 修法 |
| --- | --- | --- |
| `#hero-holo` / `#detail-holo` / `#draw-holo` 可聚焦却无可访问名 | **WCAG 4.1.2（Level A）**。`render/holo.js` 给每个 stage 加 `tabIndex = 0`（它响应方向键、`f` 翻面、`r` 复位），屏幕阅读器落在上面什么也念不出来 | `cards/mount.js` 挂载时设 `role="group"` + `aria-label="${球员名} 球星卡"`。用 `group` 而不是 `img`：元素确实可交互，而 `img` 不允许交互 |
| 展厅页 `h1` 之后直接跳到 `h3` | WCAG 1.3.1 结构问题 | 卡片标题改 `h2`（该模板只被展厅页使用，首页层级本来就是 h1→h2→h3） |
| 后台页**没有任何标题元素**，「卡库管理」是包在品牌链接里的 `<strong>` | 屏幕阅读器无法按标题导航 | 加一个 `.sr-only` 的 `h1` |
| 两个 `<dialog>` 没有可访问名 | 只念「对话框」，不说什么内容 | `#card-dialog` 用 `aria-labelledby="detail-title"`（指向动态渲染的 `h2`）；`#draw-dialog` 用静态 `aria-label="抽取球星卡"`（它要覆盖卡包→蓄力→揭晓整条流程） |

**两个必须避开的坑：**

- **改了标题层级，绑在旧层级上的选择器会静默失效**——`pages.css` 里原本是 `.card-meta h3`，
  改成 `h2` 之后它就一条都不匹配了，不报错、不警告。已改为 `.card-meta :is(h2, h3)`，
  让层级变化不会悄悄把样式剥掉。这与 `var()` 引用未定义令牌是同一种失败形状。
- **`.sr-only` 放在 `styles/base.css` 里对后台页无效**：`admin.html` 只加载 `admin.css`。
  所以它定义在 `admin.css`（站点页面的标题都是真实可见的，不需要它）。

**审计脚本自身的误报也值得记一笔**：第一版只认 `label[for=id]`，于是后台表单的 9 个字段
全被报成「无可访问名」——而它们用的是 `<label><span>姓名</span><input></label>` 这种
**隐式包裹关联**，完全合法。可访问名的计算必须覆盖 `aria-label`、`aria-labelledby`、
包裹式 `<label>`、`label[for]`、`alt`、`title`、`placeholder`，否则门禁会一直喊狼来了。

反向验证过：四处修复**逐一撤回**都能让对应断言独立变红（5 项 FAIL，各自点名到具体元素）；
恢复后全绿。视觉也量过没变——卡片标题仍是 `900 20px/23px Barlow Condensed`、字距 `0.6px`、
`uppercase`、`margin 0`，隐藏 `h1` 是 `1x1` + `clip-path: inset(50%)` 不占位。


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

**扩员前先用 `npm run probe:commons -- <slug> ...` 探一下素材量。** 采集一位球员
要下载约 10 张候选并各跑一次 BiRefNet 推理，而 Commons 上有可用比赛照的球员
远少于想象——US 本土球员经常只有 0~3 张，反而有国家队/奥运履历的球员
（Gobert、Şengün、F. Wagner、Schröder）素材最多。

> **球队数据有时效。** 卡面的球队/球衣号按 **2026-09** 的名单核对过，但 NBA 名单
> 一季一变，下赛季多半又会有出入。要改的话直接在后台逐位球员编辑即可，
> 不用跑脚本。

或者直接打开 **卡库管理后台** 用界面完成：上传图片会自动抠图并只重建这一张卡。

## 卡库管理后台

本地开发模式下访问 **http://127.0.0.1:5173/admin.html**（展厅页脚也有「卡库管理 ↗」入口）。

- 逐位球员编辑：姓名、号码、球队、称号、稀有度、**卡面风格**、多选位置、主辅色、素材署名；
- 上传 / 拖拽替换该球员的图片 → 自动调用 rembg 抠图 → 自动重建该卡 → 即时预览；
- **切换卡面风格后点「保存并重建」**也会重建该卡，预览随即刷新，并显示当前风格与构建日志；
- 新增球员、删除球员、单卡重建、全部重建；操作期间有进度遮罩与状态提示，右侧列表会标明该球员当前风格。

> 后台依赖 `npm run dev` 注入的本地接口（`scripts/vite-admin-plugin.mjs`），
> 生产静态站中不可用，会给出提示。接口无鉴权，仅在本机开发时启用。

### 自己换图（推荐流程）

后台就是给你换图用的。准备一张**单人、比赛抓拍、人占画面比例大**的照片（竖构图更好），
然后在后台选球员 → 拖进预览框 → 「上传并重建」。抠图 + 重建大约 5–20 秒，预览会就地刷新。

抠图不理想时（背景杂物、多个人被带进来），换一张更干净的原图重传即可 —— 抠图质量
基本由**原图**决定，而不是由参数决定。

命令行等价操作（不想开浏览器时）：

```bash
cp my-photo.jpg cards/library/<id>/photo.jpg   # 覆盖原图
npm run cutouts -- --only <id> --force          # 重新抠图
npm run build:cards -- --only <id>              # 只重建这一张
```

### 后台报「缺少依赖」怎么办

后台调用的是本机的 Python。如果 `python` 不在你的依赖环境里，编辑会失败。
先跑诊断：

```bash
npm run doctor
```

它会打印**实际使用的解释器路径**、候选顺序，以及「重建卡面」和「上传换图」各自缺哪些包。
按提示装包，或指定解释器后重启 dev server：

```bash
# Windows
set CARD_ARENA_PYTHON=C:\path\to\python.exe
# macOS / Linux
export CARD_ARENA_PYTHON=/path/to/python
```

也可以直接问接口：`curl http://127.0.0.1:5173/api/doctor`。

> 两个检查是分开的：**重建卡面**只需要 Pillow / numpy / opencv / scipy；
> **上传换图**才额外需要 rembg / onnxruntime。所以即使没装 rembg，改名字、
> 换风格、改稀有度这些纯元数据编辑也照样能用。

## 卡面自由度（页面内实时调校）

详情弹窗与抽卡揭晓内置「光影调校」面板，沿用技能查看器的控制项：

- 四个滑杆：**镭射强度 / 主体缩放 / 主体深度 / 背景深度**（按该球员的风格参数初始化）；
- **翻看背面**（真实 3D 翻面，背面为程序生成的卡背）、**自动赏卡**、**复位**、**保存图片**（导出 PNG）；
- 交互：拖动旋转、滚轮缩放、方向键微调、`F` 翻面、`R` 复位。

滑杆改动只影响当前浏览，不写回球员库；要改这张卡的默认观感，请在后台改它的**风格**并保存。

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

- **展厅（独立页面 / 新标签页）**：首页只保留一个展厅入口，点「打开展厅 ↗」会在**新标签页**打开
  `gallery.html`，里面是完整的球星卡墙，支持按位置、球队、卡面风格三重筛选；在展厅里直接选位置加入首发，
  回到竞技场标签页会自动同步阵容。
- **实时镭射卡面**：详情弹窗、首页主卡、抽卡揭晓由 `src/render/holo.js` 实时渲染，复用技能的四层着色器。
- **抽卡**：按稀有度加权抽取、跳过已在首发的球员 → 撕包/蓄力光团/卡面揭晓 → 选择位置 → 确认加入（确认后自动关闭弹窗）→ 或「暂不加入」。规则见上面「抽卡规则」。
- **阵容**：五个位置各限一人；多位置球星自由选择；同一球员不可重复上阵；显示已上阵人数。
- **无评分**：不含球员评分/能力值，卡面展示球队、位置、编号与称号。
- **中文排版**：中文标题使用中文字体栈，行高与字距按中文调整。
- **多设备适配**：手机竖屏 / 横屏 / 平板都可正常浏览，见下节。

## 多设备适配

「手机上能不能用」不是靠看，是靠量的。`npm run shot:devices` 会在 5 档视口下
（375×667 / 393×852 / 412×915 / 768×1024 / 844×390 横屏）逐页测量并给出**根因元素**，
而不是只报「有元素越界」。第一次跑出来的 6 个问题：

| 设备 | 首页 | 抽卡弹窗 |
| --- | --- | --- |
| iPhone SE 375×667 | 横向溢出 +193px | 底部超出视口 151px；按钮右边界 408 > 375 |
| iPhone 14 Pro 393×852 | 溢出 +177px | 超出 165px；按钮 418 > 393 |
| Pixel 7 412×915 | 溢出 +158px | 超出 148px；按钮 427 > 412 |
| iPad mini 768×1024 | 无 ✓ | 需内部滚动，不超出 ✓ |
| 手机横屏 844×390 | 无 ✓ | 舞台 540px > 视口 390px ✗ |

补审时又发现一个更严重的：**卡片详情弹窗的「加入首发」按钮在 980px 及以下的每一档都点不到**
（含 iPad mini）。`.card-dialog` 是 `overflow: hidden`，而 `@media (max-width: 980px)`
把 `.detail-copy` 的 `max-height: 86vh` 置成了 `none` —— 单列之后文案列长到 769px，
被卡在视口高度的弹窗裁掉，按钮落在折叠线以下 800~1150px，且**没有任何可滚动的祖先**。
桌面端没事（双列 + `max-height: 86vh` + `overflow-y: auto`），所以一直没暴露。
修法是把滚动交给弹窗本身，整列一起滚：

```css
@media (max-width: 980px) {
  .card-dialog { overflow-x: hidden; overflow-y: auto; }
  .detail-copy { max-height: none; overflow: visible; }
}
```

根因只有三个，但每一个都是「为 9 人设计、后来涨到 22 人」或「拿固定像素当响应式」：

1. **`.hero-dots` 是 22 个不可收缩的单行圆点。** 22 × 14px + 21 × 6px 间隙 = 434px，
   比它所在的 `.hero-caption` 还宽，于是把「下一位」箭头顶到了视口外 190px。
   修法：`min-width: 0` 让 flex item 能收缩 + `flex-wrap` 给它退路，
   再加上 `.hero-caption` 加宽到 `min(460px, 88vw)`；手机上圆点缩到 10px，
   22 个刚好一行，再窄就自动折成两行（375 下折成 11 + 11，反而更整齐）。
   顺带修掉了桌面端一个一直存在的毛病：圆点行本来就溢出了卡片边框。
2. **`.draw-stage { min-height: 540px }` 是固定像素。** 任何矮于 574px 的屏幕，
   这个下限都会压过 `max-height: 94vh`，于是横屏手机上舞台 540px 挂在 390px 的视口里。
   改成 `min(540px, 88svh)`，揭晓内容改为在舞台内部滚动。
3. **`.hc-buttons button { min-width: 78px }`。** 四个按钮 336px 挤在 298px 的行里，
   再被舞台的 `overflow-x: hidden` 裁掉——最后一个按钮在手机上是**够不到**的。
   改成 `min-width: 0` + 允许换行，手机上排成 2×2。

另外两处只有真机才暴露的问题：

- **`body { overflow-x: hidden }` 会让移动端视口高度算错。** 在 body 上裁剪会把 body 变成
  滚动容器，移动端 Chromium 于是把布局视口撑到内容高度——375×667 实测
  `window.innerHeight = 1009`，而视觉视口是 667。所有 `vh` 和固定元素的 `margin: auto`
  都按错的盒子算，这正是抽卡弹窗掉到折叠线以下 151px 的原因。把 `overflow-x`
  移到 `html` 上（值会传播到视口），布局视口就恢复成 667，横向溢出照样被裁掉。
- **`.holo-stage { touch-action: none }` 会锁死整页滚动。** 卡面在手机上占了大半屏，
  手指落在卡上就滚不动页面。改成 `pan-y`：竖向滑动滚页面，横向滑动照样转卡面，
  鼠标操作完全不受影响。

刘海与 Home Indicator 用 `--safe-top / --safe-bottom / --safe-left / --safe-right`
四个令牌（`env(safe-area-inset-*, 0px)`）统一处理，无刘海设备上全部解析成 0，规则等于不存在；
三个 HTML 的 viewport meta 都补上了 `viewport-fit=cover`。


## 素材管线

```
scripts/source_players.py   # 从 Wikimedia Commons 检索候选比赛照，BiRefNet 试抠后按「海报感」打分选优
scripts/make_cutout.py      # 单张照片 → BiRefNet 抠图
scripts/make_cutouts.py     # 批量抠图（--force / --only / --model）
scripts/library_import.py   # 把选中的素材导入球员库并抓取 Commons 署名
scripts/build_cards.py      # 依据球员库 + 风格生成四层素材、静态卡面与 manifest
scripts/card_styles.py      # 五套卡面风格定义
scripts/pick_from_raw.py    # 自动打分被角落卡住时，从原始候选池人工覆盖某球员的抠图+原图
scripts/contact_sheet.py    # 生成「成品卡面 | 抠图 | 背景」三联对照表，便于一次性复核全员
scripts/retier.py           # 按 TIERS 表整体重排球员稀有度（双向校验后写回 players.json）
scripts/probe_commons.py    # 先探候选球员在 Commons 上有多少可用照片，避免白跑抠图
scripts/doctor.mjs          # 诊断 Python 解释器与依赖分组是否就绪
scripts/_pw.cjs             # 回归脚本共用的 playwright-core / Chromium 解析
scripts/draw-stats.cjs      # 抽卡分布与「不重复」统计验证
scripts/draw-anim.cjs       # 逐档抽卡截图（蓄力 + 揭晓）
scripts/shot-pages.cjs      # 四页截图 + 零 404 / 零 console error 断言
scripts/shot-admin.cjs      # 后台 [hidden] 与编辑器回归
scripts/shot-devices.cjs    # 5 档设备 × 3 页面的布局审计（溢出根因 / 弹窗高度 / 按钮边界）
scripts/test-exports.cjs    # 断言 core.js 这个 re-export 桶的导出面没变
```

## 源码结构

`src/` 按职责分层。`core.js` 曾经是 670 行的「上帝模块」，同时管着 DOM 工具、
阵容规则、着色器挂载、抽卡编排和弹窗路由——改一处得跨过六件不相干的事。现在拆成：

```
src/
├── core.js                 # 纯 re-export 桶：保留它，是为了让页面与回归脚本的 import 一个字都不用改
├── lib/
│   ├── dom.js              # $ / $$ / esc / toast
│   └── motion.js           # prefersReducedMotion（GSAP、CSS 媒体查询、着色器时钟共用一个判据）
├── data/
│   ├── rarity.js           # RARITY_ORDER / RARITY_WEIGHT / RARITY_GLOW / rarityOf / glowOf
│   ├── slots.js            # SLOTS / POSITION_ZH
│   └── store.js            # state + localStorage 阵容 + manifest 载入 + 筛选
├── render/
│   └── holo.js             # WebGL 着色器渲染器（只管画，不碰 DOM 契约）
├── cards/
│   ├── mount.js            # mountHolo / unmountHolo：持有 DOM 契约（__holo 句柄 / is-ready / 静态图兜底）
│   ├── grid.js             # 卡面 HTML 与指针倾斜
│   ├── lineup.js           # 首发五人的唯一规则执行点（addPlayerAt）
│   ├── holo-controls.js    # 赏卡面板（滑杆 + 翻面 / 自动 / 动态立绘 / 复位 / 保存）
│   └── detail.js           # 详情弹窗
├── draw/
│   └── draw.js             # 加权抽取 + GSAP 四拍时间轴 + 彩带 + 揭晓
├── dialogs.js              # 弹窗生命周期 + 委托点击路由
└── styles/                 # style.css 只留 @import，实际样式分层
    ├── tokens.css          # 设计令牌（含 env(safe-area-inset-*) 安全区）
    ├── base.css            # 文档 / 环境光 / 排版 / 按钮
    ├── components.css      # 顶栏 / hero / ticker / 展厅入口 / 球场阵容 / holo 舞台
    ├── dialogs.css         # 弹窗外壳 / 详情 / 位置选择器 / 赏卡面板
    ├── draw.css            # 撕包→蓄力→爆闪→揭晓 与全部 keyframes
    ├── chrome.css          # toast 与 footer
    ├── pages.css           # 展厅页
    └── responsive.css      # 断点（**永远最后**，保证媒体查询压得住默认规则）
```

CSS 的拆分是**机械切分**，不是重写：按段落边界切开后按原顺序拼回，
与拆分前的文件逐字节相同（拆的时候就是这么验的）。`@import` 顺序是有意义的，
Vite 构建时会把它们内联回一个文件，产物与拆分前一致。

**为什么不引框架**（当时评估过 React / Vue）：最值钱的三块——Three.js 渲染循环 +
483 行自定义着色器、GSAP 时间轴、`<dialog>` 内的 confetti canvas——全是命令式的，
框架化只能靠 `ref` + `useEffect` 开逃生舱；全部业务逻辑约 1000 行、状态就是一个数组
加一个五槽对象，框架的收益不成立；而实测出的 6 个布局问题没有一个会因为换框架而消失。

`source_players.py` 的打分目标是**海报构图**而不是「抠得干净」：它奖励
单一主体、主体占画面比例大、身高比接近 1.1–2.1 的七分身/半身构图，
重罚把观众/对手一起抠进来、以及人在远处的小全景。`--publish` 会把胜出的
抠图和原图直接写回 `cards/library/<id>/`。

自动打分不是万能的，**有三种死角**需要人工接管：

| 死角 | 表现 | 处理 |
| --- | --- | --- |
| 同名陌生人 | Wikimedia 上有同名球员时，按"图片最多的分类"消歧可能选错人（Devin Booker 1991/1996、LeBron / Bronny） | `source_players.py` 里 `CATEGORY` / `EXCLUDE` 表显式 pin |
| 并排 / 错位多人 | 抠图模型把人融成一个连通块，原来的"连通块 + 第二大面积"检测失灵 | `top25` 信号（新加）；仍漏掉的用 `pick_from_raw` 手动覆盖 |
| 训练/定妆照被错选 | 自动打分偏好"高分辨率"导致选到媒体日训练照 | `DEMOTE` 词表降权 |

手动覆盖：

```bash
# 先看候选池（卡片库已有 cutout 还能选别的吗？）
ls cards/_work/raw/<slug>/
# 挑一张重抠 + 重写 photo.jpg
npm run pick:raw -- jayson-tatum 4 giannis-antetokounmpo 7
# 然后重建
npm run build:cards
```

全员复核：

```bash
npm run contact-sheet -- --cols 4 --out output/shots/contact-sheet.png
```

`build_cards.py` 为每位球员输出等尺寸图层（1024×1493）：`layers/subject.png`（真实 alpha）、
`layers/background.png`、`layers/lineart.png`（白底墨线）、`layers/text.png`（仅文字），
以及 `front.webp` / `thumb.webp`、`card.json` 与技能兼容的 `card-config.json`。
图层通过技能 `validate_assets.py` 的等价校验。

## 从 holo-card-studio 复用了什么

- **四层素材规范**与**校验规则**：沿用技能 `validate_assets.py`（本仓库按其规则校验，可直接用技能脚本复核）。
- **实时着色器**：`src/render/holo.js` 移植技能 `assets/web-holographic/app.js` 的 GLSL（视差 / 光谱 / 扫光 / 星尘）。
- **`atelier` 风格**：取自技能默认的墨蓝 + 古金视觉。
- **展厅元数据模式**：沿用技能 `references/gallery-distribution.md` 的「一卡一目录 + 元数据 + 生成清单 + 多维筛选」思路。
- **未复用** Blender 管线（`build_card.py` / `export_web.py`）：它们按技能自有中文对象名导出 GLB，
  逐卡跑 Blender 对二三十张卡的批量维护过重，因此网页端改为薄卡片网格 + 同一套着色器。
- **未复用** EffectComposer + UnrealBloom：它的 bloom 合成会在卡片之外的区域写入半透明黑，
  在页面背景上表现为卡片背后一块黑底，因此改为直出渲染 + canvas 上的 CSS 投影。

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
├── scripts/                  # 素材管线 + 后台接口插件 + 回归脚本
├── src/                      # 站点代码（core.js 桶 + lib/data/render/cards/draw + styles/ 分层样式）
├── output/shots/             # 回归脚本产出的截图（本地，不入库）
├── index.html                # 竞技场：主卡 + 阵容 + 展厅入口
├── gallery.html              # 球星卡展厅（新标签页打开）
├── admin.html                # 卡库管理后台
└── README.md
```

## 素材与权利声明（重要）

- 除 LeBron 外，全部球员照片来自 **Wikimedia Commons**，以 **CC BY 2.0 / CC BY-SA 4.0** 授权，
  已在 `public/cards/manifest.json` 的 `sourceUrl` / `sourceCredit` 逐张署名；原始照片不入库。
- LeBron 主体图来自 pngdownload.io（**CC BY-NC 4.0：署名、非商业**），原始文件不入库。
- 球员肖像权、NBA / 球队商标归各自权利人所有。本仓库仅作**技术演示与个人学习**，不得用于商业发行。
- 代码部分 MIT（见 LICENSE）。
