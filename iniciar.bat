@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias, esto solo pasa la primera vez...
  call npm install
)
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
