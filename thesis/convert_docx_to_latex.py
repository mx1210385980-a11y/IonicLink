from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "latex"
RAW_BODY = OUT_DIR / "body.raw.tex"
BODY = OUT_DIR / "body.tex"
MAIN = OUT_DIR / "main.tex"

CIRCLED_NUMBERS = {
    "①": "(1)",
    "②": "(2)",
    "③": "(3)",
    "④": "(4)",
    "⑤": "(5)",
    "⑥": "(6)",
    "⑦": "(7)",
    "⑧": "(8)",
    "⑨": "(9)",
    "⑩": "(10)",
}

SUBSCRIPT_MAP = {
    "₀": "0",
    "₁": "1",
    "₂": "2",
    "₃": "3",
    "₄": "4",
    "₅": "5",
    "₆": "6",
    "₇": "7",
    "₈": "8",
    "₉": "9",
    "₊": "+",
    "₋": "-",
    "₍": "(",
    "₎": ")",
}

SUPERSCRIPT_MAP = {
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
    "⁺": "+",
    "⁻": "-",
    "⁼": "=",
    "⁽": "(",
    "⁾": ")",
}


MAIN_TEMPLATE = r"""\documentclass[UTF8,a4paper,12pt]{ctexart}
\usepackage[margin=2.54cm]{geometry}
\usepackage{graphicx}
\usepackage{longtable,booktabs,array,calc}
\usepackage{float}
\usepackage{hyperref}
\usepackage{indentfirst}

\hypersetup{hidelinks}
\linespread{1.25}\selectfont
\setlength{\parindent}{2em}
\setlength{\LTleft}{0pt}
\setlength{\LTright}{0pt}
\setcounter{secnumdepth}{0}
\setcounter{tocdepth}{3}
\renewcommand{\contentsname}{目\quad 录}
\providecommand{\tightlist}{%
  \setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}

\begin{document}
\input{body.tex}
\end{document}
"""


def run_pandoc() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    command = [
        "pandoc",
        "../thesis.docx",
        "-t",
        "latex",
        "--wrap=none",
        "--extract-media=.",
        "-o",
        RAW_BODY.name,
    ]
    subprocess.run(command, cwd=OUT_DIR, check=True)


def replace_toc_block(text: str) -> str:
    toc_marker = r"\textbf{目 录}"
    first_chapter = r"\section{第1章"
    start = text.find(toc_marker)
    chapter_pos = text.find(first_chapter)
    if start == -1 or chapter_pos == -1 or chapter_pos <= start:
        return text

    wrapper_start = text.rfind(r"\hypertarget{", 0, chapter_pos)
    if wrapper_start != -1:
        chapter_pos = wrapper_start

    replacement = "\\clearpage\n\\tableofcontents\n\\clearpage\n\n"
    return text[:start] + replacement + text[chapter_pos:]


def replace_frontmatter_headings(text: str) -> str:
    replacements = {
        r"\textbf{摘 要}": (
            "\\clearpage\n\\section*{摘\\ 要}\n"
            "\\addcontentsline{toc}{section}{摘 要}"
        ),
        r"\textbf{Abstract}": (
            "\\clearpage\n\\section*{Abstract}\n"
            "\\addcontentsline{toc}{section}{Abstract}"
        ),
    }
    for source, target in replacements.items():
        text = text.replace(source, target, 1)
    return text


def cleanup_caption_text(caption_block: str) -> str:
    lines = [line.strip() for line in caption_block.splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return ""

    lines[0] = re.sub(r"^图\d+(?:-\d+)?\s*", "", lines[0])
    cleaned = " ".join(lines).strip()
    return cleaned


def convert_figures(text: str) -> str:
    figure_pattern = re.compile(
        r"(?ms)^\\includegraphics(?P<graphic>\[[^\n]+\]\{[^}]+\})\n\n"
        r"(?P<caption>(?:图[^\n]*(?:\n(?!\n).*)*))\n\n"
    )

    def repl(match: re.Match[str]) -> str:
        graphic = match.group("graphic")
        caption = cleanup_caption_text(match.group("caption"))
        if not caption:
            return match.group(0)
        return (
            "\\begin{figure}[H]\n"
            "\\centering\n"
            f"\\includegraphics{graphic}\n"
            f"\\caption{{{caption}}}\n"
            "\\end{figure}\n\n"
        )

    return figure_pattern.sub(repl, text)


def replace_unicode_runs(text: str, mapping: dict[str, str], prefix: str, suffix: str) -> str:
    charset = "".join(re.escape(key) for key in mapping)
    pattern = re.compile(f"[{charset}]+")

    def repl(match: re.Match[str]) -> str:
        converted = "".join(mapping[ch] for ch in match.group(0))
        return f"{prefix}{converted}{suffix}"

    return pattern.sub(repl, text)


def normalize_symbols(text: str) -> str:
    for source, target in CIRCLED_NUMBERS.items():
        text = text.replace(source, target)

    plain_replacements = {
        "≥": r"$\ge$",
        "≤": r"$\le$",
        "≈": r"$\approx$",
        "μ": r"$\mu$",
        "π": r"$\pi$",
    }
    for source, target in plain_replacements.items():
        text = text.replace(source, target)

    text = replace_unicode_runs(text, SUBSCRIPT_MAP, r"$_{", "}$")
    text = replace_unicode_runs(text, SUPERSCRIPT_MAP, r"$^{", "}$")
    return text


def clean_body(text: str) -> str:
    text = replace_frontmatter_headings(text)
    text = replace_toc_block(text)
    text = convert_figures(text)
    text = normalize_symbols(text)
    return text


def write_outputs() -> None:
    raw_text = RAW_BODY.read_text(encoding="utf-8")
    BODY.write_text(clean_body(raw_text), encoding="utf-8")
    MAIN.write_text(MAIN_TEMPLATE, encoding="utf-8")


def main() -> None:
    run_pandoc()
    write_outputs()
    print(f"Generated: {MAIN}")


if __name__ == "__main__":
    main()
