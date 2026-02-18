#!/bin/bash
# bjorn_bluetooth_manager.sh
# Script to configure Bluetooth PAN for BJORN
# Usage: ./bjorn_bluetooth_manager.sh -f
#        ./bjorn_bluetooth_manager.sh -u
#        ./bjorn_bluetooth_manager.sh -l
#        ./bjorn_bluetooth_manager.sh -h
# Author: Infinition
# Version: 1.1
# Description: This script configures and manages Bluetooth PAN for BJORN

# ============================================================
# Colors for Output
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================
# Logging Configuration
# ============================================================
LOG_DIR="/var/log/bjorn_install"
LOG_FILE="$LOG_DIR/bjorn_bluetooth_manager_$(date +%Y%m%d_%H%M%S).log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# ============================================================
# Logging Function
# ============================================================
log() {
    local level=$1
    shift
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*"
    echo -e "$message" | tee -a "$LOG_FILE"
    case $level in
        "ERROR") echo -e "${RED}$message${NC}" ;;
        "SUCCESS") echo -e "${GREEN}$message${NC}" ;;
        "WARNING") echo -e "${YELLOW}$message${NC}" ;;
        "INFO") echo -e "${BLUE}$message${NC}" ;;
        "CYAN") echo -e "${CYAN}$message${NC}" ;;
        *) echo -e "$message" ;;
    esac
}

# ============================================================
# Error Handling
# ============================================================
handle_error() {
    local error_message=$1
    log "ERROR" "$error_message"
    exit 1
}

# ============================================================
# Function to Check Command Success
# ============================================================
check_success() {
    if [ $? -eq 0 ]; then
        log "SUCCESS" "$1"
        return 0
    else
        handle_error "$1"
        return $?
    fi
}

# ============================================================
# Function to Show Usage
# ============================================================
show_usage() {
    echo -e "${GREEN}Usage: $0 [OPTIONS]${NC}"
    echo -e "Options:"
    echo -e "  ${BLUE}-f${NC}    Install Bluetooth PAN"
    echo -e "  ${BLUE}-u${NC}    Uninstall Bluetooth PAN"
    echo -e "  ${BLUE}-l${NC}    List Bluetooth PAN Information"
    echo -e "  ${BLUE}-h${NC}    Show this help message"
    echo -e ""
    echo -e "Example:"
    echo -e "  $0 -f    Install Bluetooth PAN"
    echo -e "  $0 -u    Uninstall Bluetooth PAN"
    echo -e "  $0 -l    List Bluetooth PAN Information"
    echo -e "  $0 -h    Show help"
    echo -e ""
    echo -e "${YELLOW}===== Bluetooth PAN Configuration Procedure =====${NC}"
    echo -e "To configure the Bluetooth PAN driver and set the IP address, subnet mask, and gateway for the PAN network interface card, follow the steps below:"
    echo -e ""
    echo -e "1. **Configure IP Address on the Server (Pi):**"
    echo -e "   - The default IP address is set in the script as follows:"
    echo -e "     - IP: 172.20.2.1"
    echo -e "     - Subnet Mask: 255.255.255.0"
    echo -e ""
    echo -e "2. **Configure IP Address on the Host Computer:**"
    echo -e "   - On your host computer (Windows, Linux, etc.), configure the RNDIS network interface to use an IP address in the same subnet. For example:"
    echo -e "     - IP: 172.20.2.2"
    echo -e "     - Subnet Mask: 255.255.255.0"
    echo -e "     - Gateway: 172.20.2.1"
    echo -e "     - DNS Servers: 8.8.8.8, 8.8.4.4"
    echo -e ""
    echo -e "3. **Restart the Service:**"
    echo -e "   - After installing the Bluetooth PAN, restart the service to apply the changes:"
    echo -e "     ```bash"
    echo -e "     sudo systemctl restart auto_bt_connect.service"
    echo -e "     ```"
    echo -e ""
    echo -e "4. **Verify the Connection:**"
    echo -e "   - Ensure that the PAN network interface is active on both devices."
    echo -e "   - Test connectivity by pinging the IP address of the other device."
    echo -e "     - From the Pi: \`ping 172.20.2.2\`"
    echo -e "     - From the host computer: \`ping 172.20.2.1\`"
    echo -e ""
    echo -e "===== End of Procedure =====${NC}"
    exit 1
}

# ============================================================
# Function to Install Bluetooth PAN
# ============================================================
install_bluetooth_pan() {
    log "INFO" "Starting Bluetooth PAN installation..."

    # Ensure the script is run as root
    if [ "$(id -u)" -ne 0 ]; then
        log "ERROR" "This script must be run as root. Please use 'sudo'."
        exit 1
    fi

    # Create settings directory
    SETTINGS_DIR="/home/bjorn/.settings_bjorn"
    if [ ! -d "$SETTINGS_DIR" ]; then
        mkdir -p "$SETTINGS_DIR"
        check_success "Created settings directory at $SETTINGS_DIR"
    else
        log "INFO" "Settings directory $SETTINGS_DIR already exists. Skipping creation."
    fi

    # Create bt.json if it doesn't exist
    BT_CONFIG="$SETTINGS_DIR/bt.json"
    if [ ! -f "$BT_CONFIG" ]; then
        log "INFO" "Creating Bluetooth configuration file at $BT_CONFIG"
        cat << 'EOF' > "$BT_CONFIG"
{
    "device_mac": "AA:BB:CC:DD:EE:FF"  # Replace with your device's MAC address
}
EOF
        check_success "Created Bluetooth configuration file at $BT_CONFIG"
        log "WARNING" "Please edit $BT_CONFIG to include your Bluetooth device's MAC address."
    else
        log "INFO" "Bluetooth configuration file $BT_CONFIG already exists. Skipping creation."
    fi

    # Create auto_bt_connect.py
    BT_PY_SCRIPT="/usr/local/bin/auto_bt_connect.py"
    if [ ! -f "$BT_PY_SCRIPT" ]; then
        log "INFO" "Creating Bluetooth auto-connect Python script at $BT_PY_SCRIPT"
        cat << 'EOF' > "$BT_PY_SCRIPT"
#!/usr/bin/env python3
import json
import subprocess
import time
import logging
import os

LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
logging.basicConfig(filename="/var/log/auto_bt_connect.log", level=logging.INFO, format=LOG_FORMAT)
logger = logging.getLogger("auto_bt_connect")

CONFIG_PATH = "/home/bjorn/.settings_bjorn/bt.json"
CHECK_INTERVAL = 30  # Interval in seconds between each check

def ensure_bluetooth_service():
    try:
        res = subprocess.run(["systemctl", "is-active", "bluetooth"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if "active" not in res.stdout:
            logger.info("Bluetooth service not active. Starting and enabling it...")
            start_res = subprocess.run(["systemctl", "start", "bluetooth"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if start_res.returncode != 0:
                logger.error(f"Failed to start bluetooth service: {start_res.stderr}")
                return False

            enable_res = subprocess.run(["systemctl", "enable", "bluetooth"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if enable_res.returncode != 0:
                logger.error(f"Failed to enable bluetooth service: {enable_res.stderr}")
                # Not fatal, but log it.
            else:
                logger.info("Bluetooth service enabled successfully.")
        else:
            logger.info("Bluetooth service is already active.")
        return True
    except Exception as e:
        logger.error(f"Error ensuring bluetooth service: {e}")
        return False

def is_already_connected():
    # Check if bnep0 interface is up with an IP
    ip_res = subprocess.run(["ip", "addr", "show", "bnep0"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if ip_res.returncode == 0 and "inet " in ip_res.stdout:
        # bnep0 interface exists and has an IPv4 address
        logger.info("bnep0 is already up and has an IP. No action needed.")
        return True
    return False

def run_in_background(cmd):
    # Run a command in background, return the process
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return process

def establish_connection(device_mac):
    # Attempt to run bt-network
    logger.info(f"Attempting to connect PAN with device {device_mac}...")
    bt_process = run_in_background(["bt-network", "-c", device_mac, "nap"])
    # Wait a bit for PAN to set up
    time.sleep(3)

    # Check if bt-network exited prematurely
    if bt_process.poll() is not None:
        # Process ended
        if bt_process.returncode != 0:
            stderr_output = bt_process.stderr.read() if bt_process.stderr else ""
            logger.error(f"bt-network failed: {stderr_output}")
            return False
        else:
            logger.warning("bt-network ended immediately. PAN may not be established.")
            return False
    else:
        logger.info("bt-network running in background...")

    # Now run dhclient for IPv4
    dh_res = subprocess.run(["dhclient", "-4", "bnep0"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if dh_res.returncode != 0:
        logger.error(f"dhclient failed: {dh_res.stderr}")
        return False

    logger.info("Successfully obtained IP on bnep0. PAN connection established.")
    return True

def load_config():
    if not os.path.exists(CONFIG_PATH):
        logger.error(f"Config file {CONFIG_PATH} not found.")
        return None

    try:
        with open(CONFIG_PATH, "r") as f:
            config = json.load(f)
        device_mac = config.get("device_mac")
        if not device_mac:
            logger.error("No device_mac found in config.")
            return None
        return device_mac
    except Exception as e:
        logger.error(f"Error loading config: {e}")
        return None

def main():
    device_mac = load_config()
    if not device_mac:
        return

    while True:
        try:
            if not ensure_bluetooth_service():
                logger.error("Bluetooth service setup failed.")
            elif is_already_connected():
                # Already connected and has IP, do nothing
                pass
            else:
                # Attempt to establish connection
                success = establish_connection(device_mac)
                if not success:
                    logger.warning("Failed to establish PAN connection.")

        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}")

        # Wait before the next check
        time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    main()
EOF
        check_success "Created Bluetooth auto-connect Python script at $BT_PY_SCRIPT"
    else
        log "INFO" "Bluetooth auto-connect Python script $BT_PY_SCRIPT already exists. Skipping creation."
    fi

    # Make the Python script executable
    chmod +x "$BT_PY_SCRIPT"
    check_success "Made Python script executable at $BT_PY_SCRIPT"

    # Create the systemd service
    BT_SERVICE="/etc/systemd/system/auto_bt_connect.service"
    if [ ! -f "$BT_SERVICE" ]; then
        log "INFO" "Creating systemd service at $BT_SERVICE"
        cat << 'EOF' > "$BT_SERVICE"
[Unit]
Description=Auto Bluetooth PAN Connect
After=network.target bluetooth.service
Wants=bluetooth.service

[Service]
Type=simple
ExecStart=/usr/local/bin/auto_bt_connect.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
        check_success "Created systemd service at $BT_SERVICE"
    else
        log "INFO" "Systemd service $BT_SERVICE already exists. Skipping creation."
    fi

    # Reload systemd daemon
    systemctl daemon-reload
    check_success "Reloaded systemd daemon"

    # Enable and start the service
    systemctl enable auto_bt_connect.service
    check_success "Enabled auto_bt_connect.service"

    systemctl start auto_bt_connect.service
    check_success "Started auto_bt_connect.service"

    echo -e "${GREEN}Bluetooth PAN installation completed successfully. A reboot is required for changes to take effect.${NC}"
}

# ============================================================
# Function to Uninstall Bluetooth PAN
# ============================================================
uninstall_bluetooth_pan() {
    log "INFO" "Starting Bluetooth PAN uninstallation..."

    # Ensure the script is run as root
    if [ "$(id -u)" -ne 0 ]; then
        log "ERROR" "This script must be run as root. Please use 'sudo'."
        exit 1
    fi

    BT_SERVICE="/etc/systemd/system/auto_bt_connect.service"
    BT_PY_SCRIPT="/usr/local/bin/auto_bt_connect.py"
    SETTINGS_DIR="/home/bjorn/.settings_bjorn"
    BT_CONFIG="$SETTINGS_DIR/bt.json"

    # Stop and disable the service
    if systemctl is-active --quiet auto_bt_connect.service; then
        systemctl stop auto_bt_connect.service
        check_success "Stopped auto_bt_connect.service"
    else
        log "INFO" "auto_bt_connect.service is not running."
    fi

    if systemctl is-enabled --quiet auto_bt_connect.service; then
        systemctl disable auto_bt_connect.service
        check_success "Disabled auto_bt_connect.service"
    else
        log "INFO" "auto_bt_connect.service is not enabled."
    fi

    # Remove the systemd service file
    if [ -f "$BT_SERVICE" ]; then
        rm "$BT_SERVICE"
        check_success "Removed $BT_SERVICE"
    else
        log "INFO" "$BT_SERVICE does not exist. Skipping removal."
    fi

    # Remove the Python script
    if [ -f "$BT_PY_SCRIPT" ]; then
        rm "$BT_PY_SCRIPT"
        check_success "Removed $BT_PY_SCRIPT"
    else
        log "INFO" "$BT_PY_SCRIPT does not exist. Skipping removal."
    fi

    # Remove Bluetooth configuration directory and file
    if [ -d "$SETTINGS_DIR" ]; then
        rm -rf "$SETTINGS_DIR"
        check_success "Removed settings directory at $SETTINGS_DIR"
    else
        log "INFO" "Settings directory $SETTINGS_DIR does not exist. Skipping removal."
    fi

    # Reload systemd daemon
    systemctl daemon-reload
    check_success "Reloaded systemd daemon"

    log "SUCCESS" "Bluetooth PAN uninstallation completed successfully."
}

# ============================================================
# Function to List Bluetooth PAN Information
# ============================================================
list_bluetooth_pan_info() {
    echo -e "${CYAN}===== Bluetooth PAN Information =====${NC}"

    BT_SERVICE="/etc/systemd/system/auto_bt_connect.service"
    BT_PY_SCRIPT="/usr/local/bin/auto_bt_connect.py"
    BT_CONFIG="/home/bjorn/.settings_bjorn/bt.json"

    # Check status of auto_bt_connect.service
    echo -e "\n${YELLOW}Service Status:${NC}"
    if systemctl list-units --type=service | grep -q auto_bt_connect.service; then
        systemctl status auto_bt_connect.service --no-pager
    else
        echo -e "${RED}auto_bt_connect.service is not installed.${NC}"
    fi

    # Check if Bluetooth auto-connect Python script exists
    echo -e "\n${YELLOW}Bluetooth Auto-Connect Script:${NC}"
    if [ -f "$BT_PY_SCRIPT" ]; then
        echo -e "${GREEN}$BT_PY_SCRIPT exists.${NC}"
    else
        echo -e "${RED}$BT_PY_SCRIPT does not exist.${NC}"
    fi

    # Check Bluetooth configuration file
    echo -e "\n${YELLOW}Bluetooth Configuration File:${NC}"
    if [ -f "$BT_CONFIG" ]; then
        echo -e "${GREEN}$BT_CONFIG exists.${NC}"
        echo -e "${CYAN}Contents:${NC}"
        cat "$BT_CONFIG"
    else
        echo -e "${RED}$BT_CONFIG does not exist.${NC}"
    fi

    echo -e "\n===== End of Information ====="
}

# ============================================================
# Function to Display the Main Menu
# ============================================================
display_main_menu() {
    while true; do
        clear
        echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║      Bluetooth PAN Manager Menu         ║${NC}"
        echo -e "${BLUE}╠════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║${NC} 1. Install Bluetooth PAN               ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 2. Uninstall Bluetooth PAN             ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 3. List Bluetooth PAN Information      ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 4. Show Help                            ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 5. Exit                                 ${BLUE}║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
        echo -e "Note: Ensure you run this script as root."
        echo -e "${YELLOW}Usage: $0 [OPTIONS] (use -h for help)${NC}"
        echo -n -e "${GREEN}Please choose an option (1-5): ${NC}"
        read choice

        case $choice in
            1)
                install_bluetooth_pan
                echo ""
                read -p "Press Enter to return to the menu..."
                ;;
            2)
                uninstall_bluetooth_pan
                echo ""
                read -p "Press Enter to return to the menu..."
                ;;
            3)
                list_bluetooth_pan_info
                echo ""
                read -p "Press Enter to return to the menu..."
                ;;
            4)
                show_usage
                ;;
            5)
                log "INFO" "Exiting Bluetooth PAN Manager. Goodbye!"
                exit 0
                ;;
            *)
                log "ERROR" "Invalid option. Please choose between 1-5."
                sleep 2
                ;;
        esac
    done
}

# ============================================================
# Process Command Line Arguments
# ============================================================
while getopts ":fulh" opt; do
  case $opt in
    f)
      install_bluetooth_pan
      exit 0
      ;;
    u)
      uninstall_bluetooth_pan
      exit 0
      ;;
    l)
      list_bluetooth_pan_info
      exit 0
      ;;
    h)
      show_usage
      ;;
    \?)
      echo -e "${RED}Invalid option: -$OPTARG${NC}" >&2
      show_usage
      ;;
  esac
done

# ============================================================
# Main Execution
# ============================================================
# If no arguments are provided, display the menu
if [ $OPTIND -eq 1 ]; then
    display_main_menu
fi
