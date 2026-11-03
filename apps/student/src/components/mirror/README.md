# components/mirror —— 教师镜像预览与回放组件（issue #43 · A 侧子集）

> 口径：04 §5（镜像预览 / 回放）、06 §6（mirror-token 与 SSE）、08 §2/§3（事件信封与目录）、02 §2（token/颜色）、11 §1（只读与权限）。
> 本轮只交付**可复用的组件与纯逻辑**，不接线页面、不依赖 C 的教师端接口。后续由教师端 #51 接入。

## 文件

| 文件 | 说明 |
|---|---|
| `mirror.ts` | 纯逻辑：URL/token 校验、日志脱敏、时间轴构建、时间格式化、clamp/seek/nextMarker、SSE 增量解析。无 Vue/DOM 依赖（`isMixedContent` 除外），全部有 vitest 单测。 |
| `mirrorDemo.ts` | 一段典型作答 mock 事件（打开 → L1 → L3 两行 → 求助 → 离开 30 秒 → 总结），供 story/演示/快照测试。 |
| `MirrorFrame.vue` | 只读 iframe 容器：安全属性、加载/错误/空态、混合内容拦截。 |
| `PlaybackSlider.vue` | 回放滑块：播放/暂停、拖动、事件标记、当前事件标签、键盘与 role=slider。 |

## `<MirrorFrame>`

```ts
props: {
  src?: string        // 完整镜像页 URL（buildMirrorUrl 生成，含 attempt/token）
  title?: string      // iframe title（a11y），默认「学生作答镜像」
  loading?: boolean   // 父级驱动：正在重新取 token / 等待首帧
  error?: string | null // 父级传入的人话错误（优先于内部状态）
}
emits: {
  load: []            // iframe 触发 load
  error: [message: string] // 装载失败（父级可 toast/重试）
}
```

安全约定：

- 只渲染通过 `isMirrorPageUrl` 校验的 `http(s)` 地址；拒绝 `javascript:`/`data:`、缺 attempt/token 的 URL。
- `sandbox="allow-scripts"`（常量 `MIRROR_IFRAME_SANDBOX`）：**不含 `allow-same-origin`**，不开放 `allow-forms`/`allow-popups`/`allow-top-navigation`。只读由镜像页自身实现（04 §5.1），**不要**通过放开 sandbox 换取功能。
- `referrerpolicy="no-referrer"`：防止 token 经 Referer 泄露；允许全屏（`allow="fullscreen"` + `allowfullscreen`）。
- **token 只出现在 iframe 的 src 查询参数里**（功能必需）；不在可见文本/错误文案/console 中出现。需要打日志时用 `sanitizeMirrorUrlForLog` / `redactMirrorToken`。
- 教师端 https 加载 http 镜像时浏览器会按混合内容拦截：组件在渲染前用 `isMixedContent` 拦截并给出人话提示。

### iframe 隔离（PR #100 评审结论：采用方案 b）

- **问题**：镜像页是学生 H5 的同源页面。iframe 同源且同时拥有 `allow-scripts` + `allow-same-origin` 时，嵌入页可以直接移除自己的 sandbox 并重载，等于完全跳出沙箱（WHATWG HTML 规范与 MDN 均明确警告）；学生可控内容（文本、KaTeX、批注）里注入的脚本会以教师控制台的同源身份行动（教师会话 Cookie / 接口权限）。
- **定案**：去掉 `allow-same-origin`，只保留 `allow-scripts`；`MirrorFrame` 的 sandbox 统一取 `MIRROR_IFRAME_SANDBOX`（`mirror.ts`），并用 `isSafeMirrorSandbox` 守卫/单测断言禁止 token 列表。
- **数据通路约束**：镜像页**不得**由 iframe 直接打开学生端同源页面并自行读同源接口/存储；必须使用 04 §5.1 的 mirrorToken 经 B 提供的 CORS/令牌接口取数据，SSE（`event: state` / `ping`）使用同一令牌（06 §6）。在 B/A/C 定稿这组接口前，C #51 **不得接线**本组件。
- 攻击面提示：任何后续给 sandbox 加白名单（如表单、下载）都必须先过 B/A/C 安全评审；`allow-same-origin` 永远不允许出现在镜像 iframe 上。

## `<PlaybackSlider>`

```ts
props: {
  timeline?: MirrorTimeline   // buildTimeline(events) 的结果 { durationMs, markers }
  modelValue?: number         // 当前回放时间（毫秒，v-model）
  playing?: boolean           // 播放状态（v-model:playing；不绑定则组件内部维护）
  disabled?: boolean
}
emits: {
  'update:modelValue': [ms: number]
  'update:playing': [playing: boolean]
  seek: [ms: number]          // 用户拖动/键盘定位（驱动 replay(events, uptoSeq)）
}
```

- 标记颜色按 `markerTone(type)`：layer/nav/lesson/recog=accent，提交=ok，提示/离开=hint，批注=margin，其它=muted。
- a11y：`role="slider"` + `aria-valuemin/max/now/valuetext`；←/→ 步进（约 1% 时长、最少 1 秒）、空格/Enter 播放暂停、Home/End 两端；轨道热区 44px。
- 播放用 `requestAnimationFrame`，暂停/卸载/父级 `playing=false` 时清理；播放中 `update:modelValue` 约 5 次/秒节流。
- 本轮不含 1×/4×/16× 倍速 UI（04 §5.2）：需要时由 C 在接入时加，或按 `speed` 扩展。

## 后续接线点（C / B）

1. **前置条件（PR #100 定案）**：B 提供 mirrorToken 签发 + 镜像页数据/SSE 的 CORS 令牌接口，A/B/C 确认方案 b 后才可接线；C #51 在此之前不得引用本组件。
2. 教师端 #51 学生详情抽屉：`const token = await POST /teacher/attempts/{id}/mirror-token`；`const src = buildMirrorUrl(studentH5Base, attemptId, token.token)`；`<MirrorFrame :src="src" :loading="loading" :error="error" @load @error />`（镜像页内用 token 调 B 的 CORS/SSE 接口取数，不依赖同源）。
3. 打开/关闭镜像写 `t.mirror` 事件（04 §5.1 / 08 §3：payload `attemptId`, `action=open|close`）——由教师端上报，不在本组件内。
4. 回放：事件来自 `GET /teacher/attempts/{id}/events?afterSeq=`（06 §6）；`const timeline = buildTimeline(events)`；`<PlaybackSlider v-model="at" v-model:playing="playing" :timeline="timeline" @seek="rebuild" />`；`rebuild` 调 B 侧 `packages/engine` 的 `replay(events, uptoSeq)`（08 §6）后把 `AttemptState` 灌给镜像页。
5. 镜像实时推送：`GET /teacher/attempts/{id}/stream?token=…`，`event: state`（data=AttemptState）、`ping`；解析可用 `parseSseFrames` + `parseSseData`（帧解析已单测）。
6. P2 实时笔迹（每秒增量笔画）不在本组件范围（04 §5.1）。

本轮不修改 contracts；需要 B 提供 mirrorToken 签发 + 镜像页 CORS/SSE 接口（#23/#51 相关）与事件来源（#32/#51）。**在这些接口与隔离方案 A/B/C 定稿前，C #51 不接线。**
