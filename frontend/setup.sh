#!/bin/bash

echo "🚀 Setting up Observability Dashboard..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Copy environment file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your Sentry DSN and other configurations"
fi

echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration"
echo "2. Start the backend API on http://localhost:3000"
echo "3. Run 'npm run dev' to start the development server"
echo "4. Open http://localhost:5173 in your browser"
echo ""
echo "Optional setup:"
echo "- Configure Sentry DSN in .env for error tracking"
echo "- Start Jaeger for trace visualization: docker run -p 16686:16686 -p 14268:14268 jaegertracing/all-in-one:latest"