# Deployment

Recommended deployment:

- Web app served by Nginx
- API service behind reverse proxy
- Local PostgreSQL database service
- Daily database backup
- Local file storage for machine imports and inspection images
- LAN access for shop-floor devices

For the current project setup on a single computer:

- Install PostgreSQL locally on that machine
- Keep the database service running automatically
- Point the application to the local PostgreSQL host and port
