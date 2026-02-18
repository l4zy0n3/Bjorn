#!/bin/bash

# Colors for menu
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to show help
show_help() {
    echo "Usage: $0 [OPTION]"
    echo "Manage USB Gadget and Bluetooth modes on Raspberry Pi"
    echo
    echo "Options:"
    echo "  -h, --help      Show this help message"
    echo "  -bluetooth      Enable Bluetooth mode"
    echo "  -usb           Enable USB Gadget mode"
    echo "  -status        Show current status"
    echo
    echo "Without options, the script runs in interactive menu mode"
    exit 0
}

# Add notice about reboot after USB functions
notify_reboot() {
    echo -e "${BLUE}Important:${NC} A reboot is required for the USB interface to appear on the host system (Windows/Mac/Linux)"
    echo -e "${BLUE}Please run:${NC} sudo reboot"
}

# Function to enable USB Gadget mode
enable_usb() {
    echo -e "${BLUE}Enabling USB Gadget mode...${NC}"
    
    # Stop bluetooth and related services
    echo "Stopping Bluetooth services..."
    sudo systemctl stop auto_bt_connect
    sudo systemctl disable auto_bt_connect
    sudo systemctl stop bluetooth
    sudo systemctl disable bluetooth
    sleep 2
    
    # Kill any existing processes that might interfere
    echo "Cleaning up processes..."
    sudo killall -9 dnsmasq 2>/dev/null || true
    
    # Stop all related services
    echo "Stopping all related services..."
    sudo systemctl stop usb-gadget
    sudo systemctl stop dnsmasq
    sudo systemctl stop systemd-networkd
    
    # Remove any existing network configuration
    echo "Cleaning up network configuration..."
    sudo ip link set usb0 down 2>/dev/null || true
    sudo ip addr flush dev usb0 2>/dev/null || true
    
    # Aggressive cleanup of USB modules
    echo "Unloading USB modules..."
    modules="g_ether usb_f_ecm usb_f_rndis u_ether libcomposite dwc2"
    for module in $modules; do
        sudo rmmod $module 2>/dev/null || true
    done
    sleep 2

    # Clean up USB gadget configuration
    if [ -d "/sys/kernel/config/usb_gadget/g1" ]; then
        echo "Removing existing gadget configuration..."
        cd /sys/kernel/config/usb_gadget/g1
        echo "" > UDC 2>/dev/null || true
        rm -f configs/c.1/ecm.usb0 2>/dev/null || true
        cd ..
        rmdir g1 2>/dev/null || true
    fi

    # Reset USB controller
    echo "Resetting USB controller..."
    if [ -e "/sys/bus/platform/drivers/dwc2" ]; then
        if [ -e "/sys/bus/platform/drivers/dwc2/20980000.usb" ]; then
            echo "20980000.usb" | sudo tee /sys/bus/platform/drivers/dwc2/unbind 2>/dev/null || true
            sleep 2
        fi
        echo "20980000.usb" | sudo tee /sys/bus/platform/drivers/dwc2/bind 2>/dev/null || true
        sleep 2
    fi

    # Load modules in correct order with verification
    echo "Loading USB modules..."
    sudo modprobe dwc2
    sleep 2
    if ! lsmod | grep -q "^dwc2"; then
        echo -e "${RED}Error: Could not load dwc2${NC}"
        return 1
    fi

    sudo modprobe libcomposite
    sleep 2
    if ! lsmod | grep -q "^libcomposite"; then
        echo -e "${RED}Error: Could not load libcomposite${NC}"
        return 1
    fi

    # Start services in correct order
    echo "Starting network services..."
    sudo systemctl start systemd-networkd
    sleep 2

    echo "Starting USB gadget service..."
    sudo systemctl enable usb-gadget
    sudo systemctl restart usb-gadget
    sleep 5
    # Verify USB gadget configuration
    echo "Verifying USB gadget configuration..."
    if ! ip link show usb0 >/dev/null 2>&1; then
        echo -e "${RED}USB Gadget interface (usb0) not found. Checking logs...${NC}"
        sudo journalctl -xe --no-pager -n 50 -u usb-gadget
        return 1
    fi

    if ! ip link show usb0 | grep -q "UP"; then
        echo -e "${RED}USB Gadget interface exists but is not UP. Attempting to bring it up...${NC}"
        sudo ip link set usb0 up
        sleep 2
        if ! ip link show usb0 | grep -q "UP"; then
            echo -e "${RED}Failed to bring up USB interface${NC}"
            return 1
        fi
    fi

    echo -e "${GREEN}USB Gadget interface is up and running${NC}"

    # Wait for interface with timeout
    echo "Waiting for USB interface..."
    for i in {1..15}; do
        if ip link show usb0 > /dev/null 2>&1; then
            echo "USB interface detected"
            sudo ip link set usb0 up
            sudo ip addr add 172.20.2.1/24 dev usb0 2>/dev/null || true
            break
        fi
        echo "Attempt $i/15..."
        sleep 1
    done

    if ip link show usb0 > /dev/null 2>&1; then
        echo "Starting DHCP server..."
        sudo systemctl restart dnsmasq
        echo -e "${GREEN}USB Gadget mode successfully enabled${NC}"
        ip a | grep usb0
    else
        echo -e "${RED}Failed to create USB interface${NC}"
        return 1
    fi
}

# Function to enable Bluetooth mode
enable_bluetooth() {
    echo -e "${BLUE}Enabling Bluetooth mode...${NC}"
    
    # Stop USB gadget
    echo "Stopping USB gadget..."
    sudo systemctl stop usb-gadget
    sudo systemctl disable usb-gadget
    
    # Aggressive cleanup of modules
    echo "Cleaning up modules..."
    modules="g_ether usb_f_ecm usb_f_rndis u_ether libcomposite dwc2"
    for module in $modules; do
        sudo rmmod $module 2>/dev/null || true
    done
    
    sleep 2
    
    # Force USB reconnect if possible
    if [ -e "/sys/bus/platform/drivers/dwc2" ]; then
        echo "Resetting USB controller..."
        echo "20980000.usb" | sudo tee /sys/bus/platform/drivers/dwc2/unbind 2>/dev/null || true
        sleep 2
        echo "20980000.usb" | sudo tee /sys/bus/platform/drivers/dwc2/bind 2>/dev/null || true
        sleep 2
    fi
    
    # Enable and start Bluetooth
    echo "Starting Bluetooth..."
    sudo systemctl enable bluetooth
    sudo systemctl start bluetooth
    
    # Wait for Bluetooth to initialize
    sleep 3
    
    # Start auto_bt_connect service last
    echo "Starting auto_bt_connect service..."
    sudo systemctl enable auto_bt_connect
    sudo systemctl start auto_bt_connect
    
    # Status check
    if systemctl is-active --quiet bluetooth; then
        echo -e "${GREEN}Bluetooth mode successfully enabled${NC}"
        echo "Bluetooth status:"
        sudo hciconfig
        if systemctl is-active --quiet auto_bt_connect; then
            echo -e "${GREEN}Auto BT Connect service is running${NC}"
        else
            echo -e "${RED}Warning: auto_bt_connect service failed to start${NC}"
        fi
    else
        echo -e "${RED}Error while enabling Bluetooth mode${NC}"
        echo "Service logs:"
        sudo systemctl status bluetooth
        return 1
    fi
}

# Function to show current status
show_status() {
    echo -e "${BLUE}Current services status:${NC}"
    echo "----------------------------------------"
    echo -n "USB Gadget: "
    if ip link show usb0 >/dev/null 2>&1 && ip link show usb0 | grep -q "UP"; then
        echo -e "${GREEN}ACTIVE${NC}"
    else
        echo -e "${RED}INACTIVE${NC}"
    fi
    
    echo -n "Bluetooth: "
    if systemctl is-active --quiet bluetooth; then
        echo -e "${GREEN}ACTIVE${NC}"
    else
        echo -e "${RED}INACTIVE${NC}"
    fi
    
    echo -n "Auto BT Connect: "
    if systemctl is-active --quiet auto_bt_connect; then
        echo -e "${GREEN}ACTIVE${NC}"
    else
        echo -e "${RED}INACTIVE${NC}"
    fi
    echo "----------------------------------------"
}

# Parse command line arguments
if [ $# -gt 0 ]; then
    case "$1" in
        -h|--help)
            show_help
            ;;
        -bluetooth)
            enable_bluetooth
            exit 0
            ;;
        -usb)
            enable_usb
            notify_reboot
            exit 0
            ;;
        -status)
            show_status
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            ;;
    esac
fi

# Main menu (only shown if no arguments provided)
while true; do
    clear
    echo -e "${BLUE}=== USB/Bluetooth Mode Manager ===${NC}"
    echo "1. Enable USB Gadget mode"
    echo "2. Enable Bluetooth mode"
    echo "3. Show status"
    echo "4. Exit"
    echo
    show_status
    echo
    read -p "Choose an option (1-4): " choice
    
    case $choice in
        1)
            enable_usb
            notify_reboot
            read -p "Press Enter to continue..."
            ;;
        2)
            enable_bluetooth
            read -p "Press Enter to continue..."
            ;;
        3)
            show_status
            read -p "Press Enter to continue..."
            ;;
        4)
            echo "Goodbye!"
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            read -p "Press Enter to continue..."
            ;;
    esac
done