Shared database package with REST API and SDK for Cartel.

## Features

- **REST API Server** - Hono-based API server with authentication
- **TypeScript SDK** - Type-safe client for interacting with the API
- **Database Schema** - Drizzle ORM schema definitions
- **API Authentication** - Secure API key-based authentication
- **Multi-Identity Support** - Users can have multiple identities (EVM, Lens, Farcaster, Discord, Telegram)
- **Identity Management** - Admin routes for connecting, disconnecting, and merging user identities

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

The API uses JWT tokens for authentication and API keys for future rate limiting.

### JWT Authentication (Required for protected routes)

Protected routes require a JWT token in the Authorization header:
```
Authorization: Bearer <jwt-token>
```

JWTs are obtained through SIWE (Sign-In with Ethereum) authentication:
1. Request a nonce from `/api/auth/nonce`
2. Sign the message with your wallet
3. Verify signature at `/api/auth/verify` to receive JWT

### API Keys (Optional, for rate limiting)

API keys can be included for future rate limiting purposes:
```
X-API-Key: <api-key>
```

API keys are stored in the database with:
- **Multiple keys** - Each user can have multiple API keys
- **Scoped access** - Keys can have different permission scopes (for future use)
- **Key rotation** - Rotate keys with grace periods
- **Expiration** - Optional expiration dates
- **Usage tracking** - Track last usage

**Note:** API keys alone do not grant authentication - use JWT tokens for authenticated requests.

## API Endpoints

Public endpoints are accessible without authentication. Protected endpoints require JWT authentication via `Authorization: Bearer <token>` header.

### Health Check
- `GET /health` - Server health status (public)

### Authentication
- `POST /api/auth/nonce` - Get nonce for SIWE (public)
- `POST /api/auth/verify` - Verify SIWE signature and get JWT (public)
- `GET /api/auth/me` - Get current user info (requires JWT)

### Projects
- `GET /api/projects` - List public projects (public) or all user projects (with JWT)
- `GET /api/projects/{id}` - Get project details (public if project is public)
- `POST /api/projects` - Create project (requires JWT)
- `PATCH /api/projects/{id}` - Update project (requires JWT)
- `DELETE /api/projects/{id}` - Delete project (requires JWT)
- `GET /api/projects/user/{userId}` - Get user's projects (public projects only without JWT)
- `GET /api/projects/tags/popular` - Get popular tags (public)

### API Key Management (Requires JWT + Admin role)
- `POST /api/admin/keys` - Generate a new API key
- `GET /api/admin/keys` - List all API keys
- `GET /api/admin/keys/{keyId}` - Get specific key details
- `PATCH /api/admin/keys/{keyId}` - Update key (name, description, scopes, active status)
- `DELETE /api/admin/keys/{keyId}` - Deactivate an API key
- `POST /api/admin/keys/{keyId}/rotate` - Rotate an API key with grace period

### Discord - Vanishing Channels
- `GET /api/discord/vanish` - List all vanishing channels
- `GET /api/discord/vanish?guildId={id}` - List channels for a guild
- `GET /api/discord/vanish/{channelId}` - Get specific channel
- `POST /api/discord/vanish` - Create/update vanishing channel
- `DELETE /api/discord/vanish/{channelId}` - Remove vanishing channel
- `PATCH /api/discord/vanish/{channelId}/stats` - Update deletion stats

### Discord - Channel Settings
- `GET /api/discord/channels/{guildId}` - List all channel settings for a guild
- `GET /api/discord/channels/{guildId}/{key}` - Get specific channel setting (e.g., voice, text, alerts)
- `PUT /api/discord/channels/{guildId}/{key}` - Create/update channel setting
- `DELETE /api/discord/channels/{guildId}/{key}` - Delete specific channel setting
- `DELETE /api/discord/channels/{guildId}` - Delete all channel settings for a guild

### Practice Sessions
- `POST /api/sessions/practice/start` - Start a practice session (accepts discordId or userId)
- `POST /api/sessions/practice/stop` - Stop a practice session (accepts discordId or userId)
- `GET /api/sessions/practice/stats/daily/discord/{discordId}` - Get daily stats by Discord ID
- `GET /api/sessions/practice/stats/daily/user/{userId}` - Get daily stats by user UUID
- `GET /api/sessions/practice/stats/weekly/discord/{discordId}` - Get weekly stats by Discord ID
- `GET /api/sessions/practice/stats/weekly/user/{userId}` - Get weekly stats by user UUID
- `GET /api/sessions/practice/stats/monthly/discord/{discordId}` - Get monthly stats by Discord ID
- `GET /api/sessions/practice/stats/monthly/user/{userId}` - Get monthly stats by user UUID
- `GET /api/sessions/practice/leaderboard` - Get top users leaderboard
- `GET /api/sessions/practice/total-hours` - Get total tracked hours

### Applications
- `GET /api/users/applications` - List all applications
- `GET /api/users/applications/pending` - List pending applications
- `GET /api/users/applications/by-message/{messageId}` - Get application by message ID
- `GET /api/users/applications/by-number/{number}` - Get application by number
- `GET /api/users/applications/{applicationId}` - Get specific application
- `POST /api/users/applications` - Create application
- `PATCH /api/users/applications/{applicationId}/status` - Update application status
- `DELETE /api/users/applications/{applicationId}` - Delete application
- `POST /api/users/applications/{applicationId}/votes` - Add vote to application
- `GET /api/users/applications/{applicationId}/votes` - Get application votes

### User Identities
- `GET /api/users/id/by-evm/{address}` - Get user by Ethereum address
- `GET /api/users/id/by-lens/{address}` - Get user by Lens handle/address
- `GET /api/users/id/by-farcaster/{fid}` - Get user by Farcaster FID
- `GET /api/users/id/by-discord/{discordId}` - Get user by Discord ID
- `GET /api/users/id/by-telegram/{telegramId}` - Get user by Telegram ID
- `GET /api/users/identities/{userId}` - Get all identities for a user
- `POST /api/users/id` - Create user with identity (auto-creates user if needed)

### Admin - Identity Management (Admin Only)
- `POST /api/admin/identities/connect` - Connect identity to existing user
- `DELETE /api/admin/identities/disconnect` - Disconnect identity from user
- `PUT /api/admin/identities/set-primary` - Set identity as primary for user
- `POST /api/admin/identities/merge-users` - Merge two users by moving identities

## Authentication Tutorial (Next.js)

### Quick Setup

1. **Install dependencies:**
```bash
npm install siwe ethers
```

2. **Create auth hook (`hooks/useAuth.ts`):**
```typescript
import { useState } from 'react';
import { SiweMessage } from 'siwe';
import { BrowserProvider } from 'ethers';

export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  
  const signIn = async () => {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    
    // 1. Get nonce
    const nonceRes = await fetch('/api/auth/nonce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });
    const { nonce } = await nonceRes.json();
    
    // 2. Create and sign message
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in to Cartel',
      uri: window.location.origin,
      version: '1',
      chainId: 1,
      nonce
    });
    
    const signature = await signer.signMessage(message.prepareMessage());
    
    // 3. Verify and get JWT
    const verifyRes = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message.prepareMessage(),
        signature
      })
    });
    const { token } = await verifyRes.json();
    
    setToken(token);
    localStorage.setItem('jwt', token);
    return token;
  };
  
  return { token, signIn };
}
```

3. **Make authenticated requests:**
```typescript
const token = localStorage.getItem('jwt');

// Create a project
await fetch('/api/projects', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: 'My Project',
    description: 'Description here'
  })
});
```

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

// Example: Set a Discord channel setting
await client.setChannel('guild-id', 'voice', 'channel-id');
await client.setChannel('guild-id', 'text', 'channel-id');

// Example: Start a practice session with Discord ID
await client.startSession({ discordId: 'discord-id-here' });

// Example: Start a practice session with user UUID
await client.startSession({ userId: 'user-uuid-here' });

// Example: Get practice stats
const dailyStats = await client.getDailyStats('discord-id');
const weeklyStats = await client.getWeeklyStatsByUserId('user-uuid');

// Example: Get user by different identity types
// Using the unified getUser function
const userByEvm = await client.getUser({ evm: '0x1234...' });
const userByDiscord = await client.getUser({ discord: '123456789' });
const userByFarcaster = await client.getUser({ farcaster: '1234' });
const userByLens = await client.getUser({ lens: '0xabcd...' });
const userByTelegram = await client.getUser({ telegram: '987654321' });

// Or using individual methods
const user = await client.getUserByEvm('0x1234...');
const user2 = await client.getUserByDiscord('123456789');

// Get all identities for a user
const identities = await client.getUserIdentities('user-uuid');

// Create user with identity (auto-creates if needed)
const newUser = await client.createUserIdentity({
  platform: 'evm',
  identity: '0x5678...',
  isPrimary: true
});

// Admin: Connect additional identity to existing user
const connected = await client.connectIdentity({
  userId: 'user-uuid',
  platform: 'discord',
  identity: '123456789',
  isPrimary: false
});

// Admin: Set primary identity
await client.setPrimaryIdentity({
  platform: 'evm',
  identity: '0x1234...'
});

// Admin: Merge users
await client.mergeUsers('source-user-uuid', 'target-user-uuid');
```

### cURL Examples

#### Authentication Flow

```bash
# 1. Get nonce for SIWE
curl -X POST http://localhost:3003/api/auth/nonce \
  -H "Content-Type: application/json" \
  -d '{"address": "0x1234567890abcdef"}'

# 2. Verify signature and get JWT (after signing with wallet)
curl -X POST http://localhost:3003/api/auth/verify \
  -H "Content-Type: application/json" \
  -d '{
    "message": "<signed-message>",
    "signature": "<signature>"
  }'
# Response: {"token": "<jwt-token>", "userId": "...", "address": "..."}

# 3. Use JWT for authenticated requests
curl -X GET http://localhost:3003/api/auth/me \
  -H "Authorization: Bearer <jwt-token>"
```

#### Projects API

```bash
# List public projects (no auth required)
curl -X GET http://localhost:3003/api/projects

# Create a project (requires JWT)
curl -X POST http://localhost:3003/api/projects \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Project",
    "description": "Project description",
    "isPublic": true
  }'

# Update a project (requires JWT)
curl -X PATCH http://localhost:3003/api/projects/{id} \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description"}'
```

#### Discord & Sessions API

```bash
# Discord endpoints (may require auth based on configuration)
curl -X GET http://localhost:3003/api/discord/vanish

curl -X POST http://localhost:3003/api/discord/vanish \
  -H "Content-Type: application/json" \
  -d '{"channelId": "123", "guildId": "456", "duration": 3600}'

# Start a practice session
curl -X POST http://localhost:3003/api/sessions/practice/start \
  -H "Content-Type: application/json" \
  -d '{"discordId": "discord-id-here", "notes": "Practice notes"}'
```

#### User Identity Examples

```bash
# Public endpoints - no auth required
curl -X GET http://localhost:3003/api/users/id/by-evm/0x1234567890abcdef

curl -X GET http://localhost:3003/api/users/id/by-discord/123456789

curl -X GET http://localhost:3003/api/users/identities/user-uuid-here

# Create user with identity
curl -X POST http://localhost:3003/api/users/id \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "evm",
    "identity": "0x1234567890abcdef",
    "isPrimary": true
  }'
```

#### Admin Routes (requires JWT + admin role)

```bash
# Admin operations require JWT authentication
# TODO: Add role-based access control for admin operations

# Connect identity to existing user
curl -X POST http://localhost:3003/api/admin/identities/connect \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid-here",
    "platform": "discord",
    "identity": "123456789",
    "isPrimary": false
  }'

# API Key Management
curl -X POST http://localhost:3003/api/admin/keys \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid-here",
    "name": "Bot API Key",
    "scopes": ["read", "write"]
  }'
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
│   │       ├── discord/ # Discord-related routes
│   │       ├── sessions/# Session management routes
│   │       ├── users/   # User-related routes
│   │       └── admin/   # Admin routes
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