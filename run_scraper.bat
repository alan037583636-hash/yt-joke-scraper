@echo off
cd /d "C:\Users\User\Desktop\Automation scripts"
if errorlevel 1 exit /b 1

call npm start
if errorlevel 1 exit /b 1

git add latest_joke.json
git commit -m "chore: auto update daily joke from local"
git push
