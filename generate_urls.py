import re

with open('mobile_app/urls.py', 'r') as f:
    lines = f.readlines()

new_lines = [
    "from django.urls import path\n",
    "from . import views\n\n",
    "app_name = 'mobile_api'\n\n",
    "urlpatterns = [\n"
]

for line in lines:
    if "path(" in line and "'api/" in line:
        line = line.replace("'api/", "'")
        new_lines.append(line)

new_lines.append("]\n")

with open('mobile_api/urls.py', 'w') as f:
    f.writelines(new_lines)
