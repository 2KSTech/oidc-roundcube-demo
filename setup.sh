#!/bin/bash

echo "INFO: Setting up  App..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "FAIL Node.js is not installed. Please install Node.js v20 or higher."
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "FAIL Python 3 is not installed. Please install Python 3.7 or higher."
    exit 1
fi

echo "OK Prerequisites check passed"

# Install backend dependencies
echo " Installing backend dependencies..."
cd backend
npm install

# Check if .env file exists
if [ ! -f .env ]; then
    echo "YOU MUST have a valid .env file to run this app"
    echo " ... Creating .env file from template..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "WARN:  Please edit .env file with your Keycloak, Stalwart, and Roundcube configurations"
        exit 1
    else
        echo "FAIL .env.example not found. Please create .env file manually."
        exit 1
    fi
else
    echo "OK .env file already exists"
fi

# Go back to root directory
cd ..

echo ""
echo "* Setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Configure your Keycloak, Stalwart, and Roundcube settings in backend/.env"
echo "3. Install node packages: npm install"
echo "2. Start the backend server: cd backend && npm start"
echo ""
echo "The application will be available at:"
echo "- Backend: http://localhost:3010"
echo ""
echo "Happy Testing!" 
