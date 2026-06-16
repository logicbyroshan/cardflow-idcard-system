$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$ScriptDir\.."
& ".\.venv\Scripts\python.exe" manage.py runserver 127.0.0.1:8000
