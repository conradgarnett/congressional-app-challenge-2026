#!/usr/bin/env bash

set -euo pipefail

# ============================================================
# Congressional App Challenge 2026
# Installation / Setup Script
# ============================================================

# ANSI Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# Project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

info() {
    echo -e "${CYAN}${BOLD}$1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}${BOLD}❌ $1${NC}"
}

die() {
    error "$1"
    exit 1
}

run_step() {
    local step="$1"
    local total="$2"
    local description="$3"
    shift 3

    echo -e "\n${CYAN}${BOLD}[$step/$total] $description...${NC}"

    if "$@"; then
        success "Done"
    else
        local exit_code=$?

        error "Failed: $description"
        echo -e "${RED}Exit code: $exit_code${NC}"

        return "$exit_code"
    fi
}

# ------------------------------------------------------------
# Help
# ------------------------------------------------------------

show_help() {
    cat << EOF

${BOLD}Congressional App Challenge 2026${NC}

Usage:
    ./install.sh              Install dependencies only
    ./install.sh --data       Fetch and process project data
    ./install.sh --full       Install dependencies + fetch/process data
    ./install.sh --help       Show this help message

Commands:

    ${BOLD}./install.sh${NC}
        Installs Node.js and Python dependencies.
        Does NOT contact the Overpass API.

    ${BOLD}./install.sh --data${NC}
        Fetches district boundaries and business data,
        then processes the data.

    ${BOLD}./install.sh --full${NC}
        Performs the complete installation and data pipeline.

EOF
}

# ------------------------------------------------------------
# Pre-flight checks
# ------------------------------------------------------------

check_command() {
    local command="$1"

    if ! command -v "$command" >/dev/null 2>&1; then
        die "$command is not installed. Please install it before continuing."
    fi
}

preflight() {
    info "🔍 Performing pre-flight checks..."

    check_command python3
    check_command npm

    success "All prerequisites found."
}

# ------------------------------------------------------------
# Install Node dependencies
# ------------------------------------------------------------

install_node() {
    run_step 1 3 \
        "Installing Node.js dependencies" \
        npm install
}

# ------------------------------------------------------------
# Set up Python virtual environment
# ------------------------------------------------------------

setup_python() {
    echo -e "\n${CYAN}${BOLD}[2/3] Setting up Python virtual environment...${NC}"

    if [[ -d ".venv" ]]; then
        warning ".venv already exists — reusing it."
    else
        python3 -m venv .venv
        success "Virtual environment created."
    fi
}

# ------------------------------------------------------------
# Install Python dependencies
# ------------------------------------------------------------

install_python() {
    run_step 3 3 \
        "Installing Python dependencies" \
        .venv/bin/python -m pip install -r pipeline/requirements.txt
}

# ------------------------------------------------------------
# Fetch district boundaries
# ------------------------------------------------------------

fetch_districts() {
    echo -e "\n${CYAN}${BOLD}[1/4] Fetching district boundaries...${NC}"

    if .venv/bin/python pipeline/fetch/districts.py; then
        success "District boundaries downloaded."
    else
        error "Failed to fetch district boundaries."
        return 1
    fi
}

# ------------------------------------------------------------
# Fetch business data
# ------------------------------------------------------------

fetch_businesses() {
    echo -e "\n${CYAN}${BOLD}[2/4] Fetching business data...${NC}"

    echo
    warning "This step uses the OpenStreetMap Overpass API."
    warning "The API can occasionally return 504/timeouts."
    echo

    if .venv/bin/python pipeline/fetch/businesses.py; then
        success "Business data downloaded."
    else
        error "Business data download failed."
        echo
        warning "This is usually an Overpass API problem, not an installation problem."
        echo
        echo "You can retry this step later with:"
        echo
        echo "    ./install.sh --data"
        echo

        return 1
    fi
}

# ------------------------------------------------------------
# Filter chains
# ------------------------------------------------------------

filter_chains() {
    run_step 3 4 \
        "Filtering big chains" \
        .venv/bin/python pipeline/filter/chains/filter_chains.py
}

# ------------------------------------------------------------
# Assign groups + export site data
# ------------------------------------------------------------

finalize_data() {
    echo -e "\n${CYAN}${BOLD}[4/4] Finalizing site data...${NC}"

    .venv/bin/python pipeline/filter/groups/assign_groups.py
    .venv/bin/python pipeline/load/export_site_data.py

    success "Site data generated."
}

# ------------------------------------------------------------
# Install everything
# ------------------------------------------------------------

install() {
    echo -e "${BOLD}"
    echo "=============================================="
    echo " Congressional App Challenge 2026"
    echo " Project Installation"
    echo "=============================================="
    echo -e "${NC}"

    preflight

    echo

    # Node dependencies
    info "📦 Installing Node.js dependencies..."
    npm install
    success "Node.js dependencies installed."

    # Python virtual environment
    echo
    info "🐍 Setting up Python virtual environment..."

    if [[ -d ".venv" ]]; then
        warning ".venv already exists — reusing it."
    else
        python3 -m venv .venv
        success "Virtual environment created."
    fi

    # Python dependencies
    echo
    info "📦 Installing Python dependencies..."
    .venv/bin/python -m pip install -r pipeline/requirements.txt
    success "Python dependencies installed."

    echo
    echo "=============================================="
    success "Installation complete!"
    echo "=============================================="
    echo
    echo "The project dependencies are ready."
    echo
    echo "To fetch project data, run:"
    echo
    echo "    ./install.sh --data"
    echo
}

# ------------------------------------------------------------
# Data pipeline
# ------------------------------------------------------------

data_pipeline() {
    echo -e "${BOLD}"
    echo "=============================================="
    echo " Congressional App Challenge 2026"
    echo " Data Pipeline"
    echo "=============================================="
    echo -e "${NC}"

    # Make sure the virtual environment exists
    if [[ ! -x ".venv/bin/python" ]]; then
        error "Python virtual environment not found."
        echo
        echo "Run:"
        echo
        echo "    ./install.sh"
        echo
        exit 1
    fi

    # Make sure dependencies are installed
    if ! .venv/bin/python -c "import geopandas, shapely, requests" >/dev/null 2>&1; then
        warning "Python dependencies appear to be missing."
        echo
        echo "Installing them now..."
        .venv/bin/python -m pip install -r pipeline/requirements.txt
    fi

    fetch_districts
    fetch_businesses
    filter_chains
    finalize_data

    echo
    echo "=============================================="
    success "Data pipeline complete!"
    echo "=============================================="
    echo
}

# ------------------------------------------------------------
# Full installation
# ------------------------------------------------------------

full_install() {
    install

    echo
    warning "Starting data pipeline..."
    echo

    data_pipeline
}

# ------------------------------------------------------------
# Main
# ------------------------------------------------------------

case "${1:-}" in
    "")
        install
        ;;

    --data)
        preflight
        data_pipeline
        ;;

    --full)
        full_install
        ;;

    --help|-h)
        show_help
        ;;

    *)
        error "Unknown option: $1"
        show_help
        exit 1
        ;;
esac
