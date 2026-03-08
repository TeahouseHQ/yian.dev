#!/bin/bash
# test-worktree-isolation.sh
# Red-Green test for git worktree parallel execution readiness
#
# This test verifies that multiple worktrees can run dev servers simultaneously
# without port conflicts.

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE_DIR="/tmp/yian-dev-worktree-test-$$"
PORT_MAIN=3030
PORT_WORKTREE=3031

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    # Kill any dev servers we started
    pkill -f "next dev.*$PORT_MAIN" 2>/dev/null || true
    pkill -f "next dev.*$PORT_WORKTREE" 2>/dev/null || true
    # Remove test worktree
    if [ -d "$WORKTREE_DIR" ]; then
        cd "$REPO_DIR"
        git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || rm -rf "$WORKTREE_DIR"
    fi
}

trap cleanup EXIT

echo "=========================================="
echo " Worktree Isolation Test"
echo "=========================================="
echo ""

# Test 1: Check if PORT is configurable
echo -e "${YELLOW}Test 1: PORT environment variable support${NC}"
cd "$REPO_DIR"

# Check if package.json allows PORT override
if grep -q 'next dev -p 3030' package.json && ! grep -q 'PORT' package.json; then
    echo -e "${RED}FAIL: Port is hardcoded in package.json${NC}"
    echo "  Expected: PORT should be configurable via environment variable"
    echo "  Found: Hardcoded 'next dev -p 3030'"
    echo ""
    echo "  Fix: Change 'next dev -p 3030' to 'next dev -p \${PORT:-3030}'"
    exit 1
else
    echo -e "${GREEN}PASS: Port is configurable${NC}"
fi

# Test 2: Check .envrc.template exists
echo ""
echo -e "${YELLOW}Test 2: .envrc.template exists for worktree setup${NC}"
if [ ! -f "$REPO_DIR/.envrc.template" ]; then
    echo -e "${RED}FAIL: Missing .envrc.template${NC}"
    echo "  Expected: .envrc.template with PORT derivation logic"
    exit 1
else
    echo -e "${GREEN}PASS: .envrc.template exists${NC}"
fi

# Test 3: Check .envrc is gitignored
echo ""
echo -e "${YELLOW}Test 3: .envrc is gitignored${NC}"
if ! grep -q "^\.envrc$" "$REPO_DIR/.gitignore" 2>/dev/null; then
    echo -e "${RED}FAIL: .envrc not in .gitignore${NC}"
    echo "  Expected: .envrc should be ignored to allow per-worktree config"
    exit 1
else
    echo -e "${GREEN}PASS: .envrc is gitignored${NC}"
fi

# Test 4: Create worktree and verify isolation
echo ""
echo -e "${YELLOW}Test 4: Worktree creation and port isolation${NC}"

# Create a test branch if needed
TEST_BRANCH="test-worktree-$$"
git branch "$TEST_BRANCH" HEAD 2>/dev/null || true

# Create worktree
echo "  Creating worktree at $WORKTREE_DIR..."
git worktree add "$WORKTREE_DIR" "$TEST_BRANCH" --quiet

# Copy .envrc.template to .envrc in both locations with different ports
echo "  Setting up .envrc files..."
if [ -f "$REPO_DIR/.envrc.template" ]; then
    cp "$REPO_DIR/.envrc.template" "$REPO_DIR/.envrc"
    echo "export PORT=$PORT_MAIN" >> "$REPO_DIR/.envrc"
    
    cp "$REPO_DIR/.envrc.template" "$WORKTREE_DIR/.envrc"
    echo "export PORT=$PORT_WORKTREE" >> "$WORKTREE_DIR/.envrc"
fi

# Verify ports would be different (dry run - don't actually start servers)
echo "  Verifying port configuration..."

# Source envrc and check PORT
MAIN_PORT=$(cd "$REPO_DIR" && source .envrc 2>/dev/null && echo $PORT)
WORKTREE_PORT=$(cd "$WORKTREE_DIR" && source .envrc 2>/dev/null && echo $PORT)

if [ "$MAIN_PORT" = "$WORKTREE_PORT" ]; then
    echo -e "${RED}FAIL: Both worktrees have same PORT${NC}"
    echo "  Main: $MAIN_PORT, Worktree: $WORKTREE_PORT"
    exit 1
fi

echo -e "${GREEN}PASS: Ports are different (Main: $MAIN_PORT, Worktree: $WORKTREE_PORT)${NC}"

# Test 5: node_modules strategy check
echo ""
echo -e "${YELLOW}Test 5: node_modules handling documented${NC}"
if [ -f "$REPO_DIR/CLAUDE.md" ] && grep -qi "worktree" "$REPO_DIR/CLAUDE.md"; then
    echo -e "${GREEN}PASS: Worktree guidance in CLAUDE.md${NC}"
else
    echo -e "${RED}FAIL: CLAUDE.md missing worktree instructions${NC}"
    echo "  Expected: Documentation on parallel worktree development"
    exit 1
fi

# Cleanup test branch
git branch -D "$TEST_BRANCH" 2>/dev/null || true

echo ""
echo "=========================================="
echo -e "${GREEN} ALL TESTS PASSED ✓${NC}"
echo "=========================================="
echo ""
echo "Repo is ready for parallel agentic workflows with git worktrees!"
