# Thesis LaTeX

- 源文件：`thesis.docx`
- 转换脚本：`../convert_docx_to_latex.py`
- 主文件：`main.tex`

重新生成 LaTeX：

```powershell
python ../convert_docx_to_latex.py
```

编译 PDF：

```powershell
C:\Users\mx121\AppData\Roaming\TinyTeX\bin\windows\xelatex.exe -interaction=nonstopmode main.tex
```
