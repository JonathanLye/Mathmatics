#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""交付物验收测试（文档工程版本的红/绿测试）。

先于实现运行应失败（RED），跑完 build 后应全部通过（GREEN）。
覆盖：图形素材、DOCX 结构、目录页码与 PDF 实际页码一致、图表编号连续、引用完整性。
"""

import re
import subprocess
import sys
import unittest
from pathlib import Path

from docx import Document
from docx.shared import Twips
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DOC_DIR = ROOT / "证明陪练场_产品设计工作区" / "09-设计原理说明书"
DOCX = DOC_DIR / "证明陪练场_设计原理说明_v3.0.docx"
PDF = DOC_DIR / "证明陪练场_设计原理说明_v3.0.pdf"
ASSETS = ROOT / "work" / "assets"


class FigureTests(unittest.TestCase):
    def test_figures_exist_at_print_resolution(self):
        expected = {
            "fig4-1-conjecture.png": (1700, 104 / 152),
            "fig7-1-trial.png": (1700, 62 / 152),
        }
        for name, (min_w, ratio) in expected.items():
            p = ASSETS / name
            self.assertTrue(p.exists(), f"缺少图形素材 {p}")
            w, h = Image.open(p).size
            self.assertGreaterEqual(w, min_w, f"{name} 宽度不足（{w}px），打印会发虚")
            self.assertAlmostEqual(h / w, ratio, delta=0.02, msg=f"{name} 长宽比异常")


class DocxStructureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DOCX.exists():
            raise unittest.SkipTest(f"DOCX 尚未生成：{DOCX}")
        cls.doc = Document(str(DOCX))
        cls.text = "\n".join(p.text for p in cls.doc.paragraphs)
        cls.tables = cls.doc.tables

    def test_required_sections(self):
        compact = re.sub(r"\s+", "", self.text)
        for key in ["摘要", "Abstract", "问题陈述", "设计要求", "设计原则", "猜想地图",
                    "演示", "对照", "评估方案", "局限", "待确认", "参考文献", "术语表"]:
            self.assertIn(key, compact, f"缺少章节：{key}")

    def test_heading_numbering_is_sequential(self):
        h1 = [p.text.strip() for p in self.doc.paragraphs
              if p.style.name == "Heading 1" and re.match(r"^\d+", p.text.strip())]
        nums = [int(re.match(r"^(\d+)", t).group(1)) for t in h1]
        self.assertEqual(nums, list(range(1, 11)), f"一级标题编号不连续：{nums}")

    def test_no_placeholder_left(self):
        for token in ["TODO", "待补", "XXX", "占位"]:
            self.assertNotIn(token, self.text)

    def test_caption_sequence(self):
        figs = re.findall(r"图 (\d+)-(\d+)", self.text)
        tabs = re.findall(r"表 (\d+)-(\d+)", self.text)
        self.assertGreaterEqual(len(set(figs)), 7, "图题少于 7 个")
        self.assertGreaterEqual(len(set(tabs)), 10, "表题少于 10 个")

    def test_tables_are_three_line(self):
        # 三线表：表内不应有竖线（insideV 缺省或 none）
        for i, t in enumerate(self.tables):
            xml = t._tbl.xml
            self.assertNotIn('w:insideV w:val="single"', xml, f"表 {i} 出现竖线，不是三线表")

    def test_body_fonts_are_defined(self):
        xml = self.doc.styles.element.xml
        self.assertIn("宋体", xml)
        self.assertIn("黑体", xml)

    def test_reference_count_and_doi(self):
        refs = [p for p in self.doc.paragraphs if p.style.name in ("Reference", "参考文献")]
        self.assertGreaterEqual(len(refs), 20, f"参考文献只有 {len(refs)} 条")
        with_doi = sum(1 for p in refs if "doi.org" in p.text or "DOI" in p.text)
        self.assertGreaterEqual(with_doi, 10, "带 DOI 的参考文献过少")

    def test_toc_pages_match_pdf(self):
        if not PDF.exists():
            self.skipTest("PDF 尚未生成")
        pages = subprocess.run(["pdftotext", "-layout", str(PDF), "-"], capture_output=True, text=True).stdout.split("\f")
        # 正文页脚形如 “— 3 —”
        body = {}
        for idx, pg in enumerate(pages):
            m = re.search(r"—\s*(\d+)\s*—", pg)
            if m:
                body[int(m.group(1))] = pg.replace("\n", "").replace(" ", "")
        self.assertGreaterEqual(len(body), 15, "PDF 正文页数异常")
        toc = [p.text for p in self.doc.paragraphs if p.style.name == "TOC 1" or p.style.name == "TOC 2"]
        self.assertGreaterEqual(len(toc), 20, "目录条目过少")
        mismatch = []
        for line in toc:
            m = re.search(r"(\S.*?)\s*\.{2,}\s*(\d+)$", line)
            if not m:
                continue
            title, num = m.group(1), int(m.group(2))
            key = re.sub(r"\s+", "", title)[:18]
            page = body.get(num, "")
            if key and key not in page:
                mismatch.append((title, num))
        self.assertEqual(mismatch, [], f"目录页码与 PDF 不一致：{mismatch[:5]}")


class PdfLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not PDF.exists():
            raise unittest.SkipTest("PDF 尚未生成")

    def test_page_count_in_range(self):
        out = subprocess.run(["pdfinfo", str(PDF)], capture_output=True, text=True).stdout
        m = re.search(r"Pages:\s+(\d+)", out)
        self.assertIsNotNone(m)
        n = int(m.group(1))
        self.assertGreaterEqual(n, 20, "页数过少，内容可能缺失")
        self.assertLessEqual(n, 48, "页数过多，排版可能失控")

    def test_no_overflow_text_beyond_margin(self):
        # 用 pdftotext -bbox 检查每行是否超出页面右边界（A4 595.3pt，右边距 2.8cm≈79pt）
        xml = subprocess.run(["pdftotext", "-bbox", str(PDF), "-"], capture_output=True, text=True).stdout
        over = []
        for m in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', xml, re.S):
            pw = float(m.group(1))
            for line in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', m.group(3)):
                if float(line.group(3)) > pw - 60:
                    over.append(line.group(5))
        self.assertEqual(over[:5], [], f"有文本超出右侧版心：{over[:5]}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
