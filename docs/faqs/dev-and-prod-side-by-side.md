### **Q: 安装包开着时 `pnpm start` 为什么一闪就退？开发版和生产版能同时开吗？**

**A:**
可以同时开。未打包的 `pnpm start` 使用独立应用名 **Dex Buddy Dev** 和独立用户数据目录，不再和已安装的 Dex Buddy 抢同一把单实例锁。开发版自己仍然只允许一个实例。

**问题症状：**
- 已安装的 Dex Buddy 正在运行
- 仓库里 `pnpm start` 立刻回到提示符，没有 `[Dex Buddy INFO] 挂载插件`
- 终端退出码是 0，也没有堆栈

**根本原因：**
Electron 用应用名和 `userData` 做单实例锁。拿不到锁就 `app.quit()`，以前也不打日志。未打包进程跑的是 `node_modules` 里的 Electron，锁可能和安装包、其他 `electron .`、或没退干净的旧进程撞上。

**解决方案：**
未打包启动时（在请求锁之前）把名字设为 `Dex Buddy Dev`，`userData` 设为 `~/Library/Application Support/Dex Buddy Dev`（Windows 在 `%APPDATA%\Dex Buddy Dev`）。安装包仍用 `com.huyuan.dexbuddy` / `Dex Buddy`，更新身份不变。

再开一次 `pnpm start` 会立刻退出，终端写「Dex Buddy 开发版已在运行」，已开的那扇窗被唤到前面。

两边仍登记同一个 `dexbuddy://` 登录回调：后启动的那份成为系统默认处理者。安装包再启动时会重新登记自己。

不要把旧的 `Electron` 或 `dex-buddy` 用户目录自动迁过来。第一次用这个身份时，开发版的插件列表和登录态是空的，和安装包分开。
