#!/bin/bash

# Setup Swap Memory for 1GB RAM Server
# =====================================
#
# CRITICAL: 2GB swap is required for memory spikes during:
# - Bulk uploads (XLSX + ZIP processing)
# - Large image exports
# - PDF generation
#
# Usage:
#   sudo bash setup_swap.sh
#
# To remove swap later:
#   sudo swapoff /swapfile
#   sudo rm /swapfile
#   sudo sed -i '/swapfile/d' /etc/fstab

set -e

# Configuration
SWAP_SIZE="2G"  # Recommended: 2x RAM for 1GB server
SWAP_FILE="/swapfile"

echo "=== Swap Memory Setup for 1GB RAM Server ==="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Please run as root (sudo bash setup_swap.sh)"
    exit 1
fi

# Check current swap
echo "Current swap status:"
free -h | grep -i swap
swapon --show 2>/dev/null || echo "(no swap currently)"
echo ""

# Check if swap file already exists
if [ -f "$SWAP_FILE" ]; then
    echo "Swap file already exists at $SWAP_FILE"
    echo "Current swap size: $(ls -lh $SWAP_FILE | awk '{print $5}')"
    read -p "Do you want to recreate it? (y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "Exiting without changes."
        exit 0
    fi
    
    # Disable existing swap
    echo "Disabling existing swap..."
    swapoff "$SWAP_FILE" 2>/dev/null || true
    rm -f "$SWAP_FILE"
fi

# Check available disk space
echo "Checking disk space..."
AVAILABLE=$(df / | tail -1 | awk '{print $4}')
REQUIRED=$((2 * 1024 * 1024))  # 2GB in KB

if [ "$AVAILABLE" -lt "$REQUIRED" ]; then
    echo "WARNING: Less than 2GB available disk space!"
    echo "Available: $((AVAILABLE / 1024))MB"
    echo "Continuing with smaller swap..."
    SWAP_SIZE="1G"
fi

# Create swap file
echo "Creating ${SWAP_SIZE} swap file at ${SWAP_FILE}..."
fallocate -l "$SWAP_SIZE" "$SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=2048 status=progress

# Set correct permissions (CRITICAL for security)
echo "Setting permissions..."
chmod 600 "$SWAP_FILE"

# Setup swap space
echo "Formatting swap space..."
mkswap "$SWAP_FILE"

# Enable swap
echo "Enabling swap..."
swapon "$SWAP_FILE"

# Make permanent (survives reboot)
echo "Making swap permanent..."
if ! grep -q "$SWAP_FILE" /etc/fstab; then
    echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
fi

# Optimize swap settings for Django/Python workload
echo "Optimizing swap settings..."

# Swappiness: How aggressively to use swap
# Lower value = prefer RAM, only swap when necessary
# 10 is good for Django servers
if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
    echo "vm.swappiness=10" >> /etc/sysctl.conf
fi
sysctl vm.swappiness=10

# VFS cache pressure: How aggressively to reclaim memory from file cache
# 50 = balanced between file cache and process memory
if ! grep -q "vm.vfs_cache_pressure" /etc/sysctl.conf; then
    echo "vm.vfs_cache_pressure=50" >> /etc/sysctl.conf
fi
sysctl vm.vfs_cache_pressure=50

# Verify setup
echo ""
echo "=== Swap Setup Complete ==="
echo ""
echo "New swap status:"
free -h | grep -i swap
swapon --show
echo ""
echo "Swappiness: $(cat /proc/sys/vm/swappiness)"
echo "VFS Cache Pressure: $(cat /proc/sys/vm/vfs_cache_pressure)"
echo ""
echo "Swap is now active and will persist across reboots."
echo ""
echo "IMPORTANT: For 1GB RAM servers with bulk operations:"
echo "  - Keep Gunicorn workers=1"
echo "  - Background worker max_workers=1"
echo "  - Monitor memory with: htop or free -m"
