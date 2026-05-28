@echo off
cd /d "C:\Users\iamro\Desktop\Adarsh FInal Deploye"
python manage.py migrate --noinput
python scripts\create_admin.py
pause
