#!/bin/bash

echo "INFO: Starting 2KS Keycloak-Stalwart-Roundcube SSO Demo..."

# Check if backend is running
#if pgrep -f "node server.js" > /dev/null; then
#fi

# Check if backend (3010) is listening
if lsof -PiTCP -sTCP:LISTEN -n | grep ':3010 ' >/dev/null; then
    echo "WARN:  Backend server is already running"
else
    echo "🔧 Starting backend server..."
    cd backend
    NODE_ENV=production npm start &
    cd ..
    sleep 3
fi

echo ""
echo "OK Server(s) are starting up..."
echo ""
echo "If you already configured 'your-demo.example.com',"
echo "secure domain to serve demo app over https via local port 3010,"
echo "then the demo application will be available at:"
echo ""
echo "- Backend: https://your-demo.example.com"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Wait for user to stop
wait 
