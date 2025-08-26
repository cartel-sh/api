# @cartel-sh/db

Shared database package with REST API for Cartel - a Discord bot ecosystem with PostgreSQL backend.

## Features

- **REST API Server** - Hono-based API server with authentication
- **TypeScript SDK** - Type-safe client for interacting with the API
- **Database Schema** - Drizzle ORM schema definitions
- **API Authentication** - Secure API key-based authentication

## Installation

```bash
# Install dependencies
bun install

# Copy environment variables
cp .env.example .env

# Edit .env with your database credentials and API key
```

## Environment Variables

Create a `.env` file with the following variables:

```env
# PostgreSQL connection string
DATABASE_URL=postgres://username:password@host:port/database

# Server port (default: 3003)
PORT=3003

# API authentication key (required)
API_KEY=your-secure-api-key-here
```

## Development

### Start the API Server

```bash
# Development mode with hot reload
bun run server:dev

# Production mode
bun run server
```

The API server will be available at `http://localhost:3003`

### Database Management

```bash
# Generate migrations
bun run db:generate

# Run migrations
bun run db:migrate

# Push schema changes directly (development)
bun run db:push

# Open Drizzle Studio (database GUI)
bun run db:studio
```

## API Endpoints

All API endpoints require the `X-API-Key` header with your configured API key.

### Health Check
- `GET /health` - Server health status (no auth required)

### Vanishing Channels
- `GET /api/vanishing-channels` - List all vanishing channels
- `GET /api/vanishing-channels?guildId={id}` - List channels for a guild
- `GET /api/vanishing-channels/{channelId}` - Get specific channel
- `POST /api/vanishing-channels` - Create/update vanishing channel
- `DELETE /api/vanishing-channels/{channelId}` - Remove vanishing channel
- `PATCH /api/vanishing-channels/{channelId}/stats` - Update deletion stats

### Practice Sessions
- `GET /api/practice-sessions` - List all practice sessions
- `GET /api/practice-sessions?userId={id}` - List sessions for a user
- `GET /api/practice-sessions/{sessionId}` - Get specific session
- `POST /api/practice-sessions` - Create practice session
- `PATCH /api/practice-sessions/{sessionId}` - Update session
- `DELETE /api/practice-sessions/{sessionId}` - Delete session

### Channel Settings
- `GET /api/channel-settings` - List all channel settings
- `GET /api/channel-settings/{channelId}` - Get channel settings
- `POST /api/channel-settings` - Create/update channel settings
- `DELETE /api/channel-settings/{channelId}` - Delete channel settings

### Applications
- `GET /api/applications` - List all applications
- `GET /api/applications/{applicationId}` - Get specific application
- `POST /api/applications` - Create application
- `PATCH /api/applications/{applicationId}` - Update application
- `DELETE /api/applications/{applicationId}` - Delete application

### Users
- `GET /api/users` - List all users
- `GET /api/users/{userId}` - Get specific user
- `POST /api/users` - Create/update user
- `DELETE /api/users/{userId}` - Delete user

## Using the SDK

### JavaScript/TypeScript Client

```typescript
import { CartelDBClient } from '@cartel-sh/db/client';

// Initialize client
const client = new CartelDBClient(
  'http://localhost:3003',
  'your-api-key-here'
);

// Example: Create a vanishing channel
await client.setVanishingChannel(
  'channel-id',
  'guild-id',
  3600 // duration in seconds
);

// Example: Get all vanishing channels
const channels = await client.getVanishingChannels();

// Example: Remove a vanishing channel
await client.removeVanishingChannel('channel-id');
```

### cURL Examples

```bash
# Get all vanishing channels
curl -X GET http://localhost:3003/api/vanishing-channels \
  -H "X-API-Key: your-api-key-here"

# Create a vanishing channel
curl -X POST http://localhost:3003/api/vanishing-channels \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"channelId": "123", "guildId": "456", "duration": 3600}'

# Delete a vanishing channel
curl -X DELETE http://localhost:3003/api/vanishing-channels/123 \
  -H "X-API-Key: your-api-key-here"
```

## Building for Production

```bash
# Build the package
bun run build

# Start production server
bun run start
```

## Testing

```bash
# Run type checking
bun run typecheck

# Test API endpoints
curl http://localhost:3003/health
```

## Project Structure

```
├── src/
│   ├── client/          # SDK client code
│   │   ├── index.ts     # Client exports
│   │   └── sdk.ts       # API client implementation
│   ├── server/          # API server code
│   │   ├── index.ts     # Server entry point
│   │   └── routes/      # API route handlers
│   ├── schema.ts        # Database schema definitions
│   ├── client.ts        # Database client setup
│   └── migrate.ts       # Migration runner
├── dist/                # Built output
├── drizzle/             # Database migrations
└── .env                 # Environment variables
```

## Security

- **API Key Required**: All API endpoints require authentication via `X-API-Key` header
- **Environment Variables**: Never commit `.env` files to version control
- **Production Keys**: Always use strong, randomly generated API keys in production
- **CORS**: Configured for cross-origin requests (adjust for production)

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

For issues and questions, please open an issue on GitHub.