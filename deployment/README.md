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
# Deployment Steps:
# 1. Setup swap memory: sudo bash setup_swap.sh
# 2. Configure Nginx: Copy nginx.conf to /etc/nginx/sites-available/
# 3. Configure Gunicorn: Use gunicorn.conf.py with systemd service
# 4. Setup cron: crontab -e < cron_cleanup.txt
# 5. Run migrations: python manage.py migrate
# 6. Start services: sudo systemctl restart nginx gunicorn
