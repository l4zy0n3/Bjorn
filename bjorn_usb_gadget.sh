#!/bin/bash
# bjorn_usb_gadget.sh
# Script to configure USB Gadget for BJORN
# Usage: ./bjorn_usb_gadget.sh -f
#        ./bjorn_usb_gadget.sh -u
#        ./bjorn_usb_gadget.sh -l
#        ./bjorn_usb_gadget.sh -h
# Author: Infinition
# Version: 1.4
# Description: This script configures and manages USB Gadget for BJORN with duplicate prevention

# ============================================================
# Colors for Output
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================
# Logging Configuration
# ============================================================
LOG_DIR="/var/log/bjorn_install"
LOG_FILE="$LOG_DIR/bjorn_usb_gadget_$(date +%Y%m%d_%H%M%S).log"

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
    echo -e "  ${BLUE}-f${NC}    Install USB Gadget"
    echo -e "  ${BLUE}-u${NC}    Uninstall USB Gadget"
    echo -e "  ${BLUE}-l${NC}    List USB Gadget Information"
    echo -e "  ${BLUE}-h${NC}    Show this help message"
    echo -e ""
    echo -e "Example:"
    echo -e "  $0 -f    Install USB Gadget"
    echo -e "  $0 -u    Uninstall USB Gadget"
    echo -e "  $0 -l    List USB Gadget Information"
    echo -e "  $0 -h    Show help"
    echo -e ""
    echo -e "${YELLOW}===== RNDIS Configuration Procedure =====${NC}"
    echo -e "To configure the RNDIS driver and set the IP address, subnet mask, and gateway for the RNDIS network interface card, follow the steps below:"
    echo -e ""
    echo -e "1. **Configure IP Address on the Server (Pi):**"
    echo -e "   - The default IP address is set in the script as follows:"
    echo -e "     - IP: 172.20.2.1"
    echo -e "     - Subnet Mask: 255.255.255.0"
    echo -e "     - Gateway: 172.20.2.1"
    echo -e ""
    echo -e "2. **Configure IP Address on the Host Computer:**"
    echo -e "   - On your host computer (Windows, Linux, etc.), configure the RNDIS network interface to use an IP address in the same subnet. For example:"
    echo -e "     - IP: 172.20.2.2"
    echo -e "     - Subnet Mask: 255.255.255.0"
    echo -e "     - Gateway: 172.20.2.1"
    echo -e ""
    echo -e "3. **Restart the Service:**"
    echo -e "   - After installing the USB gadget, restart the service to apply the changes:"
    echo -e "     ```bash"
    echo -e "     sudo systemctl restart usb-gadget.service"
    echo -e "     ```"
    echo -e ""
    echo -e "4. **Verify the Connection:**"
    echo -e "   - Ensure that the RNDIS network interface is active on both devices."
    echo -e "   - Test connectivity by pinging the IP address of the other device."
    echo -e "     - From the Pi: \`ping 172.20.2.2\`"
    echo -e "     - From the host computer: \`ping 172.20.2.1\`"
    echo -e ""
    echo -e "===== End of Procedure =====${NC}"
    exit 1
}

# ============================================================
# Function to Install USB Gadget with RNDIS
# ============================================================
install_usb_gadget() {
    log "INFO" "Starting USB Gadget installation..."

    # Ensure the script is run as root
    if [ "$(id -u)" -ne 0 ]; then
        log "ERROR" "This script must be run as root. Please use 'sudo'."
        exit 1
    fi

    # Backup cmdline.txt and config.txt if not already backed up
    if [ ! -f /boot/firmware/cmdline.txt.bak ]; then
        cp /boot/firmware/cmdline.txt /boot/firmware/cmdline.txt.bak
        check_success "Backed up /boot/firmware/cmdline.txt to /boot/firmware/cmdline.txt.bak"
    else
        log "INFO" "/boot/firmware/cmdline.txt.bak already exists. Skipping backup."
    fi

    if [ ! -f /boot/firmware/config.txt.bak ]; then
        cp /boot/firmware/config.txt /boot/firmware/config.txt.bak
        check_success "Backed up /boot/firmware/config.txt to /boot/firmware/config.txt.bak"
    else
        log "INFO" "/boot/firmware/config.txt.bak already exists. Skipping backup."
    fi

    # Modify cmdline.txt: Remove existing modules-load entries related to dwc2
    log "INFO" "Cleaning up existing modules-load entries in /boot/firmware/cmdline.txt"
    sudo sed -i '/modules-load=dwc2,g_rndis/d' /boot/firmware/cmdline.txt
    sudo sed -i '/modules-load=dwc2,g_ether/d' /boot/firmware/cmdline.txt
    check_success "Removed duplicate modules-load entries from /boot/firmware/cmdline.txt"

    # Add a single modules-load=dwc2,g_rndis if not present
    if ! grep -q "modules-load=dwc2,g_rndis" /boot/firmware/cmdline.txt; then
        sudo sed -i 's/rootwait/rootwait modules-load=dwc2,g_rndis/' /boot/firmware/cmdline.txt
        check_success "Added modules-load=dwc2,g_rndis to /boot/firmware/cmdline.txt"
    else
        log "INFO" "modules-load=dwc2,g_rndis already present in /boot/firmware/cmdline.txt"
    fi

    # Add a single modules-load=dwc2,g_ether if not present
    if ! grep -q "modules-load=dwc2,g_ether" /boot/firmware/cmdline.txt; then
        sudo sed -i 's/rootwait/rootwait modules-load=dwc2,g_ether/' /boot/firmware/cmdline.txt
        check_success "Added modules-load=dwc2,g_ether to /boot/firmware/cmdline.txt"
    else
        log "INFO" "modules-load=dwc2,g_ether already present in /boot/firmware/cmdline.txt"
    fi

    # Modify config.txt: Remove duplicate dtoverlay=dwc2 entries
    log "INFO" "Cleaning up existing dtoverlay=dwc2 entries in /boot/firmware/config.txt"
    sudo sed -i '/^dtoverlay=dwc2$/d' /boot/firmware/config.txt
    check_success "Removed duplicate dtoverlay=dwc2 entries from /boot/firmware/config.txt"

    # Append a single dtoverlay=dwc2 if not present
    if ! grep -q "^dtoverlay=dwc2$" /boot/firmware/config.txt; then
        echo "dtoverlay=dwc2" | sudo tee -a /boot/firmware/config.txt
        check_success "Appended dtoverlay=dwc2 to /boot/firmware/config.txt"
    else
        log "INFO" "dtoverlay=dwc2 already present in /boot/firmware/config.txt"
    fi

    # Create USB gadget script
    if [ ! -f /usr/local/bin/usb-gadget.sh ]; then
        log "INFO" "Creating USB gadget script at /usr/local/bin/usb-gadget.sh"
        cat > /usr/local/bin/usb-gadget.sh << 'EOF'
#!/bin/bash
set -e

# Enable debug mode for detailed logging
set -x

modprobe libcomposite
cd /sys/kernel/config/usb_gadget/
mkdir -p g1
cd g1

echo 0x1d6b > idVendor
echo 0x0104 > idProduct
echo 0x0100 > bcdDevice
echo 0x0200 > bcdUSB

mkdir -p strings/0x409
echo "fedcba9876543210" > strings/0x409/serialnumber
echo "Raspberry Pi" > strings/0x409/manufacturer
echo "Pi Zero USB" > strings/0x409/product

mkdir -p configs/c.1/strings/0x409
echo "Config 1: RNDIS Network" > configs/c.1/strings/0x409/configuration
echo 250 > configs/c.1/MaxPower

mkdir -p functions/rndis.usb0

# Remove existing symlink if it exists to prevent duplicates
if [ -L configs/c.1/rndis.usb0 ]; then
    rm configs/c.1/rndis.usb0
fi
ln -s functions/rndis.usb0 configs/c.1/

# Ensure the device is not busy before listing available USB device controllers
max_retries=10
retry_count=0

while ! ls /sys/class/udc > UDC 2>/dev/null; do
    if [ $retry_count -ge $max_retries ]; then
        echo "Error: Device or resource busy after $max_retries attempts."
        exit 1
    fi
    retry_count=$((retry_count + 1))
    sleep 1
done

# Assign the USB Device Controller (UDC)
UDC_NAME=$(ls /sys/class/udc)
echo "$UDC_NAME" > UDC
echo "Assigned UDC: $UDC_NAME"

# Check if the usb0 interface is already configured
if ! ip addr show usb0 | grep -q "172.20.2.1"; then
    ifconfig usb0 172.20.2.1 netmask 255.255.255.0
    echo "Configured usb0 with IP 172.20.2.1"
else
    echo "Interface usb0 already configured."
fi
EOF

        chmod +x /usr/local/bin/usb-gadget.sh
        check_success "Created and made USB gadget script executable at /usr/local/bin/usb-gadget.sh"
    else
        log "INFO" "USB gadget script /usr/local/bin/usb-gadget.sh already exists. Skipping creation."
    fi

    # Create USB gadget service
    if [ ! -f /etc/systemd/system/usb-gadget.service ]; then
        log "INFO" "Creating USB gadget systemd service at /etc/systemd/system/usb-gadget.service"
        cat > /etc/systemd/system/usb-gadget.service << EOF
[Unit]
Description=USB Gadget Service
After=network.target

[Service]
ExecStartPre=/sbin/modprobe libcomposite
ExecStart=/usr/local/bin/usb-gadget.sh
Type=simple
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
        check_success "Created USB gadget systemd service at /etc/systemd/system/usb-gadget.service"
    else
        log "INFO" "USB gadget systemd service /etc/systemd/system/usb-gadget.service already exists. Skipping creation."
    fi

    # Configure network interface: Remove duplicate entries first
    log "INFO" "Cleaning up existing network interface configurations for usb0 in /etc/network/interfaces"
    if grep -q "^allow-hotplug usb0" /etc/network/interfaces; then
        # Remove all lines starting with allow-hotplug usb0 and the following lines (iface and settings)
        sudo sed -i '/^allow-hotplug usb0$/,/^$/d' /etc/network/interfaces
        check_success "Removed existing network interface configurations for usb0 from /etc/network/interfaces"
    else
        log "INFO" "No existing network interface configuration for usb0 found in /etc/network/interfaces."
    fi

    # Append network interface configuration for usb0 if not already present
    if ! grep -q "^allow-hotplug usb0" /etc/network/interfaces; then
        log "INFO" "Appending network interface configuration for usb0 to /etc/network/interfaces"
        cat >> /etc/network/interfaces << EOF

allow-hotplug usb0
iface usb0 inet static
    address 172.20.2.1
    netmask 255.255.255.0
    gateway 172.20.2.1
EOF
        check_success "Appended network interface configuration for usb0 to /etc/network/interfaces"
    else
        log "INFO" "Network interface usb0 already configured in /etc/network/interfaces"
    fi

    # Reload systemd daemon and enable/start services
    log "INFO" "Reloading systemd daemon"
    systemctl daemon-reload
    check_success "Reloaded systemd daemon"

    log "INFO" "Enabling systemd-networkd service"
    systemctl enable systemd-networkd
    check_success "Enabled systemd-networkd service"

    log "INFO" "Enabling usb-gadget service"
    systemctl enable usb-gadget.service
    check_success "Enabled usb-gadget service"

    log "INFO" "Starting systemd-networkd service"
    systemctl start systemd-networkd
    check_success "Started systemd-networkd service"

    log "INFO" "Starting usb-gadget service"
    systemctl start usb-gadget.service
    check_success "Started usb-gadget service"

    log "SUCCESS" "USB Gadget installation completed successfully."
}

# ============================================================
# Function to Uninstall USB Gadget
# ============================================================
uninstall_usb_gadget() {
    log "INFO" "Starting USB Gadget uninstallation..."

    # Ensure the script is run as root
    if [ "$(id -u)" -ne 0 ]; then
        log "ERROR" "This script must be run as root. Please use 'sudo'."
        exit 1
    fi

    # Stop and disable USB gadget service
    if systemctl is-active --quiet usb-gadget.service; then
        systemctl stop usb-gadget.service
        check_success "Stopped usb-gadget.service"
    else
        log "INFO" "usb-gadget.service is not running."
    fi

    if systemctl is-enabled --quiet usb-gadget.service; then
        systemctl disable usb-gadget.service
        check_success "Disabled usb-gadget.service"
    else
        log "INFO" "usb-gadget.service is not enabled."
    fi

    # Remove USB gadget service file
    if [ -f /etc/systemd/system/usb-gadget.service ]; then
        rm /etc/systemd/system/usb-gadget.service
        check_success "Removed /etc/systemd/system/usb-gadget.service"
    else
        log "INFO" "/etc/systemd/system/usb-gadget.service does not exist. Skipping removal."
    fi

    # Remove USB gadget script
    if [ -f /usr/local/bin/usb-gadget.sh ]; then
        rm /usr/local/bin/usb-gadget.sh
        check_success "Removed /usr/local/bin/usb-gadget.sh"
    else
        log "INFO" "/usr/local/bin/usb-gadget.sh does not exist. Skipping removal."
    fi

    # Restore cmdline.txt and config.txt from backups
    if [ -f /boot/firmware/cmdline.txt.bak ]; then
        cp /boot/firmware/cmdline.txt.bak /boot/firmware/cmdline.txt
        chmod 644 /boot/firmware/cmdline.txt
        check_success "Restored /boot/firmware/cmdline.txt from backup"
    else
        log "WARNING" "Backup /boot/firmware/cmdline.txt.bak not found. Skipping restoration."
    fi

    if [ -f /boot/firmware/config.txt.bak ]; then
        cp /boot/firmware/config.txt.bak /boot/firmware/config.txt
        check_success "Restored /boot/firmware/config.txt from backup"
    else
        log "WARNING" "Backup /boot/firmware/config.txt.bak not found. Skipping restoration."
    fi

    # Remove network interface configuration for usb0: Remove all related lines
    if grep -q "^allow-hotplug usb0" /etc/network/interfaces; then
        log "INFO" "Removing network interface configuration for usb0 from /etc/network/interfaces"
        # Remove lines from allow-hotplug usb0 up to the next empty line
        sudo sed -i '/^allow-hotplug usb0$/,/^$/d' /etc/network/interfaces
        check_success "Removed network interface configuration for usb0 from /etc/network/interfaces"
    else
        log "INFO" "Network interface usb0 not found in /etc/network/interfaces. Skipping removal."
    fi

    # Reload systemd daemon
    log "INFO" "Reloading systemd daemon"
    systemctl daemon-reload
    check_success "Reloaded systemd daemon"

    # Disable and stop systemd-networkd service
    if systemctl is-active --quiet systemd-networkd; then
        systemctl stop systemd-networkd
        check_success "Stopped systemd-networkd service"
    else
        log "INFO" "systemd-networkd service is not running."
    fi

    if systemctl is-enabled --quiet systemd-networkd; then
        systemctl disable systemd-networkd
        check_success "Disabled systemd-networkd service"
    else
        log "INFO" "systemd-networkd service is not enabled."
    fi

    # Clean up any remaining duplicate entries in cmdline.txt and config.txt
    log "INFO" "Ensuring no duplicate entries remain in configuration files."

    # Remove any remaining modules-load=dwc2,g_rndis and modules-load=dwc2,g_ether
    sudo sed -i '/modules-load=dwc2,g_rndis/d' /boot/firmware/cmdline.txt
    sudo sed -i '/modules-load=dwc2,g_ether/d' /boot/firmware/cmdline.txt

    # Remove any remaining dtoverlay=dwc2
    sudo sed -i '/^dtoverlay=dwc2$/d' /boot/firmware/config.txt

    log "INFO" "Cleaned up duplicate entries in /boot/firmware/cmdline.txt and /boot/firmware/config.txt"

    log "SUCCESS" "USB Gadget uninstallation completed successfully."
}

# ============================================================
# Function to List USB Gadget Information
# ============================================================
list_usb_gadget_info() {
    echo -e "${CYAN}===== USB Gadget Information =====${NC}"

    # Check status of usb-gadget service
    echo -e "\n${YELLOW}Service Status:${NC}"
    if systemctl list-units --type=service | grep -q usb-gadget.service; then
        systemctl status usb-gadget.service --no-pager
    else
        echo -e "${RED}usb-gadget.service is not installed.${NC}"
    fi

    # Check if USB gadget script exists
    echo -e "\n${YELLOW}USB Gadget Script:${NC}"
    if [ -f /usr/local/bin/usb-gadget.sh ]; then
        echo -e "${GREEN}/usr/local/bin/usb-gadget.sh exists.${NC}"
    else
        echo -e "${RED}/usr/local/bin/usb-gadget.sh does not exist.${NC}"
    fi

    # Check network interface configuration
    echo -e "\n${YELLOW}Network Interface Configuration for usb0:${NC}"
    if grep -q "^allow-hotplug usb0" /etc/network/interfaces; then
        grep "^allow-hotplug usb0" /etc/network/interfaces -A 4
    else
        echo -e "${RED}No network interface configuration found for usb0.${NC}"
    fi

    # Check cmdline.txt
    echo -e "\n${YELLOW}/boot/firmware/cmdline.txt:${NC}"
    if grep -q "modules-load=dwc2,g_rndis" /boot/firmware/cmdline.txt && grep -q "modules-load=dwc2,g_ether" /boot/firmware/cmdline.txt; then
        echo -e "${GREEN}modules-load=dwc2,g_rndis and modules-load=dwc2,g_ether are present.${NC}"
    else
        echo -e "${RED}modules-load=dwc2,g_rndis and/or modules-load=dwc2,g_ether are not present.${NC}"
    fi

    # Check config.txt
    echo -e "\n${YELLOW}/boot/firmware/config.txt:${NC}"
    if grep -q "^dtoverlay=dwc2" /boot/firmware/config.txt; then
        echo -e "${GREEN}dtoverlay=dwc2 is present.${NC}"
    else
        echo -e "${RED}dtoverlay=dwc2 is not present.${NC}"
    fi

    # Check if systemd-networkd is enabled
    echo -e "\n${YELLOW}systemd-networkd Service:${NC}"
    if systemctl is-enabled --quiet systemd-networkd; then
        systemctl is-active systemd-networkd && echo -e "${GREEN}systemd-networkd is active.${NC}" || echo -e "${RED}systemd-networkd is inactive.${NC}"
    else
        echo -e "${RED}systemd-networkd is not enabled.${NC}"
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
        echo -e "${BLUE}║ USB Gadget Manager Menu by Infinition  ║${NC}"
        echo -e "${BLUE}╠════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║${NC} 1. Install USB Gadget                  ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 2. Uninstall USB Gadget                ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 3. List USB Gadget Information         ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 4. Show Help                           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 5. Exit                                ${BLUE}║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
        echo -e "Note: Ensure you run this script as root."
        echo -e "${YELLOW}Usage: $0 [OPTIONS] (use -h for help)${NC}"
        echo -n -e "${GREEN}Please choose an option (1-5): ${NC}"
        read choice

        case $choice in
            1)
                install_usb_gadget
                echo ""
                read -p "Press Enter to return to the menu..."
                ;;
            2)
                uninstall_usb_gadget
                echo ""
                read -p "Press Enter to return to the menu..."
                ;;
            3)
                list_usb_gadget_info
                echo ""
                read -p "Press Enter to return to the menu..."
                ;;
            4)
                show_usage
                ;;
            5)
                log "INFO" "Exiting USB Gadget Manager. Goodbye!"
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
      install_usb_gadget
      exit 0
      ;;
    u)
      uninstall_usb_gadget
      exit 0
      ;;
    l)
      list_usb_gadget_info
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
