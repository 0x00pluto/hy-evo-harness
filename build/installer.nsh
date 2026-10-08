; 首次安装与自动更新完成后，默认优先通过开始菜单 .lnk 拉起应用。
; 部分 Windows 环境下 ExecShellAsUser 打开 .lnk 会报「该文件没有与之关联的应用」。
; 改为直接启动安装目录中的 exe，保留非提权启动与 --updated 参数。
!macro customInstall
  StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!macroend
