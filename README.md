# dsh-zzz-skin · 绝区零 H.D.D. 风格皮肤

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的皮肤插件。

深海蓝底、巨大的螺旋眼眸、青光扫描线、四角 HUD 边框；界面品牌改为 **Fairy**，
启动时有开屏动画和按时间段变化的问候语音。

> 配套的人格插件：[dsh-fairy](https://github.com/shentongzy/dsh-fairy)

## 效果

- 背景：正交网格 + 左下角雾状辉光 + 缓慢下扫的示波器光带
- 徽记：三层螺旋眼眸，随侧栏宽度缩放，窄窗口自动隐藏
- 品牌：左上角 wordmark 换成徽记 + `Fairy`，窗口标题同步
- 开屏：13 秒视频 → 蓝光收束 → 大眼睛居中 → 按当前时段说一句 → 归位
- 空会话：`HOLLOW DEEP DIVE SYSTEM` 主视觉，眼睛浮在标题上方

## 安装

### 方式一：手动放文件

1. 点右上角绿色 **Code** → **Download ZIP**，解压
2. 文件夹改名为 `dsh-zzz-skin`（去掉 `-main`）
3. 复制到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\`
4. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，末尾追加：

```yaml
- insert:
    - id: dsh-zzz-skin
      name: "dsh-zzz-skin"
```

5. 完全退出并重启 DeepSeek Harness

> ⚠️ 必须是 `- insert:` 列表形式。直接写 `- id: xxx` 会被当成覆盖已有行，插件不会加载。

### 方式二：命令行

```powershell
cd %USERPROFILE%\.dsh\profiles\desktop\node_modules
git clone https://github.com/shentongzy/dsh-zzz-skin.git
```

然后同样在第 4 步加 `insert` 条目。

## 使用

```
/hdd on        开启
/hdd off       关闭
/hdd status    查看状态
```

`/skin` 是旧名，等效。

## 开屏语音

`assets/voice/` 里是按时间段命名的片段：

| 时段 | 文件名 | 时间 |
|---|---|---|
| 早上 | `morning-0/1/2.wav` | 5:00–11:00 |
| 中午 | `noon-0/1/2.wav` | 11:00–14:00 |
| 下午 | `afternoon-0/1/2.wav` | 14:00–18:00 |
| 晚上 | `evening-0/1/2.wav` | 18:00–23:00 |
| 深夜 | `night-0/1/2.wav` | 23:00–5:00 |

启动时从**当前时段实际存在的文件**里随机挑一句播放。缺哪个就静音哪个，不会报错。

想换成自己的声音：放同名 wav 进去即可，不用改代码。

## 自定义外观

外观参数在 `lib/skin.css` 里，改完刷新页面即可生效（CSS 每 2 秒热更新）。

- 网格间距/颜色：`.fairy-grid` 的 `background-image`
- 扫线速度：`animation: fairy-beam 24s`
- 徽记尺寸：`lib/client.js` 里的 `REF = 280`
- 输入框透明度：`rgba(38, 52, 72, 0.82)` 那个规则

## 已知限制

- 右上角的窗口按钮（最小化/关闭）是 Electron 原生层，CSS 盖不住，开屏时会出现在视频上
- 开屏只在启动时播一次，刷新页面不会重播

## 授权

代码 MIT。`assets/` 下的同人素材和语音**禁止商用**，详见 [NOTICE.md](NOTICE.md)。
