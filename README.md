# OxChat

一个基于 DeepSeek API 的手机端 AI 聊天应用，同时提供网页版。

界面针对手机优化，可直接安装 APK 使用，也可以部署到 GitHub Pages 在 iOS 等设备上通过浏览器访问。

## 功能

- **聊天**：流式回复、多会话管理、消息分支切换、会话搜索
- **模型**：模型切换、思考强度（默认「高」）、深度思考、智能搜索
- **富文本**：Markdown、代码高亮、Mermaid 图表、LaTeX 公式、表格
- **附件**：图片与文档上传、历史消息附件重传
- **语音**：语音输入、回复朗读
- **个性化**：主题（浅色/深色/跟随系统）、思考内容自动折叠、中英文界面
- **数据**：历史会话导出为 ZIP、从备份包导入（可勾选要导入的对话）
- **官网导入**（仅 APK）：在 App 内登录 DeepSeek 账号，经官方导出接口拉取全部对话，勾选后导入

## 移动端（APK）

原生壳基于 Capacitor，提供网页版没有的能力：

- API Key 存入 Android Keystore，不以明文落盘
- App 内嵌浏览器完成官网账号登录与对话导入
- 状态栏跟随应用主题

## 网页版

纯静态站点，无后端，浏览器直连 DeepSeek API。

```bash
pnpm install
pnpm type && pnpm lint && pnpm build   # 产物在 dist/
```

部署到 GitHub Pages：推送到仓库 `main` 分支后由 GitHub Actions 自动构建发布，访问 `https://<用户名>.github.io/<仓库名>/`。

网页版与 APK 的差异：

- 官网账号导入不可用（依赖原生能力）
- API Key 存浏览器 localStorage，换设备或清缓存会丢失，建议定期导出备份

## 开发

```bash
pnpm dev     # 本地开发服务器
pnpm type    # 类型检查
pnpm lint    # 代码规范
pnpm build   # 生产构建
```

技术栈：React 18 + TypeScript + rspack。

## 数据与隐私

- 应用不提供模型服务，也不内置任何 API Key，所有请求由你自己的 DeepSeek 账号与官方服务产生，费用按官方规则结算。
- API Key 与对话记录只保存在本机（APK 用 Keystore，网页版用浏览器存储），不会上传到任何第三方服务器。
- 通过官网导入拉取的数据来自你自己的 DeepSeek 账号，仅在本地解析与保存。

## 许可

本项目基于 [DeepSeek 官方开源前端 chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT License）适配开发，遵循 MIT 许可发布，详见 [LICENSE](LICENSE)。

本项目为非官方项目，与深度求索公司无关联，未获其授权或背书。
