// 学生端启动垫片：放外部文件是为了 CSP 能去掉 script-src 'unsafe-inline'（05 §7 禁止内联脚本）。
;(function () {
  // 镜像预览 iframe 是 sandbox="allow-scripts"（opaque origin，04 §5）：访问 localStorage/sessionStorage 会抛
  // SecurityError，uni-app 启动即崩、页面白屏。仅在抛错时换成内存实现；普通页面不受影响。
  ;['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      window[name]
    } catch (e) {
      var m = {}
      Object.defineProperty(window, name, {
        configurable: true,
        value: {
          getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null },
          setItem: function (k, v) { m[k] = String(v) },
          removeItem: function (k) { delete m[k] },
          clear: function () { m = {} },
          key: function (i) { return Object.keys(m)[i] || null },
          get length() { return Object.keys(m).length },
        },
      })
    }
  })

  // 首屏前恢复外观选择，避免闪一下错误的主题（key 与 composables/useTheme.ts 一致）。
  try {
    var theme = window.localStorage.getItem('pg.theme')
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme)
  } catch (e) {
    /* 隐私模式：跟随系统 */
  }

  // 允许缩放（不写 user-scalable=no —— 见 02 §6）；输入框用 16px 防 iOS 聚焦缩放。
  var coverSupport = 'CSS' in window && typeof CSS.supports === 'function' &&
    (CSS.supports('top: env(a)') || CSS.supports('top: constant(a)'))
  document.write(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0' +
    (coverSupport ? ', viewport-fit=cover' : '') + '" />')
})()
