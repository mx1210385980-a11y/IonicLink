要实现“特征工程 -> 动态训练 -> 实时指标可视化”的全栈闭环，我们需要在现有的 Vue 3 + FastAPI 架构上进行扩充。以下是实现这个目标的完整蓝图：
1. 数据流与特征工程 (Feature Engineering)
这是预测模型的基础，尤其是处理化学信息学数据。
• SMILES 解析与分子描述符：
• 在后端引入 rdkit 库。
• 将阴离子和阳离子的 SMILES 字符串转化为机器可读的特征。最常用的是 Morgan 分子指纹 (Morgan Fingerprints) 或者物理化学描述符（分子量、极性表面积等）。
• 由于离子液体由阴阳离子组成，你需要决定是将它们的指纹向量拼接 (Concatenate)，还是按照摩尔比进行加权求和。
• 工况参数处理：
• 文献中提取的载荷 (Load)、速度 (Speed)、温度 (Temperature)、时间 (Time) 等数值型特征，其量纲差异巨大。
• 需要使用 scikit-learn 的 StandardScaler 或 MinMaxScaler 进行标准化，确保梯度下降或树模型分裂时的稳定性。
• 特征融合：将分子指纹向量与标准化后的工况特征拼接到一起，形成最终的输入矩阵 ，而摩擦系数或磨损率作为目标变量 。
2. 后端架构：异步任务与 WebSocket 通信
在 FastAPI 的普通路由中直接调用模型训练（尤其是跑几十个 Epoch 的深度学习或大规模交叉验证）会阻塞整个后端服务，导致前端卡死。
• 异步任务队列：引入 Celery + Redis（或者更轻量级的 RQ）。当课题组学生在前端点击“开始训练”时，FastAPI 将训练任务丢给后台 Worker 处理，并立即返回一个 task_id。
• 实时数据推送：使用 FastAPI 的 WebSockets 模块。后台 Worker 在训练过程中，每完成一个阶段（或一个 Epoch），就将当前的 、RMSE 和 MAE 计算出来，并通过 Redis Pub/Sub 或直接通过 WebSocket 广播给前端。
3. 模型选择与“动态变化”的实现逻辑
这里需要根据你选择的算法来设计“动态展示”的逻辑：
• 如果是树模型 (XGBoost, LightGBM, Random Forest)：
• 这些模型往往训练速度极快，没有深度学习意义上的 Epoch。
• 动态展示策略：你可以展示模型随着迭代次数 (Boosting Rounds/Trees) 增加时，训练集和验证集  和 RMSE 的变化曲线（Learning Curve）。
• 如果是深度神经网络 (PyTorch/TensorFlow)：
• 动态展示策略：在自定义的 Training Loop 中，每个 Epoch 结束后计算验证集的 、RMSE、MAE，并发送给前端，学生可以直观看到损失函数的收敛过程和是否过拟合。
4. 前端工作台设计 (Vue 3)
前端需要新增一个 Model Training 面板，包含三大区域：
• 配置区 (Configuration)：
• 提供 Checkbox 让学生选择哪些特征参与训练（例如：去掉“温度”，看看模型指标掉多少）。
• 提供 Slider 或 Input 调整超参数（如学习率、树的深度、正则化系数）。
• 实时监控区 (Live Monitor)：
• 使用 ECharts 或 Chart.js 绘制三张折线图，分别对应 、RMSE 和 MAE。
• 图表通过监听 WebSocket 接收到的 JSON 数据，调用 chart.update() 动态向右推演折线。
• 结果对比区 (Leaderboard)：
• 记录每次调参后的最终指标，以表格形式展示，方便学生对比不同参数组合的效果。