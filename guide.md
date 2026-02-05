启动方式
# 后端
cd d:/Julyanffzz/IonicLink/backend
pip install -r requirements.txt
cp .env.example .env  # 编辑填入 OPENAI_API_KEY
uvicorn main:app --reload

# 前端
cd d:/Julyanffzz/IonicLink/frontend
npm run dev
访问 http://localhost:5173 即可使用。
--------------------------------------------------------
# Git操作
# 1. 初始化本地仓库
git init

# 2. 将分支重命名为 main (以匹配 GitHub 的默认分支)
git branch -M main

# 3. 添加你的远程仓库地址
git remote add origin https://github.com/mx1210385980-a11y/IonicLink.git

# 4. 拉取远程代码，并允许不相关的历史合并
git pull origin main --allow-unrelated-histories

# 5. 添加所有文件到暂存区
git add .

# 6. 提交
git commit -m "Initial upload: project structure"

# 7. 推送到 GitHub
git push -u origin main