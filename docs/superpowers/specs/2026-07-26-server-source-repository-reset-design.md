# IonicLink 服务器源码重建 GitHub 仓库设计

日期：2026-07-26

## 目标

以 `47.82.82.215` 上当前通过 80/8080 端口提供网站服务的
`/opt/ioniclink-v2` 为唯一源码基准，重建
`mx1210385980-a11y/IonicLink`。重建后，GitHub 的 `main` 只保留一条新的
初始提交，并删除旧开发分支和旧标签。

## 已核对的事实

- SSH 别名为 `ioniclink`，使用独立部署密钥登录服务器。
- 当前网站容器是 `ioniclink-frontend`，Compose 工作目录为
  `/opt/ioniclink-v2`。
- `/opt/ioniclink-v2` 没有 Git 元数据。
- 旧服务仍从 `/opt/ioniclink/repo` 运行 8000 端口；本次不停止、不修改，
  也不把它混入新仓库。
- GitHub SSH 写入身份为 `mx1210385980-a11y`。
- 目标仓库当前有 `main` 和三个旧开发分支，没有标签。
- 服务器部署目录缺少 README 与测试引用的
  `data/tribology/gold-standard/literature-annotations.json`。该文件是 5.3KB
  的模拟 DOI 测试夹具，不是生产数据库或论文；从本机同版本 v2 补回后，
  原失败测试与完整测试套件均通过。

## 执行方案

1. 将旧 GitHub 仓库保存为仅存放在本机的 Git bundle，作为紧急恢复保险。
2. 将 `/opt/ioniclink-v2` 同步到新的临时目录。
3. 排除所有运行数据、秘密和可再生成产物。
4. 在临时目录安装依赖，并执行测试与生产构建。
5. 补回部署目录遗漏但源码测试必需的小型模拟 gold fixture。
6. 删除临时目录中的既有 Git 元数据（如果同步过程中发现），初始化全新仓库。
7. 创建唯一的初始提交，并强制更新远程 `main`。
8. 删除远程除 `main` 之外的旧分支和全部旧标签。
9. 从更新后的 GitHub 仓库克隆一个新的本地开发副本并复验。

## 不进入 GitHub 的内容

- `.env`、`.env.local`、`.env.production` 及其他真实环境配置；示例文件除外
- SSH 密钥、证书、令牌、API Key 和密码
- `data/*.db`、SQLite 辅助文件、上传源文件和运行数据库
- `Lubrication_sources/` 中的论文与研究资料
- `node_modules/`、`.next*/`、测试缓存和编译缓存
- 日志、PID 文件、`.codex-run/`、部署备份、报告与临时目录
- 本地工具配置、工作树和操作系统生成文件

仓库必须保留足够完整的 `.gitignore`，防止以上内容后续被误提交。

## 破坏性操作边界

- 只改写 `git@github.com:mx1210385980-a11y/IonicLink.git`。
- 只读取服务器 `/opt/ioniclink-v2`，不在服务器删除或改写源码、数据和容器。
- 不修改当前本机的 `Ioniclink` 和 `Ioniclink-v2` 目录中的既有内容。
- 远程改写前必须确认新源码已通过必要验证，并且本地 Git bundle 可读取。

## 验收标准

- GitHub 默认分支为新的 `main`，历史仅包含新的初始提交。
- 远程不存在旧开发分支和旧标签。
- 仓库中不存在真实环境文件、密钥、数据库、论文或运行产物。
- 新机器可以从 GitHub 克隆、安装依赖、运行测试并完成生产构建。
- 服务器现有网站和旧 8000 端口服务在仓库重建过程中保持运行。
