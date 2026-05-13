@echo off
REM Pothi installer — Windows.
REM Creates a Start-menu shortcut + a clickable .bat on the Desktop.
REM Uses dist\Pothi.exe when present; otherwise requires Python 3 on PATH.

setlocal
set "ROOT=%~dp0"

REM Trim trailing backslash on ROOT
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "DIR=%ROOT%\app"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

set "HAS_BUNDLE="
if exist "%ROOT%\dist\Pothi.exe" set "HAS_BUNDLE=1"
if exist "%ROOT%\dist\Pothi" set "HAS_BUNDLE=1"

if not defined HAS_BUNDLE (
  where python >nul 2>nul || (
  echo Python is not on PATH. Install Python 3 from python.org and re-run install.bat.
  exit /b 1
  )
)

set "DESK=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"

REM Write the desktop launcher
> "%DESK%\Pothi.cmd" (
  echo @echo off
  echo set "ROOT=%ROOT%"
  echo set "DIR=%DIR%"
  echo if exist "%%ROOT%%\dist\Pothi.exe" ^(
  echo   "%%ROOT%%\dist\Pothi.exe" start
  echo   exit /b %%ERRORLEVEL%%
  echo ^)
  echo if exist "%%ROOT%%\dist\Pothi" ^(
  echo   "%%ROOT%%\dist\Pothi" start
  echo   exit /b %%ERRORLEVEL%%
  echo ^)
  echo python "%%DIR%%\pothi_launcher.py" start
)

REM Mirror to Start menu
copy /y "%DESK%\Pothi.cmd" "%STARTMENU%\Pothi.cmd" >nul

REM Add a stop launcher too
> "%DESK%\Pothi Stop.cmd" (
  echo @echo off
  echo set "ROOT=%ROOT%"
  echo set "DIR=%DIR%"
  echo if exist "%%ROOT%%\dist\Pothi.exe" ^(
  echo   "%%ROOT%%\dist\Pothi.exe" stop
  echo   exit /b %%ERRORLEVEL%%
  echo ^)
  echo if exist "%%ROOT%%\dist\Pothi" ^(
  echo   "%%ROOT%%\dist\Pothi" stop
  echo   exit /b %%ERRORLEVEL%%
  echo ^)
  echo python "%%DIR%%\pothi_launcher.py" stop
)
copy /y "%DESK%\Pothi Stop.cmd" "%STARTMENU%\Pothi Stop.cmd" >nul

echo.
echo Installed:
echo   %DESK%\Pothi.cmd        ^(double-click on Desktop^)
echo   %STARTMENU%\Pothi.cmd   ^(searchable from Start^)
echo   %DESK%\Pothi Stop.cmd   ^(stop the server^)
echo.
echo Run Pothi by double-clicking the launcher, or from cmd: python "%DIR%\pothi_launcher.py" start
echo To stop: run the stop launcher or python "%DIR%\pothi_launcher.py" stop
endlocal
