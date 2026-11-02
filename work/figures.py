#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成设计原理说明书的矢量图（SVG -> PDF -> 300dpi PNG）。

所有文字按 Noto CJK 字体实际字宽做自动换行与缩字号，保证图内文字不溢出。
"""

import subprocess
from pathlib import Path

from PIL import ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / "assets"
OUT.mkdir(parents=True, exist_ok=True)
CHROME = Path.home() / ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"

INK = "#1a1a1a"
MUTED = "#5f6368"
LINE = "#555555"
GRID = "#b6bcc4"
RED = "#8b1a1a"
BLUE = "#4a5568"
SERIF = '"Noto Serif CJK SC","Songti SC",serif'
SANS = '"Noto Sans CJK SC","PingFang SC",sans-serif'

FONT_FILES = {
    (SANS, "normal"): "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    (SANS, "bold"): "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    (SERIF, "normal"): "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    (SERIF, "bold"): "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
}
_CACHE = {}


def measure(s, size, family=SANS, weight="normal"):
    key = (family, weight, size)
    if key not in _CACHE:
        _CACHE[key] = ImageFont.truetype(FONT_FILES[(family, weight)], size)
    return _CACHE[key].getlength(s)


def wrap(s, size, width, family=SANS, weight="normal"):
    """按字宽换行；连续拉丁字母/数字作为整体，CJK 逐字断行。"""
    tokens, buf = [], ""
    for ch in s:
        if ch.isascii() and (ch.isalnum() or ch in ".,:;%/-−+()[]"):
            buf += ch
        else:
            if buf:
                tokens.append(buf)
                buf = ""
            tokens.append(ch)
    if buf:
        tokens.append(buf)
    lines, cur = [], ""
    for tok in tokens:
        cand = cur + tok
        if cur and measure(cand, size, family, weight) > width:
            lines.append(cur)
            cur = tok.lstrip()
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines


def fit(texts, max_w, max_h, size, family=SANS, weight="normal", min_size=15, gap=1.36):
    """为若干段落找最大可用字号；返回 (size, [lines...], line_height)。"""
    s = size
    while s >= min_size:
        lines = []
        for t in texts:
            if not t:
                continue
            lines.extend(wrap(t, s, max_w, family, weight) or [""])
        lh = s * gap
        if len(lines) * lh <= max_h:
            return s, lines, lh
        s -= 1
    return min_size, [wrap(t, min_size, max_w, family, weight)[0] for t in texts], min_size * gap


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size=30, fill=INK, family=SANS, anchor="start", weight="normal"):
    return (f'<text x="{x}" y="{y}" font-family={family} font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}" font-weight="{weight}">{esc(s)}</text>')


def box(x, y, w, h, fill="#ffffff", stroke=GRID, sw=2, rx=8):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="{sw}"/>')


def arrow(x1, y1, x2, y2, color=LINE, sw=3):
    return f'<path d="M{x1} {y1} L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{sw}" marker-end="url(#arrow)"/>'


def poly(points, color=LINE, sw=3):
    d = "M" + " L".join(f"{x} {y}" for x, y in points)
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" marker-end="url(#arrow)"/>'


def block(x, y, w, h, title, body, fill="#ffffff", stroke=GRID, sw=2,
          title_size=30, body_size=24, title_color=INK, body_color=MUTED, pad=18):
    """带标题的方框；文字自动换行并缩字号。"""
    out = [box(x, y, w, h, fill, stroke, sw)]
    inner_w = w - 2 * pad
    # 标题：超宽则缩字号
    if title:
        ts = title_size
        while measure(title, ts, SANS, "bold") > inner_w and ts > 18:
            ts -= 1
        out.append(text(x + pad, y + pad + ts * 0.86, title, ts, title_color, SANS, weight="600"))
        body_top = y + pad + ts + 14
    else:
        body_top = y + pad
    body_h = h - (body_top - y) - pad
    if body and body_h > 10:
        bs, lines, lh = fit(body, inner_w, body_h, body_size, SANS, gap=1.32)
        for i, line in enumerate(lines):
            out.append(text(x + pad, body_top + bs * 0.86 + i * lh, line, bs, body_color, SANS))
    return "\n".join(out)


def svg_page(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
            '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" '
            f'orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="{LINE}"/></marker></defs>\n'
            f'<rect width="{w}" height="{h}" fill="#ffffff"/>\n{body}\n</svg>\n')


# ---------------------------------------------------------------- 图 4-1 猜想地图
def conjecture_map():
    W, H = 1520, 1040
    b = []
    c1, w1 = 30, 300
    c2, w2 = 370, 380
    c3, w3 = 790, 320
    c4, w4 = 1150, 350
    for name, x in [("高层猜想", c1), ("设计要素（体现）", c2), ("中介过程（可观察）", c3), ("结果（可测量）", c4)]:
        b.append(text(x + 2, 44, name, 28, MUTED, weight="600"))

    b.append(block(c1, 283, w1, 330, "",
                   ["让学生自己产出证明，AI 在形式部分大方地教、在解题核心只按需给最小提示，以提高独立写证明的能力。"],
                   "#f2f4f7", BLUE, 2.6, title_size=1, body_size=26, pad=22))

    des = [
        ("工具", ["题目包、直观卡、数分键位", "闸门、归类器、事件流"]),
        ("任务结构", ["六层：定义→骨架→构造", "→自检→迁移→总结（可跳过）"]),
        ("参与结构", ["学生写，AI 提问", "教师审核题目包并在题后讲评"]),
        ("话语方式", ["一次只问一个问题；不说对错", "只说“衔接上了”或追问依据"]),
    ]
    dy = [110, 282, 454, 626]
    for (title, body), y in zip(des, dy):
        b.append(block(c2, y, w2, 150, title, body, "#ffffff", GRID, 2))

    med = [
        ("先写骨架再填中间", "证据：骨架通过率、写骨架用时"),
        ("每一行都写依据", "证据：依据填写率、被追问次数"),
        ("先尝试、后求助", "证据：首次求助前时长、连点次数"),
        ("用自己的话解释示范行", "证据：H4 后的依据文本、停留时长"),
    ]
    for (title, ev), y in zip(med, dy):
        b.append(block(c3, y, w3, 150, title, [ev], "#fbfbfb", "#8a8f98", 2, title_size=28, body_size=23))

    outs = [
        ("证明构造能力", ["后测与延迟后测", "教师按细则评分，20% 双评"]),
        ("证明理解", ["按 Mejía-Ramos 七维框架出题", "的理解测验"]),
        ("独立度", ["1 − 加权透露量 / 关键步骤数", "自主覆盖率"]),
    ]
    oy = [160, 400, 640]
    for (title, body), y in zip(outs, oy):
        b.append(block(c4, y, w4, 150, title, body, "#f7efec", RED, 2.4, title_size=29, body_size=23))

    b.append(arrow(c1 + w1, 480, c2 - 4, 480))
    b.append(text(c1 + w1 + 6, 462, "体现于", 23, MUTED))
    for y in dy:
        b.append(arrow(c2 + w2, y + 75, c3 - 4, y + 75))
    b.append(arrow(c3 + w3, 185, c4 - 4, 235))
    b.append(arrow(c3 + w3, 357, c4 - 4, 450))
    b.append(arrow(c3 + w3, 529, c4 - 4, 700))
    b.append(poly([(c3 + w3, 701), (1130, 701), (1130, 500), (c4 - 4, 500)]))

    b.append(f'<path d="M{c2} 880 H{c3 + w3}" stroke="{MUTED}" stroke-width="2" stroke-dasharray="4 6"/>')
    b.append(text(c2, 924, "设计猜想：设计要素 → 中介过程（试点期间可直接检验）", 25, INK, weight="600"))
    b.append(f'<path d="M{c3} 972 H{c4 + w4}" stroke="{RED}" stroke-width="2" stroke-dasharray="4 6"/>')
    b.append(text(c3, 1016, "理论猜想：中介过程 → 结果（需要后测数据检验）", 25, RED, weight="600"))
    return svg_page(W, H, "\n".join(b))


# ---------------------------------------------------------------- 图 7-1 交叉设计
def trial_design():
    W, H = 1520, 620
    b = [text(30, 44, "同一平台 · 同一批题 · 同等练习时间 · 班内按学生个体随机", 25, MUTED)]

    cols = [("前测", 190, 285), ("知识块 1（第 1–2 周）", 295, 785),
            ("知识块 2（第 3–4 周）", 795, 1285), ("后测", 1295, 1385), ("延迟后测", 1395, 1490)]
    for name, a, c in cols:
        b.append(box(a, 76, c - a, 48, "#f2f4f7", "#cfd4da", 2, rx=4))
        b.append(text((a + c) / 2, 108, name, 23, INK, SANS, "middle", "600"))

    rows = [("AB 组", 150, "A", "B"), ("BA 组", 352, "B", "A")]
    for name, y, c1, c2 in rows:
        b.append(text(30, y + 78, name, 27, INK, SANS, weight="600"))
        b.append(text(30, y + 110, "随机分配", 21, MUTED, SANS))
        b.append(box(190, y, 95, 170, "#ffffff", GRID, 2))
        b.append(text(237, y + 97, "前测", 21, MUTED, SANS, "middle"))
        for label, a, c in [(c1, 295, 785), (c2, 795, 1285)]:
            fill = "#f7efec" if label == "A" else "#f2f4f7"
            stroke = RED if label == "A" else "#7c8da6"
            b.append(box(a, y, c - a, 170, fill, stroke, 2.4))
            tag = "条件 A · 分步引导" if label == "A" else "条件 B · 主动对照"
            sub = "六层 + 提示阶梯（H0–H4）" if label == "A" else "提交后看教师参考证明"
            b.append(text(a + 24, y + 62, tag, 27, INK, SANS, weight="600"))
            b.append(text(a + 24, y + 104, sub, 23, MUTED, SANS))
        for a, c, label in [(1295, 1385, "后测"), (1395, 1490, "延迟")]:
            b.append(box(a, y, c - a, 170, "#ffffff", GRID, 2))
            if label == "延迟":
                b.append(text((a + c) / 2, y + 84, "延迟", 21, MUTED, SANS, "middle"))
                b.append(text((a + c) / 2, y + 112, "后测", 21, MUTED, SANS, "middle"))
            else:
                b.append(text((a + c) / 2, y + 97, label, 21, MUTED, SANS, "middle"))

    b.append(text(30, 562, "注：A 为分步引导，B 为提交后看教师参考证明（主动对照）。", 23, MUTED))
    b.append(text(30, 596, "同一学生先后经历两种条件，顺序随机。", 23, MUTED))
    return svg_page(W, H, "\n".join(b))


def render(name, svg, width_mm, height_mm):
    html = (f'<!doctype html><meta charset="utf-8"><style>@page{{size:{width_mm}mm {height_mm}mm;margin:0}}'
            f'html,body{{margin:0;padding:0;background:#fff}}svg{{display:block;width:{width_mm}mm;height:{height_mm}mm}}</style>'
            + svg)
    html_path = OUT / f"{name}.html"
    html_path.write_text(html, encoding="utf-8")
    pdf = OUT / f"{name}.pdf"
    subprocess.run([str(CHROME), "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
                    f"--user-data-dir={OUT/'chrome-profile'}", f"--print-to-pdf={pdf}",
                    "--no-pdf-header-footer", html_path.as_uri()],
                   check=True, capture_output=True)
    subprocess.run(["pdftoppm", "-r", "300", "-png", "-singlefile", str(pdf), str(OUT / name)], check=True)
    png = OUT / f"{name}.png"
    print(name, png, png.stat().st_size)


if __name__ == "__main__":
    render("fig4-1-conjecture", conjecture_map(), 152, 104)
    render("fig7-1-trial", trial_design(), 152, 62)
