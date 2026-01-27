#!/bin/bash

echo "INFO: Starting 2KS Keycloak-Stalwart-Roundcube SSO Demo..."

# Check if backend is running
#if pgrep -f "node server.js" > /dev/null; then
#    echo "WARN:  Backend server is already running"
#fi

# Check if backend (3010) is listening
if lsof -PiTCP -sTCP:LISTEN -n | grep ':3010 ' >/dev/null; then
    echo "WARN:  Backend server is already running"
else
    echo "🔧 Starting backend server..."
    cd backend
    npm start &
    cd ..
    sleep 3
fi

echo ""
echo "OK Servers are starting up..."
echo ""
echo "The application will be available at:"
echo "- Backend: http://localhost:3010"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Wait for user to stop
wait 
