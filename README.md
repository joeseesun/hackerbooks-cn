# 黑客书架 — Hacker Books 中文版

[hackerbooks.qiaomu.ai](https://hackerbooks.qiaomu.ai/) — [Hacker News](https://news.ycombinator.com) 评论中被提及书籍的中文镜像站。收录 15,362 本书、270,334 次提及，按「多少位不同的读者提及」排名。

![架构](https://img.shields.io/badge/%E6%9E%B6%E6%9E%84-%E7%BA%AF%E9%9D%99%E6%80%81-black) ![构建](https://img.shields.io/badge/%E6%9E%84%E5%BB%BA-%E6%97%A0-black)

## 特性

- **全量中文化**：书名、副题、简介、高赞评论均有简体中文（LLM 翻译，难免有噪声），列表与详情中英双语展示，未翻译的自然回退原文。
- **中文搜索**：书名/副题/作者/HN 缩写（sicp、taocp…）中英文均可检索；支持全拼与拼音首字母（xuebeng → 雪崩、qszd → 起始之地），搜索结果可按年代/话题筛选。
- **今日书架**：每天按加权随机换一批（120 本），另有历史总榜、最多推荐、上升最快、趋势图（年度排名/常青书/浪潮）、话题分类。
- **我的书架**：想读 / 读过 / 星级评分，只存本机 localStorage，可生成分享链接（/list?ids=…）；「为你推荐」按书架信号 + HN 共现图在本地计算。
- **购书与书评直达**：豆瓣 / 微信读书 / 京东 / Z-Library 搜索链接与 Goodreads 书评入口，无返利。
- **SEO / 订阅 / 分享**：热度 Top2000 书籍预渲染静态页（`/b/<id>.html`）、Top300 作者聚合页（`/author/<slug>.html`）、上升最快 RSS（feed.xml）、详情页一键生成分享图。
- **数据洞察**：历年年度书时间线（/years）、「被低估的书」提及量×推荐率散点图、搜索零结果纠错建议。
- **纯静态、无后端、无构建**：原生 ES Module 单页应用（hash 路由），数据是一组 JSON，任意静态托管即可部署。
- PWA（可安装、离线回退）、Service Worker 分层缓存、Umami 统计。

## 本地运行

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

站点数据（`data/`、`covers/`）不在仓库内，见下节。

## 数据管道

数据整理自 [hackerbooks.org](https://hackerbooks.org)（[roansh](https://rohitshinde.in) 的项目，感谢其公开的数据管道，完整数据集可在原站获取）。`scripts/` 内是本站的补充工具：

| 脚本 | 用途 |
|---|---|
| `scrape_all.py` / `retry_details.py` | 抓取书籍详情与封面镜像（可断点续传；源站对高并发限流，请保持低并发） |
| `cli_translate.py` / `zh2_translate.py` | 书名/简介/评论的 LLM 批量中文化（分块、并行、断点续跑） |
| `merge.py` / `integrate.py` / `zh2_integrate.py` | 翻译结果校验、合并并注入站点 JSON |

书名翻译约定见实践总结：有通行中文版书名的用通行译名，技术书保留英文原名，其余忠实意译。评论摘录版权归原作者所有，页面只保留摘录并链接回原帖。

## 部署

任意静态托管。本站的部署方式：Nginx 托管目录 + 分层缓存（封面 30d / 数据 JSON 5m / 版本化静态资源长缓存）+ Let's Encrypt。数据更新流程：重跑抓取脚本 → 注入翻译 → rsync。

## 字体

中文衬线为[源流明体](https://github.com/ButTaiwan/genryu-fonts)（基于 OFL 的思源宋体衍生）子集，英文为 [Newsreader](https://fonts.google.com/newsreader)（OFL），子集由按站内字符集裁剪的内部脚本生成。

## 致谢

- [hackerbooks.org](https://hackerbooks.org) — 数据与灵感来源（roansh 构建）
- [Open Library](https://openlibrary.org) — 书籍元数据与封面
- [Hacker News](https://news.ycombinator.com) / Y Combinator — 评论数据（本站与其无从属关系；评论版权归原作者）

## License

代码以 [MIT](LICENSE) 发布。站点数据与评论摘录的版权遵循原始来源的条款。
