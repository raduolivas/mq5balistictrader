import { ForexPairInfo, MlFeature, RiskParameters, LinuxDeploymentStep } from '../types';

export const FOREX_PAIRS: ForexPairInfo[] = [
  {
    symbol: 'EUR/USD',
    description: 'Euro vs US Dollar - Highest Liquidity, Tightest Spreads',
    typicalSpreadPips: 0.2,
    pipValueUSD: 10.0,
    volatilityRating: 'Medium',
    activeSessions: ['London', 'New York']
  },
  {
    symbol: 'GBP/USD',
    description: 'British Pound vs US Dollar - High Volatility & Breakout Momentum',
    typicalSpreadPips: 0.7,
    pipValueUSD: 10.0,
    volatilityRating: 'High',
    activeSessions: ['London', 'New York']
  },
  {
    symbol: 'USD/JPY',
    description: 'US Dollar vs Japanese Yen - Asian/US Session Trend Follower',
    typicalSpreadPips: 0.4,
    pipValueUSD: 6.8,
    volatilityRating: 'Medium',
    activeSessions: ['Tokyo', 'New York']
  },
  {
    symbol: 'AUD/USD',
    description: 'Australian Dollar vs US Dollar - Commodity & Risk-On Sentiment',
    typicalSpreadPips: 0.6,
    pipValueUSD: 10.0,
    volatilityRating: 'Medium',
    activeSessions: ['Sydney', 'Tokyo', 'London']
  },
  {
    symbol: 'USD/CAD',
    description: 'US Dollar vs Canadian Dollar - Crude Oil Correlation',
    typicalSpreadPips: 0.8,
    pipValueUSD: 7.4,
    volatilityRating: 'Medium',
    activeSessions: ['New York']
  }
];

export const DEFAULT_ML_FEATURES: MlFeature[] = [
  {
    id: 'ofi_depth',
    name: 'Order Flow Imbalance (OFI)',
    category: 'OrderFlow',
    description: 'Difference between consecutive Bid and Ask queue depth changes at tick level.',
    importance: 0.32,
    enabled: true
  },
  {
    id: 'spread_zscore',
    name: 'Spread Z-Score',
    category: 'Microstructure',
    description: 'Normalized spread divergence against the 100-tick moving average (detects liquidity drying).',
    importance: 0.21,
    enabled: true
  },
  {
    id: 'atr_ratio',
    name: 'ATR Expansion Ratio',
    category: 'Volatility',
    description: 'Ratio of 5-period ATR over 50-period ATR measuring volatility breakout velocity.',
    importance: 0.18,
    enabled: true
  },
  {
    id: 'vwap_deviation',
    name: 'VWAP Standardized Deviation',
    category: 'Momentum',
    description: 'Distance in basis points from the session Volume-Weighted Average Price.',
    importance: 0.15,
    enabled: true
  },
  {
    id: 'tick_entropy',
    name: 'Tick Return Shannon Entropy',
    category: 'Microstructure',
    description: 'Quantifies randomness vs directional momentum in high-frequency tick returns.',
    importance: 0.14,
    enabled: true
  }
];

export const DEFAULT_RISK_PARAMS: RiskParameters = {
  maxAccountRiskPerTradePct: 1.0,
  maxDailyDrawdownPct: 2.0,
  stopLossAtrMultiplier: 1.5,
  takeProfitAtrMultiplier: 2.5,
  maxSpreadPips: 1.5,
  newsFilterMinutesBefore: 15,
  hardEquityStopLevel: 8000,
  maxSimultaneousTrades: 2
};

export const LINUX_DEPLOYMENT_STEPS: LinuxDeploymentStep[] = [
  {
    id: 1,
    title: 'Install Wine 9.0 & Headless Virtual Framebuffer (XVFB)',
    category: 'WINE/XVFB',
    command: `sudo dpkg --add-architecture i386
sudo mkdir -pm755 /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key
sudo wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/$(lsb_release -cs)/winehq-$(lsb_release -cs).sources
sudo apt update && sudo apt install -y --install-recommends winehq-staging xvfb xauth libzmq3-dev python3-pip python3-venv`,
    description: 'Installs Wine 9+ staging on Ubuntu 22.04 / 24.04 LTS to run MT5 headlessly in a virtual X11 display buffer.',
    notes: 'Enables 24/7 background MT5 terminal execution without requiring a physical monitor or GUI desktop.'
  },
  {
    id: 2,
    title: 'Setup Headless MetaTrader 5 Terminal Instance',
    category: 'WINE/XVFB',
    command: `# Initialize 64-bit Wine prefix
export WINEPREFIX=~/.wine-mt5
export WINEARCH=win64
winecfg

# Download & install broker MT5 setup silently
wget https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe
Xvfb :99 -screen 0 1024x768x16 &
DISPLAY=:99 wine mt5setup.exe /auto`,
    description: 'Downloads MT5 installer and sets up a dedicated clean 64-bit Wine environment.',
    notes: 'MT5 files will reside under ~/.wine-mt5/drive_c/Program Files/MetaTrader 5/'
  },
  {
    id: 3,
    title: 'Install Python ZeroMQ & High-Performance Quant Stack',
    category: 'Python Engine',
    command: `python3 -m venv ~/mt5_ai_env
source ~/mt5_ai_env/bin/activate
pip install --upgrade pip
pip install pyzmq lightgbm xgboost onnxruntime numpy pandas scipy scikit-learn websockets`,
    description: 'Installs high-throughput Python libraries for ZeroMQ IPC socket messaging, LightGBM/XGBoost inference, and ONNX runtime.',
    notes: 'PyZMQ provides sub-2ms socket communication between MT5 EA and the Python AI process.'
  },
  {
    id: 4,
    title: 'Create Systemd Auto-Restarting Service for AI Engine',
    category: 'Systemd',
    command: `sudo tee /etc/systemd/system/mt5-ai-engine.service << 'EOF'
[Unit]
Description=MetaTrader 5 Python AI Strategy Engine
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/mq5balistictrader/python
ExecStart=/home/ubuntu/mt5_ai_env/bin/python forex_ai_engine.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable mt5-ai-engine
sudo systemctl start mt5-ai-engine`,
    description: 'Configures Linux systemd daemon to keep your Python AI bot running 24/7 with automatic crash recovery.',
    notes: 'Restarts automatically in 3 seconds if disconnected.'
  },
  {
    id: 5,
    title: 'Kernel Network & TCP Socket Low-Latency Tuning',
    category: 'Latency Tuning',
    command: `sudo tee -a /etc/sysctl.conf << 'EOF'
# Low-latency TCP socket tuning for local ZeroMQ IPC & Broker FIX/MT5
net.ipv4.tcp_low_latency = 1
net.ipv4.tcp_fastopen = 3
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
EOF

sudo sysctl -p`,
    description: 'Optimizes Linux kernel TCP buffer sizes and network stack for microsecond packet turnaround.',
    notes: 'Reduces tick serialization jitter during London/NY market volatility overlaps.'
  }
];
