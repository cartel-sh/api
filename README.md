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

# Root API key (optional)
# This key bypasses database authentication and has full system access
# Use only for administration and emergency access
# API_KEY=your-root-api-key-here
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

## Authentication

The API uses database-managed API keys for authentication. Each request must include an `X-API-Key` header.

### Root Key (Optional)

A root API key can be configured via the `API_KEY` environment variable. This key:
- Bypasses database authentication entirely
- Has full access to all endpoints
- Cannot be revoked via API
- Should only be used for system administration

### Database API Keys

API keys are stored in the database with the following features:
- **Multiple keys** - Each user can have multiple API keys
- **Scoped access** - Keys can have different permission scopes (read, write, admin)
- **Key rotation** - Rotate keys with a grace period for seamless transitions
- **Expiration** - Set optional expiration dates for temporary access
- **Usage tracking** - Track when keys were last used

## API Endpoints

All API endpoints require the `X-API-Key` header with a valid API key.

### Health Check
- `GET /health` - Server health status (no auth required)

### API Key Management (Admin Only)
- `POST /api/admin/keys` - Generate a new API key
- `GET /api/admin/keys` - List all API keys
- `GET /api/admin/keys/{keyId}` - Get specific key details
- `PATCH /api/admin/keys/{keyId}` - Update key (name, description, scopes, active status)
- `DELETE /api/admin/keys/{keyId}` - Deactivate an API key
- `POST /api/admin/keys/{keyId}/rotate` - Rotate an API key with grace period

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

#### API Key Management (requires admin scope)

```bash
# Generate a new API key
curl -X POST http://localhost:3003/api/admin/keys \
  -H "X-API-Key: your-admin-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid-here",
    "name": "My API Key",
    "description": "Key for my bot",
    "scopes": ["read", "write"],
    "expiresIn": 2592000  # Optional: 30 days in seconds
  }'

# List all API keys
curl -X GET http://localhost:3003/api/admin/keys \
  -H "X-API-Key: your-admin-key-here"

# Rotate an API key
curl -X POST http://localhost:3003/api/admin/keys/{keyId}/rotate?gracePeriod=300 \
  -H "X-API-Key: your-admin-key-here"

# Deactivate an API key
curl -X DELETE http://localhost:3003/api/admin/keys/{keyId} \
  -H "X-API-Key: your-admin-key-here"
```

#### Regular API Usage

```bash
# Get all vanishing channels
curl -X GET http://localhost:3003/api/vanishing-channels \
  -H "X-API-Key: cartel_your-api-key-here"

# Create a vanishing channel
curl -X POST http://localhost:3003/api/vanishing-channels \
  -H "X-API-Key: cartel_your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"channelId": "123", "guildId": "456", "duration": 3600}'

# Delete a vanishing channel
curl -X DELETE http://localhost:3003/api/vanishing-channels/123 \
  -H "X-API-Key: cartel_your-api-key-here"
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

### API Key Security

- **Database Storage**: API keys are hashed using SHA-256 before storage - raw keys are never stored
- **One-Time Display**: API keys are shown only once during creation and cannot be retrieved later
- **Scoped Access**: Keys can be limited to specific permissions (read, write, admin)
- **Key Rotation**: Support for rotating keys with grace periods to prevent downtime
- **Expiration**: Keys can have optional expiration dates for temporary access
- **Usage Tracking**: Last usage timestamps help identify inactive keys

### Best Practices

- **Unique Keys Per Service**: Generate separate API keys for each service or bot
- **Regular Rotation**: Rotate keys periodically, especially for high-privilege access
- **Minimal Scopes**: Grant only the minimum required permissions
- **Environment Variables**: Never commit API keys to version control
- **HTTPS Only**: Always use HTTPS in production to prevent key interception
- **Monitor Usage**: Regularly review API key usage patterns for anomalies

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