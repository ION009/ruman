#!/bin/sh
set -e

# Run migrations explicitly using the npm script, forcing changes
echo "Running database migrations..."
npm run db:push -- --force

# Start the application
echo "Starting application..."
exec "$@" 