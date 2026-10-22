# Margina

**Read. Reflect. Connect. · 阅读、思考、连接。**

[English](README.md) | 简体中文

优先适配手机网页的双语学术文献阅读器，将高亮、笔记和阅读进度保存在浏览器中。Margina 复用 `academic-pdf-bilingual` / BabelDOC 工作流的最终 PDF、翻译片段和术语表，本身不翻译文献，不需要 AI API 密钥。

> **当前为 v0.1.0 本地预览版。** 尚无在线演示、账号系统、跨设备同步或离线启动缓存。Cloudflare 部署是后续方向，尚未实现。

## 功能

- 导入 PDF，按 SHA-256 去重，搜索文献库、收藏文献。
- 在双语 PDF 的中文半页、英文半页和整页对照之间切换。
- 配套阅读包提供适合手机的段落阅读、逐段对照和原术语表。
- 对 PDF 文字高亮，为页码或片段添加笔记，保存书签和阅读进度。
- 提供 Markdown 笔记下载入口；浏览器实际下载的端到端验证仍待完成。

段落模式使用翻译中间片段，可能不包含重复内容或后期排版修复；图表、公式、脚注与修订请以最终 PDF 为准。扫描 PDF 可以显示，但不会自动获得可选文字或 OCR。

## 快速开始

需要 **Node.js 22.13+** 和 npm。`.nvmrc` 使用 Node 22，请安装该系列的当前补丁版本。

```sh
git clone https://github.com/lazymicezhu/Margina.git
cd Margina
npm ci
npm run dev
```

打开 Vite 输出的本地地址。预览生产构建：

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

打开[本地预览](http://127.0.0.1:4173/)。两个服务默认仅监听本机，另一台手机无法直接访问此地址。已在浏览器手机尺寸下检查布局，真实 iOS/Android 操作仍需验证。

首次克隆后文献库为空，直接导入自己的 PDF 即可。仓库不包含研究论文或翻译任务，示例加载仅用于可选的本地开发。

## 双语工作流

导入最终双语 PDF 后即可查看原版。若要使用段落和术语功能，使用 [BabelDOC 适配器](docs/BABELDOC.md) 导出 `.yuejian.json`，与匹配的 PDF 一同导入。为兼容已有预览数据，阅读包标识暂时沿用旧名称。

## 数据与隐私

PDF、笔记、书签和进度存储在当前浏览器、当前站点的 IndexedDB 中。应用没有后端，也不会自动上传文献。清理网站数据会删除文献库；不同浏览器、主机或端口使用不同存储。Markdown 导出不是完整文献库备份，目前无法通过导入恢复笔记。

私有示例、截图、生成资源、依赖、构建产物和本地凭据均排除出 Git。**即使被 Git 忽略，`public/` 中的文件仍会被 Vite 复制进构建产物。** 后续部署应从不含私有示例的干净检出构建。详见[安全与数据说明](SECURITY.md)。

## 项目文档

- [架构与存储](docs/ARCHITECTURE.md)
- [BabelDOC 阅读包适配器](docs/BABELDOC.md)
- [开发与贡献指南](CONTRIBUTING.md)
- [安全与数据说明](SECURITY.md)
- [路线图与验证状态](docs/ROADMAP.md)
- [更新日志](CHANGELOG.md)
- [第三方组件](THIRD_PARTY.md)

## 许可状态

项目原创代码尚未选定许可证，包元数据标记为 `UNLICENSED`。第三方组件保留各自许可证。论文和译文不属于应用代码，本仓库不分发这些材料。
