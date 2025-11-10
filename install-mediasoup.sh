#!/bin/bash

echo "🔧 Installing MediaSoup dependencies..."
echo "This will take 5-10 minutes (compiling C++ code)"
echo ""

# Check dependencies
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 not found. Installing..."
    sudo apt update
    sudo apt install -y python3 python3-pip
fi

if ! command -v gcc &> /dev/null; then
    echo "❌ Build tools not found. Installing..."
    sudo apt install -y build-essential
fi

# Install MediaSoup
echo ""
echo "📦 Installing mediasoup + mediasoup-client..."
echo "Progress will be shown below:"
echo ""

npm install mediasoup mediasoup-client

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ MediaSoup installation successful!"
    echo ""
    echo "Next steps:"
    echo "1. Read MEDIASOUP_INTEGRATION.md"
    echo "2. Update AudioEngine to use RTP output"
    echo "3. Replace serverClient with mediaSoupClient"
    echo ""
else
    echo ""
    echo "❌ MediaSoup installation failed!"
    echo "Check the error messages above."
    echo ""
    echo "Common fixes:"
    echo "  - sudo apt install python3 python3-pip build-essential"
    echo "  - rm -rf node_modules package-lock.json && npm install"
    echo ""
    exit 1
fi
