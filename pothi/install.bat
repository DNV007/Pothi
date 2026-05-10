@echo off
REM Pothi installer — Windows.
REM Creates a Start-menu shortcut + a clickable .bat on the Desktop.
REM Requires Python 3 on PATH.

setlocal
set "DIR=%~dp0app"
set "PORT=8765"

REM Trim trailing backslash on DIR
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

REM Sanity check
where python >nul 2>nul || (
  echo Python is not on PATH. Install Python 3 from python.org and re-run install.bat.
  exit /b 1
)

set "DESK=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"

REM Write the desktop launcher
> "%DESK%\Pothi.bat" (
  echo @echo off
  echo set "DIR=%DIR%"
  echo set "PORT=%PORT%"
  echo cd /d "%%DIR%%"
  echo start "Pothi server" /min cmd /c "python -m http.server %%PORT%% --bind 127.0.0.1"
  echo timeout /t 1 ^>nul
  echo start "" "http://127.0.0.1:%%PORT%%/"
  echo exit /b 0
)

REM Mirror to Start menu
copy /y "%DESK%\Pothi.bat" "%STARTMENU%\Pothi.bat" >nul

echo.
echo Installed:
echo   %DESK%\Pothi.bat        ^(double-click on Desktop^)
echo   %STARTMENU%\Pothi.bat   ^(searchable from Start^)
echo.
echo Run Pothi by double-clicking either, or from cmd: Pothi
echo To stop: close the small "Pothi server" window in the taskbar.
endlocal
