#!/usr/bin/env bash
set -e

echo "=================================================================="
echo "  Setting up MetaTrader 5 + Python AI Environment on Ubuntu LTS  "
echo "=================================================================="

# 1. Update and install core build tools
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential git wget curl xvfb xauth libzmq3-dev libzmq5 python3-pip python3-venv

# 2. Install Wine 9.0 Staging
sudo dpkg --add-architecture i386
sudo mkdir -pm755 /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key
sudo wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/$(lsb_release -cs)/winehq-$(lsb_release -cs).sources
sudo apt update && sudo apt install -y --install-recommends winehq-staging

# 3. Setup Python Virtual Environment
python3 -m venv ~/mt5_ai_env
source ~/mt5_ai_env/bin/activate
pip install --upgrade pip
pip install -r ../python/requirements.txt

# 4. Low-latency TCP socket tuning
sudo tee -a /etc/sysctl.conf << 'EOF'
net.ipv4.tcp_low_latency = 1
net.ipv4.tcp_fastopen = 3
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
EOF
sudo sysctl -p

echo "=== Setup complete! MT5 and Python AI Engine are ready ==="
