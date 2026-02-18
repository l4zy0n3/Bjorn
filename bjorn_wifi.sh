#!/bin/bash

# WiFi Manager Script Using nmcli
# Author: Infinition
# Version: 1.6
# Description: This script provides a simple menu interface to manage WiFi connections using nmcli.

# ============================================================
# Colors for Output
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================
# Logging Function
# ============================================================
log() {
    local level=$1
    shift
    case $level in
        "INFO") echo -e "${GREEN}[INFO]${NC} $*" ;;
        "WARN") echo -e "${YELLOW}[WARN]${NC} $*" ;;
        "ERROR") echo -e "${RED}[ERROR]${NC} $*" ;;
        "DEBUG") echo -e "${BLUE}[DEBUG]${NC} $*" ;;
    esac
}

# ============================================================
# Check if Script is Run as Root
# ============================================================
if [ "$EUID" -ne 0 ]; then 
    log "ERROR" "This script must be run as root."
    exit 1
fi

# ============================================================
# Function to Show Usage
# ============================================================
show_usage() {
    echo -e "${GREEN}Usage: $0 [OPTIONS]${NC}"
    echo -e "Options:"
    echo -e "  ${BLUE}-h${NC}    Show this help message"
    echo -e "  ${BLUE}-f${NC}    Force refresh of WiFi connections"
    echo -e "  ${BLUE}-c${NC}    Clear all saved WiFi connections"
    echo -e "  ${BLUE}-l${NC}    List all available WiFi networks"
    echo -e "  ${BLUE}-s${NC}    Show current WiFi status"
    echo -e "  ${BLUE}-a${NC}    Add a new WiFi connection"
    echo -e "  ${BLUE}-d${NC}    Delete a WiFi connection"
    echo -e "  ${BLUE}-m${NC}    Manage WiFi Connections"
    echo -e ""
    echo -e "Example: $0 -a"
    exit 1
}

# ============================================================
# Function to Check Prerequisites
# ============================================================
check_prerequisites() {
    log "INFO" "Checking prerequisites..."

    local missing_packages=()

    # Check if nmcli is installed
    if ! command -v nmcli &> /dev/null; then
        missing_packages+=("network-manager")
    fi

    # Check if NetworkManager service is running
    if ! systemctl is-active --quiet NetworkManager; then
        log "WARN" "NetworkManager service is not running. Attempting to start it..."
        systemctl start NetworkManager
        sleep 2
        if ! systemctl is-active --quiet NetworkManager; then
            log "ERROR" "Failed to start NetworkManager. Please install and start it manually."
            exit 1
        else
            log "INFO" "NetworkManager started successfully."
        fi
    fi

    # Install missing packages if any
    if [ ${#missing_packages[@]} -gt 0 ]; then
        log "WARN" "Missing packages: ${missing_packages[*]}"
        log "INFO" "Attempting to install missing packages..."
        apt-get update
        apt-get install -y "${missing_packages[@]}"
        
        # Verify installation
        for package in "${missing_packages[@]}"; do
            if ! dpkg -l | grep -q "^ii.*$package"; then
                log "ERROR" "Failed to install $package."
                exit 1
            fi
        done
    fi

    log "INFO" "All prerequisites are met."
}

# ============================================================
# Function to Handle preconfigured.nmconnection
# ============================================================
handle_preconfigured_connection() {
    preconfigured_file="/etc/NetworkManager/system-connections/preconfigured.nmconnection"

    if [ -f "$preconfigured_file" ]; then
        echo -e "${YELLOW}A preconfigured WiFi connection exists (preconfigured.nmconnection).${NC}"
        echo -n -e "${GREEN}Do you want to delete it and recreate connections with individual SSIDs? (y/n): ${NC}"
        read confirm

        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            # Extract SSID from preconfigured.nmconnection
            ssid=$(grep "^ssid=" "$preconfigured_file" | cut -d'=' -f2 | tr -d '"')
            if [ -z "$ssid" ]; then
                log "WARN" "SSID not found in preconfigured.nmconnection. Cannot recreate connection."
            else
                # Extract security type
                security=$(grep "^security=" "$preconfigured_file" | cut -d'=' -f2 | tr -d '"')

                # Delete preconfigured.nmconnection
                log "INFO" "Deleting preconfigured.nmconnection..."
                rm "$preconfigured_file"
                systemctl restart NetworkManager
                sleep 2

                # Recreate the connection with SSID name
                echo -n -e "${GREEN}Do you want to recreate the connection for SSID '$ssid'? (y/n): ${NC}"
                read recreate_confirm

                if [[ "$recreate_confirm" =~ ^[Yy]$ ]]; then
                    # Check if connection already exists
                    if nmcli connection show "$ssid" &> /dev/null; then
                        log "WARN" "A connection named '$ssid' already exists."
                    else
                        # Prompt for password if necessary
                        if [ "$security" == "none" ] || [ "$security" == "--" ] || [ -z "$security" ]; then
                            # Open network
                            log "INFO" "Creating open connection for SSID '$ssid'..."
                            nmcli device wifi connect "$ssid" name "$ssid"
                        else
                            # Secured network
                            echo -n -e "${GREEN}Enter WiFi Password for '$ssid': ${NC}"
                            read -s password
                            echo ""
                            if [ -z "$password" ]; then
                                log "ERROR" "Password cannot be empty."
                            else
                                log "INFO" "Creating secured connection for SSID '$ssid'..."
                                nmcli device wifi connect "$ssid" password "$password" name "$ssid"
                            fi
                        fi

                        if [ $? -eq 0 ]; then
                            log "INFO" "Successfully recreated connection for '$ssid'."
                        else
                            log "ERROR" "Failed to recreate connection for '$ssid'."
                        fi
                    fi
                else
                    log "INFO" "Connection recreation cancelled."
                fi
            fi
        else
            log "INFO" "Preconfigured connection retained."
        fi
    fi
}

# ============================================================
# Function to List All Available WiFi Networks and Connect
# ============================================================
list_wifi_and_connect() {
    log "INFO" "Scanning for available WiFi networks..."
    nmcli device wifi rescan
    sleep 2

    while true; do
        clear
        available_networks=$(nmcli -t -f SSID,SECURITY device wifi list)

        if [ -z "$available_networks" ]; then
            log "WARN" "No WiFi networks found."
            echo ""
        else
            # Remove lines with empty SSIDs (hidden networks)
            network_list=$(echo "$available_networks" | grep -v '^:$')

            if [ -z "$network_list" ]; then
                log "WARN" "No visible WiFi networks found."
                echo ""
            else
                echo -e "${CYAN}Available WiFi Networks:${NC}"
                declare -A SSIDs
                declare -A SECURITIES
                index=1

                while IFS=: read -r ssid security; do
                    # Handle hidden SSIDs
                    if [ -z "$ssid" ]; then
                        ssid="<Hidden SSID>"
                    fi
                    SSIDs["$index"]="$ssid"
                    SECURITIES["$index"]="$security"
                    printf "%d. %-40s (%s)\n" "$index" "$ssid" "$security"
                    index=$((index + 1))
                done <<< "$network_list"
            fi
        fi

        echo ""
        echo -e "${YELLOW}The list will refresh every 5 seconds. Press 'c' to connect, enter a number to connect, or 'q' to quit.${NC}"
        echo -n -e "${GREEN}Enter choice (number/c/q): ${NC}"
        read -t 5 input

        if [ $? -eq 0 ]; then
            if [[ "$input" =~ ^[Qq]$ ]]; then
                log "INFO" "Exiting WiFi list."
                return
            elif [[ "$input" =~ ^[Cc]$ ]]; then
                # Handle connection via 'c'
                echo ""
                echo -n -e "${GREEN}Enter the number of the network to connect: ${NC}"
                read selection

                if [[ -z "$selection" ]]; then
                    log "INFO" "Operation cancelled."
                    continue
                fi

                # Validate selection
                if ! [[ "$selection" =~ ^[0-9]+$ ]]; then
                    log "ERROR" "Invalid selection. Please enter a valid number."
                    sleep 2
                    continue
                fi

                max_index=$((index - 1))
                if [ "$selection" -lt 1 ] || [ "$selection" -gt "$max_index" ]; then
                    log "ERROR" "Invalid selection. Please enter a number between 1 and $max_index."
                    sleep 2
                    continue
                fi

                ssid_selected="${SSIDs[$selection]}"
                security_selected="${SECURITIES[$selection]}"

                echo -n -e "${GREEN}Do you want to connect to '$ssid_selected'? (y/n): ${NC}"
                read confirm

                if [[ "$confirm" =~ ^[Yy]$ ]]; then
                    if [ "$security_selected" == "--" ] || [ -z "$security_selected" ]; then
                        # Open network
                        log "INFO" "Connecting to open network '$ssid_selected'..."
                        nmcli device wifi connect "$ssid_selected" name "$ssid_selected"
                    else
                        # Secured network
                        echo -n -e "${GREEN}Enter WiFi Password for '$ssid_selected': ${NC}"
                        read -s password
                        echo ""
                        if [ -z "$password" ]; then
                            log "ERROR" "Password cannot be empty."
                            sleep 2
                            continue
                        fi
                        log "INFO" "Connecting to '$ssid_selected'..."
                        nmcli device wifi connect "$ssid_selected" password "$password" name "$ssid_selected"
                    fi

                    if [ $? -eq 0 ]; then
                        log "INFO" "Successfully connected to '$ssid_selected'."
                    else
                        log "ERROR" "Failed to connect to '$ssid_selected'."
                    fi
                else
                    log "INFO" "Operation cancelled."
                fi

                echo ""
                read -p "Press Enter to continue..."
            elif [[ "$input" =~ ^[0-9]+$ ]]; then
                # Handle connection via number
                selection="$input"

                # Validate selection
                if ! [[ "$selection" =~ ^[0-9]+$ ]]; then
                    log "ERROR" "Invalid selection. Please enter a valid number."
                    sleep 2
                    continue
                fi

                max_index=$((index - 1))
                if [ "$selection" -lt 1 ] || [ "$selection" -gt "$max_index" ]; then
                    log "ERROR" "Invalid selection. Please enter a number between 1 and $max_index."
                    sleep 2
                    continue
                fi

                ssid_selected="${SSIDs[$selection]}"
                security_selected="${SECURITIES[$selection]}"

                echo -n -e "${GREEN}Do you want to connect to '$ssid_selected'? (y/n): ${NC}"
                read confirm

                if [[ "$confirm" =~ ^[Yy]$ ]]; then
                    if [ "$security_selected" == "--" ] || [ -z "$security_selected" ]; then
                        # Open network
                        log "INFO" "Connecting to open network '$ssid_selected'..."
                        nmcli device wifi connect "$ssid_selected" name "$ssid_selected"
                    else
                        # Secured network
                        echo -n -e "${GREEN}Enter WiFi Password for '$ssid_selected': ${NC}"
                        read -s password
                        echo ""
                        if [ -z "$password" ]; then
                            log "ERROR" "Password cannot be empty."
                            sleep 2
                            continue
                        fi
                        log "INFO" "Connecting to '$ssid_selected'..."
                        nmcli device wifi connect "$ssid_selected" password "$password" name "$ssid_selected"
                    fi

                    if [ $? -eq 0 ]; then
                        log "INFO" "Successfully connected to '$ssid_selected'."
                    else
                        log "ERROR" "Failed to connect to '$ssid_selected'."
                    fi
                else
                    log "INFO" "Operation cancelled."
                fi

                echo ""
                read -p "Press Enter to continue..."
            else
                log "ERROR" "Invalid input."
                sleep 2
            fi
        fi
    done
}

# ============================================================
# Function to Show Current WiFi Status
# ============================================================
show_wifi_status() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║          Current WiFi Status           ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════╣${NC}"
    
    # Check if WiFi is enabled
    wifi_enabled=$(nmcli radio wifi)
    echo -e "▶ WiFi Enabled : ${wifi_enabled}"

    # Show active connection
    # Remplacer SSID par NAME
    active_conn=$(nmcli -t -f ACTIVE,NAME connection show --active | grep '^yes' | cut -d':' -f2)
    if [ -n "$active_conn" ]; then
        echo -e "▶ Connected to : ${GREEN}$active_conn${NC}"
    else
        echo -e "▶ Connected to : ${RED}Not Connected${NC}"
    fi

    # Show all saved connections
    echo -e "\n${CYAN}Saved WiFi Connections:${NC}"
    nmcli connection show | grep wifi

    echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
    echo ""
    read -p "Press Enter to return to the menu..."
}

# ============================================================
# Function to Add a New WiFi Connection
# ============================================================
add_wifi_connection() {
    echo -e "${CYAN}Add a New WiFi Connection${NC}"
    echo -n "Enter SSID (Network Name): "
    read ssid
    echo -n "Enter WiFi Password (leave empty for open network): "
    read -s password
    echo ""

    if [ -z "$ssid" ]; then
        log "ERROR" "SSID cannot be empty."
        sleep 2
        return
    fi

    if [ -n "$password" ]; then
        log "INFO" "Adding new WiFi connection for SSID: $ssid"
        nmcli device wifi connect "$ssid" password "$password" name "$ssid"
    else
        log "INFO" "Adding new open WiFi connection for SSID: $ssid"
        nmcli device wifi connect "$ssid" --ask name "$ssid"
    fi

    if [ $? -eq 0 ]; then
        log "INFO" "Successfully connected to '$ssid'."
    else
        log "ERROR" "Failed to connect to '$ssid'."
    fi

    echo ""
    read -p "Press Enter to return to the menu..."
}

# ============================================================
# Function to Delete a WiFi Connection
# ============================================================
delete_wifi_connection() {
    echo -e "${CYAN}Delete a WiFi Connection${NC}"
    # Correctly filter connections by type '802-11-wireless'
    connections=$(nmcli -t -f NAME,TYPE connection show | awk -F: '$2 == "802-11-wireless" {print $1}')

    if [ -z "$connections" ]; then
        log "WARN" "No WiFi connections available to delete."
        echo ""
        read -p "Press Enter to return to the menu..."
        return
    fi

    echo -e "${CYAN}Available WiFi Connections:${NC}"
    index=1
    declare -A CONNECTIONS
    while IFS= read -r conn; do
        echo -e "$index. $conn"
        CONNECTIONS["$index"]="$conn"
        index=$((index + 1))
    done <<< "$connections"

    echo ""
    echo -n -e "${GREEN}Enter the number of the connection to delete (or press Enter to cancel): ${NC}"
    read selection

    if [[ -z "$selection" ]]; then
        log "INFO" "Operation cancelled."
        sleep 1
        return
    fi

    # Validate selection
    if ! [[ "$selection" =~ ^[0-9]+$ ]]; then
        log "ERROR" "Invalid selection. Please enter a valid number."
        sleep 2
        return
    fi

    max_index=$((index - 1))
    if [ "$selection" -lt 1 ] || [ "$selection" -gt "$max_index" ]; then
        log "ERROR" "Invalid selection. Please enter a number between 1 and $max_index."
        sleep 2
        return
    fi

    conn_name="${CONNECTIONS[$selection]}"

    # Backup the connection before deletion
    backup_dir="$HOME/wifi_connection_backups"
    mkdir -p "$backup_dir"
    backup_file="$backup_dir/${conn_name}.nmconnection"

    if nmcli connection show "$conn_name" &> /dev/null; then
        log "INFO" "Backing up connection '$conn_name'..."
        cp "/etc/NetworkManager/system-connections/$conn_name.nmconnection" "$backup_file" 2>/dev/null
        if [ $? -eq 0 ]; then
            log "INFO" "Backup saved to '$backup_file'."
        else
            log "WARN" "Failed to backup connection. It might not be a preconfigured connection or backup location is inaccessible."
        fi
    else
        log "WARN" "Connection '$conn_name' does not exist or cannot be backed up."
    fi

    log "INFO" "Deleting WiFi connection: $conn_name"
    nmcli connection delete "$conn_name"

    if [ $? -eq 0 ]; then
        log "INFO" "Successfully deleted '$conn_name'."
    else
        log "ERROR" "Failed to delete '$conn_name'."
    fi

    echo ""
    read -p "Press Enter to return to the menu..."
}

# ============================================================
# Function to Clear All Saved WiFi Connections
# ============================================================
clear_all_connections() {
    echo -e "${YELLOW}Are you sure you want to delete all saved WiFi connections? (y/n): ${NC}"
    read confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        log "INFO" "Deleting all saved WiFi connections..."
        connections=$(nmcli -t -f NAME,TYPE connection show | awk -F: '$2 == "802-11-wireless" {print $1}')
        for conn in $connections; do
            # Backup before deletion
            backup_dir="$HOME/wifi_connection_backups"
            mkdir -p "$backup_dir"
            backup_file="$backup_dir/${conn}.nmconnection"
            if nmcli connection show "$conn" &> /dev/null; then
                cp "/etc/NetworkManager/system-connections/$conn.nmconnection" "$backup_file" 2>/dev/null
                if [ $? -eq 0 ]; then
                    log "INFO" "Backup saved to '$backup_file'."
                else
                    log "WARN" "Failed to backup connection '$conn'."
                fi
            fi

            nmcli connection delete "$conn"
            log "INFO" "Deleted connection: $conn"
        done
        log "INFO" "All saved WiFi connections have been deleted."
    else
        log "INFO" "Operation cancelled."
    fi
    echo ""
    read -p "Press Enter to return to the menu..."
}

# ============================================================
# Function to Manage WiFi Connections
# ============================================================
manage_wifi_connections() {
    while true; do
        clear
        echo -e "${CYAN}Manage WiFi Connections${NC}"
        echo -e "1. List WiFi Connections"
        echo -e "2. Delete a WiFi Connection"
        echo -e "3. Recreate a WiFi Connection from Backup"
        echo -e "4. Back to Main Menu"
        echo -n -e "${GREEN}Choose an option (1-4): ${NC}"
        read choice

        case $choice in
            1)
                # List WiFi connections
                clear
                echo -e "${CYAN}Saved WiFi Connections:${NC}"
                nmcli -t -f NAME,TYPE connection show | awk -F: '$2 == "802-11-wireless" {print $1}'
                echo ""
                read -p "Press Enter to return to the Manage WiFi Connections menu..."
                ;;
            2)
                delete_wifi_connection
                ;;
            3)
                # Liste des sauvegardes disponibles
                backup_dir="$HOME/wifi_connection_backups"
                if [ ! -d "$backup_dir" ]; then
                    log "WARN" "No backup directory found at '$backup_dir'."
                    echo ""
                    read -p "Press Enter to return to the Manage WiFi Connections menu..."
                    continue
                fi

                backups=("$backup_dir"/*.nmconnection)
                if [ ${#backups[@]} -eq 0 ]; then
                    log "WARN" "No backup files found in '$backup_dir'."
                    echo ""
                    read -p "Press Enter to return to the Manage WiFi Connections menu..."
                    continue
                fi

                echo -e "${CYAN}Available WiFi Connection Backups:${NC}"
                index=1
                declare -A BACKUPS
                for backup in "${backups[@]}"; do
                    backup_name=$(basename "$backup" .nmconnection)
                    echo -e "$index. $backup_name"
                    BACKUPS["$index"]="$backup_name"
                    index=$((index + 1))
                done

                echo ""
                echo -n -e "${GREEN}Enter the number of the connection to recreate (or press Enter to cancel): ${NC}"
                read selection

                if [[ -z "$selection" ]]; then
                    log "INFO" "Operation cancelled."
                    sleep 1
                    continue
                fi

                # Validate selection
                if ! [[ "$selection" =~ ^[0-9]+$ ]]; then
                    log "ERROR" "Invalid selection. Please enter a valid number."
                    sleep 2
                    continue
                fi

                max_index=$((index - 1))
                if [ "$selection" -lt 1 ] || [ "$selection" -gt "$max_index" ]; then
                    log "ERROR" "Invalid selection. Please enter a number between 1 and $max_index."
                    sleep 2
                    continue
                fi

                conn_name="${BACKUPS[$selection]}"

                backup_file="$backup_dir/${conn_name}.nmconnection"

                # Vérifier que le fichier de sauvegarde existe
                if [ ! -f "$backup_file" ]; then
                    log "ERROR" "Backup file '$backup_file' does not exist."
                    sleep 2
                    continue
                fi

                log "INFO" "Recreating connection '$conn_name' from backup..."
                cp "$backup_file" "/etc/NetworkManager/system-connections/" 2>/dev/null
                if [ $? -ne 0 ]; then
                    log "ERROR" "Failed to copy backup file to NetworkManager directory. Check permissions."
                    sleep 2
                    continue
                fi

                # Set correct permissions
                chmod 600 "/etc/NetworkManager/system-connections/$conn_name.nmconnection"

                # Reload NetworkManager connections
                nmcli connection reload

                # Bring the connection up
                nmcli connection up "$conn_name"

                if [ $? -eq 0 ]; then
                    log "INFO" "Successfully recreated and connected to '$conn_name'."
                else
                    log "ERROR" "Failed to recreate and connect to '$conn_name'."
                fi

                echo ""
                read -p "Press Enter to return to the Manage WiFi Connections menu..."
                ;;
            4)
                log "INFO" "Returning to Main Menu."
                return
                ;;
            *)
                log "ERROR" "Invalid option."
                sleep 2
                ;;
        esac
    done
}

# ============================================================
# Function to Force Refresh WiFi Connections
# ============================================================
force_refresh_wifi_connections() {
    log "INFO" "Refreshing WiFi connections..."
    nmcli connection reload
    # Identify the WiFi device (e.g., wlan0, wlp2s0)
    wifi_device=$(nmcli device status | awk '$2 == "wifi" {print $1}')
    if [ -n "$wifi_device" ]; then
        nmcli device disconnect "$wifi_device"
        nmcli device connect "$wifi_device"
        log "INFO" "WiFi connections have been refreshed."
    else
        log "WARN" "No WiFi device found to refresh."
    fi
    echo ""
    read -p "Press Enter to return to the menu..."
}

# ============================================================
# Function to Display the Main Menu
# ============================================================
display_main_menu() {
    while true; do
        clear
        echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║      Wifi Manager Menu by Infinition     ║${NC}"
        echo -e "${BLUE}╠════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║${NC} 1. List Available WiFi Networks        ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 2. Show Current WiFi Status            ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 3. Add a New WiFi Connection           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 4. Delete a WiFi Connection            ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 5. Clear All Saved WiFi Connections    ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 6. Manage WiFi Connections             ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 7. Force Refresh WiFi Connections      ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC} 8. Exit                                 ${BLUE}║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
        echo -e "Note: Ensure your WiFi adapter is enabled."
        echo -e "${YELLOW}Usage: $0 [OPTIONS] (use -h for help)${NC}"
        echo -n -e "${GREEN}Please choose an option (1-8): ${NC}"
        read choice

        case $choice in
            1)
                list_wifi_and_connect
                ;;
            2)
                show_wifi_status
                ;;
            3)
                add_wifi_connection
                ;;
            4)
                delete_wifi_connection
                ;;
            5)
                clear_all_connections
                ;;
            6)
                manage_wifi_connections
                ;;
            7)
                force_refresh_wifi_connections
                ;;
            8)
                log "INFO" "Exiting Wifi Manager. Goodbye!"
                exit 0
                ;;
            *)
                log "ERROR" "Invalid option. Please choose between 1-8."
                sleep 2
                ;;
        esac
    done
}

# ============================================================
# Process Command Line Arguments
# ============================================================
while getopts "hfclsadm" opt; do
    case $opt in
        h)
            show_usage
            ;;
        f)
            force_refresh_wifi_connections
            exit 0
            ;;
        c)
            clear_all_connections
            exit 0
            ;;
        l)
            list_wifi_and_connect
            exit 0
            ;;
        s)
            show_wifi_status
            exit 0
            ;;
        a)
            add_wifi_connection
            exit 0
            ;;
        d)
            delete_wifi_connection
            exit 0
            ;;
        m)
            manage_wifi_connections
            exit 0
            ;;
        \?)
            log "ERROR" "Invalid option: -$OPTARG"
            show_usage
            ;;
    esac
done

# ============================================================
# Check Prerequisites Before Starting
# ============================================================
check_prerequisites

# ============================================================
# Handle preconfigured.nmconnection if Exists
# ============================================================
handle_preconfigured_connection

# ============================================================
# Start the Main Menu
# ============================================================
display_main_menu
