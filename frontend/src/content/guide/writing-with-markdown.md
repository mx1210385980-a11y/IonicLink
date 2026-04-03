---
title: 如何用 Markdown 维护这个站点
summary: 这篇文章说明新增文章的最小格式、Frontmatter 字段和适合长期写作的组织方法。
date: 2026-04-03
tags: Markdown, 写作, Frontmatter
order: 4
section: guide
---

# 最小文章格式

新增一篇文章时，建议先写好文件头：

```md
---
title: 文章标题
summary: 一句话摘要
date: 2026-04-03
tags: 提示词, RAG, 实验记录
order: 10
section: ai
---
```

- `title` 用于页面标题和侧栏名称。
- `summary` 用于首页摘要与搜索结果描述。
- `date` 用于最近更新区域。
- `tags` 用于检索和归类。
- `order` 决定同一栏目中的排序。

## 文件夹建议

- `src/content/guide`：放平台说明、部署说明、FAQ、结构设计。
- `src/content/ai`：放 AI 学习、实验、模型比较、提示词与方法论。

> [!TIP]
> 如果一篇文章既是平台实践又涉及 AI 方法，优先按“未来你会去哪里找它”来分类，而不是按它的来源分类。

## 长期维护的关键

知识博客真正难的不是开始，而是持续更新。你可以先从以下三类短文开始：

1. 一次配置过程
2. 一次失败实验
3. 一个 AI 概念的个人理解
