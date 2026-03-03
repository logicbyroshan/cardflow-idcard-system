# Deployment Configuration Files for 1GB RAM Server
# ================================================
# 
# This directory contains configuration templates for deploying the application
# on a memory-constrained server (1GB RAM).
#
# CRITICAL SETTINGS FOR 1GB RAM:
# - Gunicorn: workers=1, threads=2
# - Background Worker: ThreadPoolExecutor(max_workers=1)
# - Swap: 2GB recommended
# - Nginx: Long timeouts for bulk operations
#
# File Structure:
# - nginx.conf - Nginx configuration template
# - gunicorn.conf.py - Gunicorn configuration
# - setup_swap.sh - Script to setup swap memory
# - cron_cleanup.txt - Cron job for periodic cleanup
#
# ==============================================================================
# SYSTEM DEPENDENCIES (Run BEFORE pip install)
# ==============================================================================
#
# WeasyPrint PDF Export Dependencies (Ubuntu/Debian):
# ---------------------------------------------------
# WeasyPrint requires GTK/Pango/Cairo system libraries for PDF rendering.
# Run these commands BEFORE installing Python packages:
#
#   sudo apt-get update
#   sudo apt-get install -y \
#       libpango-1.0-0 \
#       libpangoft2-1.0-0 \
#       libpangocairo-1.0-0 \
#       libgdk-pixbuf2.0-0 \
#       libffi-dev \
#       shared-mime-info \
#       libcairo2 \
#       libharfbuzz0b \
#       libfontconfig1 \
#       fonts-liberation \
#       fonts-dejavu-core
#
# For CentOS/RHEL/Amazon Linux:
#   sudo yum install -y \
#       pango \
#       cairo \
#       gdk-pixbuf2 \
#       libffi-devel \
#       harfbuzz \
#       fontconfig \
#       liberation-fonts
#
# Verify WeasyPrint works:
#   python -c "from weasyprint import HTML; print('WeasyPrint OK')"
#
# If WeasyPrint fails, xhtml2pdf is used as automatic fallback (no system deps).
#
# ==============================================================================
#
# Deployment Steps:
# 1. Install system dependencies (see above)
# 2. Setup swap memory: sudo bash setup_swap.sh
# 3. Configure Nginx: Copy nginx.conf to /etc/nginx/sites-available/
# 4. Configure Gunicorn: Use gunicorn.conf.py with systemd service
# 5. Setup cron: crontab -e < cron_cleanup.txt
# 6. Run migrations: python manage.py migrate
# 7. Start services: sudo systemctl restart nginx gunicorn

