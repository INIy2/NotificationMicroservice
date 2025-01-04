# Use the official Node.js image
FROM node:20

# Установка PostgreSQL-клиента
RUN apt-get update && apt-get install -y postgresql-client && apt-get clean


# Set the working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Expose the port your app runs on
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Start the app
CMD ["node", "app.js"]