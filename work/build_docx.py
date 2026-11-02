#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成《证明陪练场设计原理》Word 报告（A4，中文学术版式）。

用法：
    python build_docx.py                 # 两遍排版：先出 PDF 取页码，再回填目录
    python build_docx.py --once          # 只出一遍（目录页码用占位）
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
DOC_DIR = PROJECT / "证明陪练场_产品设计工作区" / "09-设计原理说明书"
ASSETS = ROOT / "assets"
CONTENT = ROOT / "content.md"
STEM = "证明陪练场_设计原理说明_v3.0"

# ---------------------------------------------------------------- 版式常量
PAGE_W, PAGE_H = 21.0, 29.7          # A4，cm
MARGIN_TOP, MARGIN_BOTTOM = 2.54, 2.54
MARGIN_LEFT, MARGIN_RIGHT = 3.0, 2.54
TEXT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT   # 15.46cm

SONG = "宋体"
HEI = "黑体"
KAI = "楷体"
LATIN = "Times New Roman"
LATIN_HEAD = "Arial"
MONO = "Consolas"

INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x5F, 0x63, 0x68)
LIGHT = RGBColor(0x80, 0x80, 0x80)
RED = RGBColor(0x8B, 0x1A, 0x1A)
ACCENT = RGBColor(0x1F, 0x38, 0x64)

BODY_PT = 12          # 小四
TABLE_PT = 9.5        # 小五偏大
CAP_PT = 10.5         # 图题/表题 五号
LINE = 1.5


# ---------------------------------------------------------------- 基础工具
def set_run(run, size=BODY_PT, east=SONG, latin=LATIN, bold=False, italic=False,
            color=INK, underline=False):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.underline = underline
    run.font.color.rgb = color
    run.font.name = latin
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    rFonts.set(qn("w:ascii"), latin)
    rFonts.set(qn("w:hAnsi"), latin)
    rFonts.set(qn("w:eastAsia"), east)
    rFonts.set(qn("w:cs"), latin)


def style_rfonts(style, east, latin):
    rPr = style.element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    rFonts.set(qn("w:ascii"), latin)
    rFonts.set(qn("w:hAnsi"), latin)
    rFonts.set(qn("w:eastAsia"), east)


AFTER_IND = ("w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
             "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl",
             "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange")


def first_line_chars(paragraph, chars=2, font_pt=BODY_PT):
    pPr = paragraph._p.get_or_add_pPr()
    ind = pPr.find(qn("w:ind"))
    if ind is None:
        ind = OxmlElement("w:ind")
        pPr.insert_element_before(ind, *AFTER_IND)
    ind.set(qn("w:firstLine"), str(int(chars * font_pt * 20)))
    ind.set(qn("w:firstLineChars"), str(int(chars * 100)))


def no_indent(paragraph):
    pPr = paragraph._p.get_or_add_pPr()
    ind = pPr.find(qn("w:ind"))
    if ind is None:
        ind = OxmlElement("w:ind")
        pPr.insert_element_before(ind, *AFTER_IND)
    ind.set(qn("w:firstLine"), "0")
    ind.set(qn("w:firstLineChars"), "0")


def hang_indent(paragraph, cm=0.8):
    pPr = paragraph._p.get_or_add_pPr()
    ind = pPr.find(qn("w:ind"))
    if ind is None:
        ind = OxmlElement("w:ind")
        pPr.insert_element_before(ind, *AFTER_IND)
    ind.set(qn("w:left"), str(int(cm * 567)))
    ind.set(qn("w:hanging"), str(int(cm * 567)))


AFTER_SHD_P = ("w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap", "w:overflowPunct",
               "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN", "w:bidi", "w:adjustRightInd",
               "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing", "w:mirrorIndents",
               "w:suppressOverlap", "w:jc", "w:textDirection", "w:textAlignment",
               "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr",
               "w:sectPr", "w:pPrChange")


def shade(paragraph, color="F5F5F5"):
    pPr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color)
    pPr.insert_element_before(shd, *AFTER_SHD_P)


AFTER_PBDR = ("w:shd",) + AFTER_SHD_P


def para_border(paragraph, color="8B1A1A", sz=24, side="left"):
    pPr = paragraph._p.get_or_add_pPr()
    pBdr = pPr.find(qn("w:pBdr"))
    if pBdr is None:
        pBdr = OxmlElement("w:pBdr")
        pPr.insert_element_before(pBdr, *AFTER_PBDR)
    b = OxmlElement(f"w:{side}")
    b.set(qn("w:val"), "single")
    b.set(qn("w:sz"), str(sz))
    b.set(qn("w:space"), "8")
    b.set(qn("w:color"), color)
    pBdr.append(b)


def add_field(paragraph, instr, placeholder="1"):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr_el = OxmlElement("w:instrText")
    instr_el.set(qn("xml:space"), "preserve")
    instr_el.text = f" {instr} "
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    t = OxmlElement("w:t")
    t.text = placeholder
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr_el)
    run._r.append(fld_sep)
    run._r.append(t)
    run._r.append(fld_end)
    return run


_BM_ID = [1000]


def add_bookmark(paragraph, name):
    _BM_ID[0] += 1
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), str(_BM_ID[0]))
    start.set(qn("w:name"), name)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), str(_BM_ID[0]))
    pPr = paragraph._p.pPr
    if pPr is not None:
        pPr.addnext(start)
    else:
        paragraph._p.insert(0, start)
    paragraph._p.append(end)


def add_internal_link(paragraph, anchor, text, size, east=SONG, bold=False):
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("w:anchor"), anchor)
    run = OxmlElement("w:r")
    rPr = OxmlElement("w:rPr")
    rFonts = OxmlElement("w:rFonts")
    rFonts.set(qn("w:ascii"), LATIN)
    rFonts.set(qn("w:hAnsi"), LATIN)
    rFonts.set(qn("w:eastAsia"), east)
    rPr.append(rFonts)
    if bold:
        rPr.append(OxmlElement("w:b"))
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), str(int(size * 2)))
    rPr.append(sz)
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "1A1A1A")
    rPr.append(color)
    run.append(rPr)
    t = OxmlElement("w:t")
    t.set(qn("xml:space"), "preserve")
    t.text = text
    run.append(t)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)


AFTER_TCBORDERS = ("w:shd", "w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign",
                   "w:hideMark", "w:headers", "w:cellIns", "w:cellDel", "w:cellMerge", "w:tcPrChange")


def cell_border(cell, side, sz=8, color="000000", val="single"):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = tcPr.find(qn("w:tcBorders"))
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tcPr.insert_element_before(borders, *AFTER_TCBORDERS)
    el = OxmlElement(f"w:{side}")
    el.set(qn("w:val"), val)
    el.set(qn("w:sz"), str(sz))
    el.set(qn("w:space"), "0")
    el.set(qn("w:color"), color)
    borders.append(el)


def set_cell_margins(table, top=40, bottom=40, left=100, right=100):
    tblPr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for side, val in [("top", top), ("left", left), ("bottom", bottom), ("right", right)]:
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tblPr.append(mar)


def page_break(doc):
    from docx.enum.text import WD_BREAK
    p = doc.add_paragraph()
    p.add_run().add_break(WD_BREAK.PAGE)


def set_pgnum(section, fmt="decimal", start=1):
    sectPr = section._sectPr
    for old in sectPr.findall(qn("w:pgNumType")):
        sectPr.remove(old)
    el = OxmlElement("w:pgNumType")
    el.set(qn("w:fmt"), fmt)
    el.set(qn("w:start"), str(start))
    anchor = None
    for tag in ("w:cols", "w:formProt", "w:vAlign", "w:noEndnote", "w:titlePg",
                "w:textDirection", "w:bidi", "w:rtlGutter", "w:docGrid", "w:printerSettings", "w:sectPrChange"):
        found = sectPr.find(qn(tag))
        if found is not None:
            anchor = found
            break
    if anchor is not None:
        anchor.addprevious(el)
    else:
        sectPr.append(el)


# ---------------------------------------------------------------- 内容解析
def parse_inline(text):
    """返回 [(text, bold, italic, code)]。"""
    parts = []
    pattern = re.compile(r"(\*\*.+?\*\*|`.+?`|\*[^*]+?\*)")
    for token in pattern.split(text):
        if not token:
            continue
        if token.startswith("**") and token.endswith("**"):
            parts.append((token[2:-2], True, False, False))
        elif token.startswith("`") and token.endswith("`"):
            parts.append((token[1:-1], False, False, True))
        elif token.startswith("*") and token.endswith("*") and len(token) > 2:
            parts.append((token[1:-1], False, True, False))
        else:
            parts.append((token, False, False, False))
    return parts


def add_inline(paragraph, text, size=BODY_PT, east=SONG, color=INK):
    for chunk, bold, italic, code in parse_inline(text):
        run = paragraph.add_run(chunk)
        if code:
            set_run(run, size=size - 0.5, east=MONO, latin=MONO, color=RGBColor(0x33, 0x33, 0x33))
        else:
            set_run(run, size=size, east=east, bold=bold, italic=italic, color=color)


class Content:
    def __init__(self, paths):
        lines = []
        for path in paths:
            lines.extend(path.read_text(encoding="utf-8").splitlines())
            lines.append("")
        self.lines = lines
        self.tokens = []
        self.headings = []      # (level, number, title, anchor)
        self._parse()

    def _parse(self):
        lines = self.lines
        i, n = 0, len(lines)
        while i < n:
            raw = lines[i].rstrip()
            s = raw.strip()
            if not s:
                i += 1
                continue
            if s.startswith(":::h1 ") or s.startswith(":::h2 ") or s.startswith(":::h3 "):
                level = int(s[4])
                body = s.split(" ", 1)[1]
                num, title = [x.strip() for x in body.split("|", 1)]
                anchor = f"_Toc{len(self.headings) + 1:04d}"
                self.headings.append((level, num, title, anchor))
                self.tokens.append(("h", level, num, title, anchor))
                i += 1
            elif s.startswith(":::p "):
                self.tokens.append(("p", s[5:]))
                i += 1
            elif s.startswith(":::p-en "):
                self.tokens.append(("p-en", s[8:]))
                i += 1
            elif s.startswith(":::front "):
                self.tokens.append(("front", s[9:]))
                i += 1
            elif s.startswith(":::meta "):
                self.tokens.append(("meta", s[8:]))
                i += 1
            elif s.startswith(":::kw "):
                self.tokens.append(("kw", s[6:]))
                i += 1
            elif s.startswith(":::kw-en "):
                self.tokens.append(("kw-en", s[9:]))
                i += 1
            elif s.startswith(":::sub "):
                self.tokens.append(("sub", s[7:]))
                i += 1
            elif s.startswith(":::note "):
                self.tokens.append(("note", s[7:]))
                i += 1
            elif s.startswith(":::callout "):
                body = s[11:]
                label, text = [x.strip() for x in body.split("|", 1)]
                self.tokens.append(("callout", label, text))
                i += 1
            elif s.startswith(":::table "):
                cfg = s[9:]
                parts = [x.strip() for x in cfg.split("|")]
                caption = parts[0]
                options = {}
                for part in parts[1:]:
                    if "=" in part:
                        k, v = part.split("=", 1)
                        options[k.strip()] = v.strip()
                i += 1
                rows = []
                while i < n and lines[i].strip().startswith("|"):
                    row = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                    if not all(re.fullmatch(r":?-{2,}:?", c) for c in row):
                        rows.append(row)
                    i += 1
                self.tokens.append(("table", caption, options, rows))
            elif s.startswith(":::figure "):
                cfg = s[10:]
                parts = [x.strip() for x in cfg.split("|")]
                caption = parts[0]
                options = {}
                for part in parts[1:]:
                    if "=" in part:
                        k, v = part.split("=", 1)
                        options[k.strip()] = v.strip()
                self.tokens.append(("figure", caption, options))
                i += 1
            elif s.startswith(":::ol") or s.startswith(":::ul"):
                kind = "ol" if s.startswith(":::ol") else "ul"
                i += 1
                items = []
                while i < n and lines[i].strip().startswith("- "):
                    items.append(lines[i].strip()[2:].strip())
                    i += 1
                self.tokens.append((kind, items))
            elif s.startswith(":::refs"):
                i += 1
                items = []
                while i < n and lines[i].strip().startswith("- "):
                    items.append(lines[i].strip()[2:].strip())
                    i += 1
                self.tokens.append(("refs", items))
            elif s.startswith(":::code"):
                inline = s[7:].strip()
                if inline:
                    self.tokens.append(("code", inline))
                    i += 1
                else:
                    i += 1
                    code = []
                    while i < n and not lines[i].strip().startswith(":::"):
                        code.append(lines[i])
                        i += 1
                    self.tokens.append(("code", "\n".join(code).strip()))
            elif s == ":::toc":
                self.tokens.append(("toc",))
                i += 1
            elif s == ":::newpage":
                self.tokens.append(("newpage",))
                i += 1
            elif s == ":::body-start":
                self.tokens.append(("body",))
                i += 1
            elif s.startswith(":::"):
                print("未识别指令:", s)
                i += 1
            else:
                # 普通段落：合并连续行
                buf = [s]
                i += 1
                while i < n and lines[i].strip() and not lines[i].strip().startswith(":::"):
                    buf.append(lines[i].strip())
                    i += 1
                self.tokens.append(("p", "".join(buf)))
        # 正文标题（h1/h2）供目录使用
        self.toc_headings = [(lv, num, title, anchor) for lv, num, title, anchor in self.headings if lv in (1, 2)]


# ---------------------------------------------------------------- 文档构建
def setup_styles(doc):
    st = doc.styles
    normal = st["Normal"]
    normal.font.name = LATIN
    normal.font.size = Pt(BODY_PT)
    normal.font.color.rgb = INK
    style_rfonts(normal, SONG, LATIN)
    pf = normal.paragraph_format
    pf.line_spacing = Pt(20)
    pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.alignment = WD_ALIGN_PARAGRAPH.LEFT

    specs = {
        "Heading 1": (16, HEI, 24, 12, True),
        "Heading 2": (14, HEI, 18, 6, True),
        "Heading 3": (12, HEI, 12, 6, True),
    }
    for name, (size, east, before, after, keep) in specs.items():
        s = st[name]
        s.font.name = LATIN
        s.font.size = Pt(size)
        s.font.bold = False
        s.font.color.rgb = INK
        style_rfonts(s, east, LATIN_HEAD)
        pf = s.paragraph_format
        pf.space_before = Pt(before)
        pf.space_after = Pt(after)
        pf.line_spacing = 1.3
        pf.keep_with_next = keep
        pf.alignment = WD_ALIGN_PARAGRAPH.LEFT

    for name, size, east, before, after in [
        ("FigureCaption", CAP_PT, HEI, 6, 12),
        ("TableCaption", CAP_PT, HEI, 12, 6),
    ]:
        s = st.add_style(name, 1)  # WD_STYLE_TYPE.PARAGRAPH
        s.font.name = LATIN
        s.font.size = Pt(size)
        s.font.color.rgb = INK
        style_rfonts(s, east, LATIN)
        pf = s.paragraph_format
        pf.space_before = Pt(before)
        pf.space_after = Pt(after)
        pf.line_spacing = 1.2
        pf.alignment = WD_ALIGN_PARAGRAPH.CENTER
        pf.keep_with_next = (name == "TableCaption")

    s = st.add_style("TableText", 1)
    s.font.name = LATIN
    s.font.size = Pt(TABLE_PT)
    s.font.color.rgb = INK
    style_rfonts(s, SONG, LATIN)
    pf = s.paragraph_format
    pf.line_spacing = 1.1
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.alignment = WD_ALIGN_PARAGRAPH.LEFT

    s = st.add_style("TableHead", 1)
    s.font.name = LATIN
    s.font.size = Pt(TABLE_PT)
    s.font.color.rgb = INK
    style_rfonts(s, HEI, LATIN)
    pf = s.paragraph_format
    pf.line_spacing = 1.1
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.alignment = WD_ALIGN_PARAGRAPH.CENTER

    s = st.add_style("TableNote", 1)
    s.font.name = LATIN
    s.font.size = Pt(9)
    s.font.color.rgb = MUTED
    style_rfonts(s, SONG, LATIN)
    pf = s.paragraph_format
    pf.line_spacing = 1.15
    pf.space_before = Pt(3)
    pf.space_after = Pt(12)
    pf.alignment = WD_ALIGN_PARAGRAPH.LEFT

    s = st.add_style("Reference", 1)
    s.font.name = LATIN
    s.font.size = Pt(9.5)
    s.font.color.rgb = INK
    style_rfonts(s, SONG, LATIN)
    pf = s.paragraph_format
    pf.line_spacing = 1.15
    pf.space_before = Pt(0)
    pf.space_after = Pt(3)
    pf.alignment = WD_ALIGN_PARAGRAPH.LEFT

    s = st.add_style("TOC 1", 1)
    s.font.name = LATIN
    s.font.size = Pt(11)
    s.font.color.rgb = INK
    style_rfonts(s, HEI, LATIN)
    pf = s.paragraph_format
    pf.line_spacing = 1.15
    pf.space_before = Pt(5)
    pf.space_after = Pt(0)
    pf.tab_stops.add_tab_stop(Cm(TEXT_W), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)

    s = st.add_style("TOC 2", 1)
    s.font.name = LATIN
    s.font.size = Pt(10.5)
    s.font.color.rgb = INK
    style_rfonts(s, SONG, LATIN)
    pf = s.paragraph_format
    pf.line_spacing = 1.1
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.left_indent = Cm(0.85)
    pf.tab_stops.add_tab_stop(Cm(TEXT_W), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)


def setup_section(section, header_text=None, footer=True, pgnum=None, first_page_diff=False):
    section.page_width = Cm(PAGE_W)
    section.page_height = Cm(PAGE_H)
    section.top_margin = Cm(MARGIN_TOP)
    section.bottom_margin = Cm(MARGIN_BOTTOM)
    section.left_margin = Cm(MARGIN_LEFT)
    section.right_margin = Cm(MARGIN_RIGHT)
    section.header_distance = Cm(1.5)
    section.footer_distance = Cm(1.75)
    if pgnum:
        set_pgnum(section, pgnum[0], pgnum[1])
    if header_text:
        header = section.header
        header.is_linked_to_previous = False
        base = header.paragraphs[0]
        base.text = ""
        tbl = header.add_table(rows=1, cols=2, width=Cm(TEXT_W))
        tbl.autofit = False
        tblPr = tbl._tbl.tblPr
        tblW = tblPr.find(qn("w:tblW"))
        if tblW is None:
            tblW = OxmlElement("w:tblW")
            tblPr.insert_element_before(tblW, "w:jc", "w:tblBorders", "w:tblLayout", "w:tblCellMar", "w:tblLook")
        tblW.set(qn("w:type"), "dxa")
        tblW.set(qn("w:w"), str(int(TEXT_W * 567)))
        borders = OxmlElement("w:tblBorders")
        for side, val, sz in [("top", "nil", 0), ("left", "nil", 0), ("right", "nil", 0),
                              ("insideH", "nil", 0), ("insideV", "nil", 0), ("bottom", "single", 6)]:
            el = OxmlElement(f"w:{side}")
            el.set(qn("w:val"), val)
            if val == "single":
                el.set(qn("w:sz"), str(sz))
                el.set(qn("w:space"), "0")
                el.set(qn("w:color"), "B6BCC4")
            borders.append(el)
        tblPr.insert_element_before(borders, "w:tblLayout", "w:tblCellMar", "w:tblLook")
        mar = OxmlElement("w:tblCellMar")
        for side in ("top", "left", "bottom", "right"):
            el = OxmlElement(f"w:{side}")
            el.set(qn("w:w"), "0")
            el.set(qn("w:type"), "dxa")
            mar.append(el)
        tblPr.insert_element_before(mar, "w:tblLook")
        tbl.columns[0].width = Cm(TEXT_W - 1.6)
        tbl.columns[1].width = Cm(1.6)
        c0, c1 = tbl.cell(0, 0), tbl.cell(0, 1)
        c0.width = Cm(TEXT_W - 1.6)
        c1.width = Cm(1.6)
        p0 = c0.paragraphs[0]
        p0.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p0.paragraph_format.space_before = Pt(0)
        p0.paragraph_format.space_after = Pt(2)
        r = p0.add_run(header_text)
        set_run(r, size=9, east=SONG, color=MUTED)
        p1 = c1.paragraphs[0]
        p1.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p1.paragraph_format.space_before = Pt(0)
        p1.paragraph_format.space_after = Pt(2)
        r2 = p1.add_run("v3.0")
        set_run(r2, size=9, east=SONG, color=MUTED)
        base._p.getparent().remove(base._p)
    if footer:
        footer_el = section.footer
        footer_el.is_linked_to_previous = False
        p = footer_el.paragraphs[0]
        p.text = ""
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run("—  ")
        set_run(r, size=9, east=SONG, color=MUTED)
        add_field(p, "PAGE", "1")
        for run in p.runs[-1:]:
            set_run(run, size=9, east=SONG, color=MUTED)
        r = p.add_run("  —")
        set_run(r, size=9, east=SONG, color=MUTED)


def add_cover(doc):
    for _ in range(2):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("设 计 原 理 说 明   ·   D E S I G N   R A T I O N A L E")
    set_run(r, size=10.5, east=HEI, color=MUTED)
    p.paragraph_format.space_after = Pt(18)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("证明陪练场")
    set_run(r, size=34, east=HEI, bold=True, color=INK)
    p.paragraph_format.space_before = Pt(24)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.1

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("设 计 原 理")
    set_run(r, size=26, east=HEI, bold=True, color=INK)
    p.paragraph_format.space_after = Pt(10)
    p.paragraph_format.line_spacing = 1.1

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("面向数学分析证明写作的分步引导系统（原型 v3）")
    set_run(r, size=15, east=HEI, color=RGBColor(0x33, 0x33, 0x33))
    p.paragraph_format.space_after = Pt(4)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Design Rationale for a Stepwise Scaffolding System")
    set_run(r, size=11, east=LATIN, latin=LATIN, italic=True, color=MUTED)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("for Proof Writing in Mathematical Analysis (Prototype v3)")
    set_run(r, size=11, latin=LATIN, italic=True, color=MUTED)
    p.paragraph_format.space_after = Pt(30)

    # 分隔线
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("—" * 28)
    set_run(r, size=10, east=SONG, color=RGBColor(0x9A, 0xA0, 0xA6))
    p.paragraph_format.space_after = Pt(34)

    meta = [
        ("文档类型", "设计原理说明（Design Rationale）"),
        ("版本", "v3.0　内部评审稿"),
        ("日期", "2026 年 11 月 2 日"),
        ("读者", "罗老师及课题组"),
        ("编制", "产品与教学设计组"),
    ]
    for k, v in meta:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(7)
        r = p.add_run(f"{k}　　")
        set_run(r, size=10.5, east=HEI, color=MUTED)
        r = p.add_run(v)
        set_run(r, size=10.5, east=SONG, color=INK)

    for _ in range(4):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("2026 年 11 月")
    set_run(r, size=11, east=SONG, color=MUTED)


def add_front_title(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(18)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    set_run(r, size=16, east=HEI, bold=False, color=INK)


def add_body_paragraph(doc, text, indent=True, size=BODY_PT, east=SONG, space_after=0,
                       alignment=WD_ALIGN_PARAGRAPH.LEFT):
    p = doc.add_paragraph()
    p.alignment = alignment
    p.paragraph_format.space_after = Pt(space_after)
    if indent:
        first_line_chars(p, 2, size)
    add_inline(p, text, size=size, east=east)
    return p


def add_en_paragraph(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.first_line_indent = Cm(0.75)
    p.paragraph_format.space_after = Pt(0)
    add_inline(p, text, size=BODY_PT, east=LATIN)
    return p


def add_meta_line(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.left_indent = Cm(0)
    r = p.add_run(text)
    set_run(r, size=10.5, east=HEI, color=ACCENT)
    return p


def add_heading(doc, level, num, title, anchor, page_break=True):
    text = f"{num}　{title}"
    p = doc.add_paragraph(style=f"Heading {level}")
    p.paragraph_format.space_before = Pt({1: 30, 2: 18, 3: 12}[level])
    p.paragraph_format.space_after = Pt({1: 12, 2: 6, 3: 4}[level])
    if level == 1 and page_break and False:
        p.paragraph_format.page_break_before = True
    add_bookmark(p, anchor)
    r = p.add_run(text)
    if level == 1:
        set_run(r, size=16, east=HEI, bold=False, color=INK)
    elif level == 2:
        set_run(r, size=14, east=HEI, bold=False, color=INK)
    else:
        set_run(r, size=12, east=HEI, bold=False, color=INK)
    return p


def add_callout(doc, label, text):
    table = doc.add_table(rows=1, cols=1)
    table.autofit = False
    cell = table.cell(0, 0)
    cell.width = Cm(TEXT_W)
    table.columns[0].width = Cm(TEXT_W)
    tblPr = table._tbl.tblPr
    tblW = tblPr.find(qn("w:tblW"))
    tblW.set(qn("w:type"), "dxa")
    tblW.set(qn("w:w"), str(int(TEXT_W * 567)))
    # 单元格：浅底 + 左侧红线
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), "F8F3F3")
    tcPr.insert_element_before(shd, "w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText",
                               "w:vAlign", "w:hideMark")
    for side in ("top", "bottom", "right"):
        cell_border(cell, side, sz=0, val="nil")
    cell_border(cell, "left", sz=24, color="8B1A1A")
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.15
    r = p.add_run(label)
    set_run(r, size=10, east=HEI, color=RED)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(3)
    p2.paragraph_format.line_spacing = 1.25
    add_inline(p2, text, size=11, east=SONG)
    sp = doc.add_paragraph()
    sp.paragraph_format.space_after = Pt(4)
    sp.paragraph_format.line_spacing = 1.0
    sp.add_run("").font.size = Pt(4)


def add_table(doc, caption, options, rows):
    widths = [float(x) for x in options.get("widths", "").split(",")] if options.get("widths") else None
    aligns = options.get("align", "").split(",") if options.get("align") else None
    note = options.get("note", "")
    has_header = options.get("header", "1") != "0"
    if not rows:
        return
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    if not widths:
        widths = [TEXT_W / ncol] * ncol

    if caption:
        cap = doc.add_paragraph(style="TableCaption")
        add_inline(cap, caption, size=CAP_PT, east=HEI)
        cap.paragraph_format.keep_with_next = True

    table = doc.add_table(rows=len(rows), cols=ncol)
    table.autofit = False
    tblPr = table._tbl.tblPr

    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.insert_element_before(tblW, "w:jc", "w:tblCellSpacing", "w:tblInd", "w:tblBorders",
                                    "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook")
    tblW.set(qn("w:type"), "dxa")
    tblW.set(qn("w:w"), str(int(sum(widths) * 567)))

    borders = OxmlElement("w:tblBorders")
    for side, sz, val in [("top", 12, "single"), ("bottom", 0, "nil"),
                          ("left", 0, "nil"), ("right", 0, "nil"),
                          ("insideH", 0, "nil"), ("insideV", 0, "nil")]:
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:val"), val)
        if val != "nil":
            el.set(qn("w:sz"), str(sz))
            el.set(qn("w:space"), "0")
            el.set(qn("w:color"), "000000")
        borders.append(el)
    tblPr.insert_element_before(borders, "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook")

    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblPr.insert_element_before(layout, "w:tblCellMar", "w:tblLook")

    mar = OxmlElement("w:tblCellMar")
    for side, val in [("top", 18), ("left", 80), ("bottom", 18), ("right", 80)]:
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tblPr.insert_element_before(mar, "w:tblLook")

    for j in range(ncol):
        table.columns[j].width = Cm(widths[j])
    for i, row in enumerate(rows):
        for j, txt in enumerate(row):
            cell = table.cell(i, j)
            cell.width = Cm(widths[j])
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            p = cell.paragraphs[0]
            p.style = doc.styles["TableHead" if (i == 0 and has_header) else "TableText"]
            if aligns and j < len(aligns):
                a = aligns[j].strip()
                p.alignment = {"l": WD_ALIGN_PARAGRAPH.LEFT, "c": WD_ALIGN_PARAGRAPH.CENTER,
                               "r": WD_ALIGN_PARAGRAPH.RIGHT, "j": WD_ALIGN_PARAGRAPH.JUSTIFY}[a]
            elif i == 0 and has_header:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            if txt:
                add_inline(p, txt, size=TABLE_PT, east=HEI if (i == 0 and has_header) else SONG)
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.0
        trPr = table.rows[i]._tr.get_or_add_trPr()
        if i == 0 and has_header:
            th = OxmlElement("w:tblHeader")
            trPr.append(th)
            for j in range(ncol):
                cell_border(table.cell(0, j), "bottom", sz=6, color="000000")
        cant = OxmlElement("w:cantSplit")
        trPr.append(cant)

    for j in range(ncol):
        cell_border(table.cell(len(rows) - 1, j), "bottom", sz=12, color="000000")
    if len(rows) <= 22:
        for row in table.rows[:-1]:
            for cell in row.cells:
                for cp in cell.paragraphs:
                    cp.paragraph_format.keep_with_next = True
    if note:
        note_row = table.add_row()
        merged = note_row.cells[0].merge(note_row.cells[ncol - 1])
        for side in ("top", "left", "bottom", "right"):
            cell_border(merged, side, sz=0, val="nil")
        mp = merged.paragraphs[0]
        mp.style = doc.styles["TableNote"]
        mp.paragraph_format.space_before = Pt(2)
        mp.paragraph_format.space_after = Pt(0)
        mp.paragraph_format.line_spacing = 1.0
        add_inline(mp, note, size=9, east=SONG, color=MUTED)
        for cell in table.rows[-2].cells:
            for cp in cell.paragraphs:
                cp.paragraph_format.keep_with_next = True
    else:
        sp = doc.add_paragraph()
        sp.paragraph_format.space_after = Pt(10)
        sp.add_run("").font.size = Pt(4)


def add_figure(doc, caption, options):
    path = ASSETS / Path(options["path"]).name if "path" in options else None
    if path is None or not path.exists():
        raise FileNotFoundError(f"图片不存在：{path}")
    width = float(options.get("width", TEXT_W))
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.0
    p.paragraph_format.keep_with_next = True
    run = p.add_run()
    run.add_picture(str(path), width=Cm(width))
    cap = doc.add_paragraph(style="FigureCaption")
    add_inline(cap, caption, size=CAP_PT, east=HEI)
    cap.paragraph_format.space_before = Pt(4)
    cap.paragraph_format.space_after = Pt(12)


def add_list(doc, kind, items):
    for idx, item in enumerate(items, 1):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = Pt(20)
        p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
        pPr = p._p.get_or_add_pPr()
        ind = OxmlElement("w:ind")
        ind.set(qn("w:left"), "480")
        ind.set(qn("w:hanging"), "480")
        pPr.append(ind)
        mark = f"（{idx}）" if kind == "ol" else "·"
        r = p.add_run(mark + "\u3000" if kind == "ol" else mark + " ")
        set_run(r, size=BODY_PT, east=SONG, color=INK)
        add_inline(p, item, size=BODY_PT, east=SONG)


def add_code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.6)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(10)
    p.paragraph_format.line_spacing = 1.15
    shade(p, "F5F5F5")
    para_border(p, color="D0D4D9", sz=4, side="left")
    r = p.add_run(text)
    set_run(r, size=9, east=MONO, latin=MONO, color=RGBColor(0x33, 0x33, 0x33))


def add_toc(doc, headings, pages):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(20)
    r = p.add_run("目　　录")
    set_run(r, size=16, east=HEI, color=INK)
    for lv, num, title, anchor in headings:
        entry = f"{num}　{title}"
        pg = pages.get((lv, num, title), "")
        p = doc.add_paragraph(style="TOC 1" if lv == 1 else "TOC 2")
        p.paragraph_format.tab_stops.add_tab_stop(Cm(TEXT_W), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        add_internal_link(p, anchor, entry, 11 if lv == 1 else 10.5,
                          east=HEI if lv == 1 else SONG, bold=False)
        r = p.add_run("\t" + str(pg))
        set_run(r, size=10.5, east=SONG, color=INK)


def add_reference(doc, text):
    p = doc.add_paragraph(style="Reference")
    hang_indent(p, 0.75)
    p.paragraph_format.line_spacing = Pt(15)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    p.paragraph_format.space_after = Pt(4)
    add_inline(p, text, size=9.5, east=SONG)


# ---------------------------------------------------------------- 文档装配
def build(content, pages):
    doc = Document()
    setup_styles(doc)
    core = doc.core_properties
    core.title = "证明陪练场设计原理（Design Rationale）"
    core.subject = "面向数学分析证明写作的分步引导系统 · 原型 v3"
    core.author = "产品与教学设计组"
    core.keywords = "教育设计研究；设计原理；猜想地图；数学分析；证明写作"
    core.comments = "供罗老师及课题组评审；v3.0"

    sec = doc.sections[0]
    setup_section(sec, header_text=None, footer=False)
    add_cover(doc)

    # ---- 前置部分：罗马页码
    front = doc.add_section(WD_SECTION.NEW_PAGE)
    setup_section(front, header_text=None, footer=True, pgnum=("lowerRoman", 1))

    in_body = False
    body_first = True
    for token in content.tokens:
        kind = token[0]
        if kind == "body":
            in_body = True
            body_sec = doc.add_section(WD_SECTION.NEW_PAGE)
            setup_section(body_sec, header_text="证明陪练场 · 设计原理说明", footer=True,
                          pgnum=("decimal", 1))
            continue
        if kind == "h":
            _, level, num, title, anchor = token
            if not in_body:
                # 前置部分的标题不使用编号标题样式
                add_front_title(doc, f"{num}　{title}" if num else title)
            else:
                add_heading(doc, level, num, title, anchor,
                            page_break=not (level == 1 and body_first))
                if level == 1:
                    body_first = False
        elif kind == "p":
            add_body_paragraph(doc, token[1], indent=True)
        elif kind == "p-en":
            add_en_paragraph(doc, token[1])
        elif kind == "front":
            add_front_title(doc, token[1])
        elif kind == "meta":
            add_meta_line(doc, token[1])
        elif kind == "kw":
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(10)
            p.paragraph_format.space_after = Pt(0)
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            label, rest = (token[1].split("：", 1) + [""])[:2]
            r = p.add_run(label + "：")
            set_run(r, size=BODY_PT, east=HEI, color=INK)
            add_inline(p, rest, size=BODY_PT, east=SONG)
        elif kind == "sub":
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(16)
            p.paragraph_format.space_after = Pt(6)
            p.paragraph_format.keep_with_next = True
            r = p.add_run(token[1])
            set_run(r, size=12, east=HEI, color=INK)
        elif kind == "note":
            p = doc.add_paragraph(style="TableNote")
            add_inline(p, token[1], size=9, east=SONG, color=MUTED)
        elif kind == "kw-en":
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(12)
            p.paragraph_format.space_after = Pt(0)
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            label, rest = (token[1].split(":", 1) + [""])[:2]
            r = p.add_run(label + ": ")
            set_run(r, size=BODY_PT, east=LATIN, bold=True, color=INK)
            add_inline(p, rest, size=BODY_PT, east=LATIN)
        elif kind == "callout":
            add_callout(doc, token[1], token[2])
        elif kind == "table":
            add_table(doc, token[1], token[2], token[3])
        elif kind == "figure":
            add_figure(doc, token[1], token[2])
        elif kind == "ol" or kind == "ul":
            add_list(doc, kind, token[1])
        elif kind == "code":
            add_code(doc, token[1])
        elif kind == "refs":
            for item in token[1]:
                add_reference(doc, item)
        elif kind == "toc":
            add_toc(doc, content.toc_headings, pages)
        elif kind == "newpage":
            page_break(doc)
    return doc


def render_pdf(docx_path, pdf_path):
    env = dict(os.environ)
    env["FONTCONFIG_FILE"] = str(ROOT / "fonts.conf")
    profile = ROOT / "lo-profile"
    profile.mkdir(exist_ok=True)
    subprocess.run(["soffice", f"-env:UserInstallation={profile.as_uri()}",
                    "--headless", "--norestore", "--convert-to", "pdf",
                    "--outdir", str(pdf_path.parent), str(docx_path)],
                   check=True, capture_output=True, env=env, timeout=300)
    produced = pdf_path.parent / (docx_path.stem + ".pdf")
    if produced.resolve() != pdf_path.resolve():
        produced.replace(pdf_path)


def extract_pages(pdf_path):
    txt = subprocess.run(["pdftotext", "-layout", str(pdf_path), "-"],
                         capture_output=True, text=True, check=True).stdout
    pages = txt.split("\f")
    labels = {}
    for idx, page in enumerate(pages):
        m = re.search(r"—\s*([0-9ivxlcdm]+)\s*—", page)
        if m:
            labels[idx] = m.group(1)
    return pages, labels


def resolve_toc_pages(pdf_path, headings):
    pages, labels = extract_pages(pdf_path)
    norm = lambda s: re.sub(r"\s+", "", s)
    body = {i: norm(pages[i]) for i, lab in labels.items() if lab.isdigit()}
    ordered = sorted(body)
    result = {}
    last = 0
    for lv, num, title, anchor in headings:
        key = norm(f"{num}{title}")
        found = None
        for i in ordered:
            if i < last:
                continue
            if key and key in body[i]:
                found = (i, labels[i])
                break
        if found:
            last = found[0]
            result[(lv, num, title)] = found[1]
        else:
            result[(lv, num, title)] = ""
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()

    content = Content([ROOT / f"content_{i}.md" for i in (1, 2, 3, 4)])
    docx_path = DOC_DIR / f"{STEM}.docx"
    pdf_path = DOC_DIR / f"{STEM}.pdf"
    DOC_DIR.mkdir(parents=True, exist_ok=True)

    pages = {}
    for attempt in range(3):
        doc = build(content, pages)
        doc.save(str(docx_path))
        render_pdf(docx_path, pdf_path)
        new_pages = resolve_toc_pages(pdf_path, content.toc_headings)
        missing = [k for k, v in new_pages.items() if not v]
        changed = sum(1 for k in new_pages if pages.get(k) != new_pages[k])
        print(f"[pass {attempt + 1}] 目录条目 {len(new_pages)}，未定位 {len(missing)}，变化 {changed} 条")
        if args.once:
            pages = new_pages
            break
        if new_pages == pages:
            break
        pages = new_pages
    print("完成：", docx_path)
    print("PDF：", pdf_path)


if __name__ == "__main__":
    main()
