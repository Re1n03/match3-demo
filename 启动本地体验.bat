@echo off
chcp 65001 >nul
title 三消关卡策划作品集 - 本地体验服务
echo ====================================================
echo   三消关卡系统设计作品集 · 本地游玩服务器正在启动...
echo ====================================================
echo.
echo 正在启动本地服务 (端口 8080)...
start http://localhost:8080/index.html
python -m http.server 8080
pause
