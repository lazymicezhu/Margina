# Cloudflare 部署与管理后台

使用 Workers 托管网页和接口、D1 保存账号与笔记、R2 保存 PDF / JSON。无需先运行本地预览，也不需要推送 GitHub。当前公共网站为 https://margina.lazymicezhu.com，Worker、D1 和私有 R2 已部署。Zero Trust Free 与邮箱验证码登录已启用；登录有效期为 24 小时，仅保护 `/api/private/*`。当前允许登录的邮箱为已配置的管理员邮箱，新增账号需加入 Access Allow 策略。

## 1. 准备 Cloudflare

在 Cloudflare 控制台开通 R2 和 Zero Trust Free。R2 桶使用 Standard 存储、保持私有；无需开启 r2.dev 或公开桶。准备 Node.js 22.13+，在项目文件夹执行：

```sh
npm ci
npx wrangler login
cp wrangler.jsonc wrangler.production.jsonc
npx wrangler d1 create margina --config wrangler.production.jsonc --update-config=false
npx wrangler r2 bucket create margina-files --config wrangler.production.jsonc
```

复制 D1 返回的 `database_id`，填入 `wrangler.production.jsonc` 中的 `REPLACE_BEFORE_DEPLOYMENT`。该配置副本已被 Git 忽略。如果资源已存在，直接使用原数据库 ID 和桶名称，不要重复创建。

## 2. 初始化并首次发布

```sh
npm run db:cloud
npm run deploy:cloud
```

`db:cloud` 在远端 D1 创建所需表，可重复执行，不清空已有数据。`deploy:cloud` 构建 `dist-cloud/` 后发布 Worker，完成后显示类似 `https://margina.你的子域.workers.dev` 的网址。此时可以浏览空书库；邮箱登录在下一步启用。

发布使用资源白名单，不会打包 `public/samples/` 中的本地文献。不要上传普通 `dist/`，不要部署 `wrangler.local.jsonc`。本地预览数据不会自动搬到云端，正式文献在网站内上传即可。

## 3. 开启邮箱登录

进入 **Zero Trust → Access → Applications → Add an application → Self-hosted**，创建 `Margina 登录`：

- 应用域名使用刚发布的网站主机名；Path 填 `api/private/*`。
- 使用自定义域名时，必须将该主机名的 `api/private/*` 路径加入同一个 Access 应用。当前已配置 `margina.lazymicezhu.com/api/private/*` 和 `margina.2644860482.workers.dev/api/private/*`，共用同一 AUD；仅绑定 Worker 自定义域名不会自动添加 Access 登录保护。
- 使用基于域名和路径的应用，仅保护 `/api/private/*`。不要使用覆盖整个 Worker 的 “Protect this Worker” 开关，否则公开书库也会要求登录。
- 登录方式启用 **One-time PIN**（邮箱验证码）。
- 添加 **Allow** 策略，先在 **Emails** 中填你的邮箱及需要登录的其他用户邮箱。后续可以在此增删允许登录的邮箱。
- 保存后复制应用的 **Application Audience (AUD) Tag**。团队域名可在 Zero Trust 设置中找到，例如 `your-team.cloudflareaccess.com`。

将以下两项填入 `wrangler.production.jsonc` 的 `vars`：

```json
"ACCESS_ISSUER": "https://your-team.cloudflareaccess.com",
"ACCESS_AUD": "复制的应用 AUD"
```

`ACCESS_ISSUER` 不带末尾斜线。保留 `ENVIRONMENT=production` 和 `LOCAL_DEV_AUTH=false`。

Cloudflare 支持对 `workers.dev` 的指定路径设置 Access，无需先购买域名。参考：[指定主机或路径的 Access 配置](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-a-specific-hostname-custom-domain-or-path)、[邮箱验证码](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)。

## 4. 设置管理员并完成发布

```sh
npx wrangler secret put ADMIN_EMAILS --config wrangler.production.jsonc
```

出现输入提示后填你的登录邮箱；多个管理员用英文逗号分隔。不要把 `ADMIN_EMAILS` 另行写入 `vars`，避免与同名 Secret 冲突。管理员邮箱也必须被上一节的 Access Allow 策略允许。

```sh
npm run deploy:cloud
```

打开网站，点击「登录」输入邮箱验证码。管理员在「设置与账号 → 管理后台」进入后台，也可以直接打开网站的 `/admin`。

## 管理后台

- **文献库**：搜索全部文献、上传 PDF / JSON、撤下、恢复、删除。
- **账号笔记**：按邮箱搜索账号，打开账号查看各篇文献的笔记、高亮、页码和书签数量。
- **撤下**：隐藏公开目录和下载，文件保留，可恢复。
- **删除**：删除云端 PDF / JSON 并释放应用存储预算，保留文献信息与账号笔记。中断时显示「重试删除」。已删除文献不可恢复，也不能以同一 PDF 哈希重新上传。

账号首次登录后进入后台列表。后台只能读取已经成功同步到云端的笔记。普通账号不能调用后台接口。管理员由服务器验证的邮箱决定，不能通过修改网页或请求头提升权限。

## 更新已有部署

```sh
npm run db:cloud
npm run deploy:cloud
```

保持同一个 D1 数据库、R2 桶和 Worker 名称。现有配置文件与管理员 Secret 保留，旧阅读记录不需要重新导入。部署后在正式网址确认游客能阅读、邮箱能登录、管理员能打开后台；真实 Access 登录及设备行为需在云端验证。

## 存储与免费额度

应用默认文件预算为 **8,000,000,000 bytes**，可通过 `MAX_STORAGE_BYTES` 调整；PDF 和阅读包都计算在内。PDF 上限 100 MB，JSON 上限 20 MB。R2 的 10 GB-month 是免费用量，不是桶的容量上限；超过免费存储或操作额度会计费。应用预算不是 Cloudflare 全账号的账单硬上限。

公开阅读仍会消耗 Worker 请求和 R2 读取操作；同一浏览器下载后的 PDF 可复用本地缓存。Access 免费方案最多 50 个用户，适合小规模登录群体，游客不占登录账号。具体额度以 [R2 定价](https://developers.cloudflare.com/r2/pricing/)、[Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/) 和 [Zero Trust 计划](https://www.cloudflare.com/plans/zero-trust-services/) 为准。

## 数据与同步实现

- D1 的 `papers` 保存公开元数据、R2 引用及状态；`users` 保存登录账号和邮箱；`reading` 保存按账号隔离的版本化快照；`storage_allocations` 原子预留上传空间。
- `papers.removed`：0 公开、1 撤下、2 文件已删除、3 删除中/待重试。删除前先进入状态 3，阻止并发恢复和阅读包替换；R2 删除完成后释放对应预留空间，再进入状态 2。个人阅读快照不删除。
- R2 保持私有，通过公开 Worker 接口提供文件。Worker 检查文献状态，不公开对象名称或账号笔记。
- Access JWT 验证签名、签发者、受众和有效期；所有写操作要求同源 Origin。后台接口额外检查管理员身份。缺失或无效身份不能访问私有接口。
- 保留 IndexedDB `yuejian-library` v1：`books` 存文件与游客记录，`settings` 按账号存快照、同步基线和待提交修改。阅读包仍使用 `yuejian-babeldoc-v1`。
- 编辑先写本机，1.8 秒合并发送；启动、回到前台、恢复网络及手动操作触发同步，失败保留队列并有限退避重试。
- 版本冲突自动合并独立笔记，同一笔记的并发修改保留副本，删除与编辑冲突保留编辑。书签逐项合并，取消收藏保留笔记；阅读进度按打开时间合并，设备时钟偏差可能影响优先级。
- 原有本机文件不会自动上传。游客记录只有主动选择合并时才进入当前账号，且仅限书库中已有文献。

## 可选：本地开发

部署不需要此步骤。需要修改代码时可以使用：

```sh
npm run build:cloud
npm run dev:cloud
```

打开 `http://127.0.0.1:8787`，测试账号 A 为管理员、B 为普通账号。数据位于忽略的 `.wrangler/state/`；测试身份只在回环地址与本地配置同时启用时可用，生产配置关闭此入口。Worker 重启后重新登录。前端修改后需重新构建。

## 验证状态

此前本地检查覆盖公共书库、上传、账号同步、冲突、离线恢复，以及 320 / 390 / 768 像素宽度。此次按要求不启动本地功能测试，仅执行构建和线上检查。已确认主页及公共目录返回 200、登录入口启用、私有接口跳转邮箱验证码登录页；已在自定义域名通过现有登录会话进入管理后台并加载文献列表。上传、删除、账号笔记等后台交互、真实移动设备、100 MB 上传和免费计划 CPU / 负载仍待验证。

目前不提供离线启动缓存、全文检索或完整可恢复备份。上传失败或进程中断可能留下孤立文件与保守预留空间，仍需运维清理；后台删除处理有文献记录的对象，不扫描整个桶。
