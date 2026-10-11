# 归档校验单 (archive manifest)

SHA256  : 302E1B3A101ADF2AB85ACF937A6FDA7626420991BF59065A946B999126D74721
归档字节: 2184374548
条目数  : 3629
压缩前  : 2469835999 字节 (2355.4 MB)

正式位置: KnowledgeBase/01_Research/ioniclink-literature/literature-expansion-20260912.zip
镜像位置: data/archive/literature-expansion-20260912.zip
  (两处为同一物理文件的硬链接, 不额外占用磁盘; 任一路径删除不影响另一处)

源目录 data/literature-expansion-20260912 (2355.4 MB) 已于归档校验通过后删除。

## 校验记录
- 创建方式: System.IO.Compression.ZipFile.CreateFromDirectory(UTF-8 文件名编码)
- 压缩率 11.6% — 内容以 PNG 页面图(1286 MB)与 PDF(939 MB)为主, 均已是压缩格式
- 回解压后与源逐文件 SHA256 全量比对: 3629/3629 一致, 0 处不符
- 中文文件名往返验证: 扩库进度.md / batch-02-root/批次02报告.md 均正确还原
- 删源后复查: 两处副本均可用, 条目数 3629, 哈希不变
- 注意: 不可用 Windows 自带 tar.exe 重建此 zip — 其退出码为 0 且条目数、总字节数
  均正确, 但会把非 ASCII 文件名静默降级为 '_' (仅 stderr 提示 CP437 转换失败)。
  校验 zip 是否保真时, 必须逐文件比对文件名与哈希, 不能只看条目数和总大小。
- 注意: 归档内无独立文件级校验单; 如需逐个文件核对, 请以 SHA256
  逐项比对解压结果, 本单所载哈希即该 zip 的整体指纹。

## 内容说明
该归档是 2026-09-12 至 09-14 离子液体摩擦数据库扩库工程的原始材料与审计留痕,
对应 data/tribology.db 中 1088 条 official 记录的来源 PDF、逐页审阅图(供视觉核对
表格数值)与 reviewed-*-plan/receipt 审批链(SHA256 溯源)。

它的作用是可追溯性: 数据库中每条记录的 payload.provenance 都写明页码、表格号、
basis 与逐字引文, 而这些引文是否被篡改, 只能靠此处的原始 PDF 独立复核。
因此本归档应视为该 1088 条记录的唯一证据链, 不建议删除。
