@echo off
title CTV Chat - http://localhost:3000
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] May chua cai Node.js.
  echo       Tai ban LTS tai https://nodejs.org , cai xong bam lai file nay.
  echo.
  start "" https://nodejs.org/
  pause
  exit /b
)
echo.
echo   Dang mo CTV Chat tai http://localhost:3000 ...
echo   GIU CUA SO NAY MO trong luc moi nguoi dang dung app.
echo   Tat app: bam Ctrl + C (du lieu da duoc luu lien tuc).
echo.
node server.js
pause
