echo "Stopping and removing containers..."
dokcer compose -f docker-compose.yml down
echo "Containers stopped and removed."