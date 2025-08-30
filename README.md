Shared database package with REST API and SDK for Cartel.

## Features

- **REST API Server** - Hono-based API server with OAuth 2.0-style authentication
- **TypeScript SDK** - Type-safe client with automatic token management
- **Database Schema** - Drizzle ORM schema definitions
- **Bearer Token Auth** - JWT access tokens with refresh token rotation
- **API Key Auth** - Server-to-server authentication for applications
- **Multi-Identity Support** - Users can have multiple identities (EVM, Lens, Farcaster, Discord, Telegram)
- **Rate Limiting** - Dynamic rate limits based on authentication type
- **Identity Management** - Admin routes for connecting, disconnecting, and merging user identities

## Installation

```bash
# Install dependencies
bun install

# Copy environment variables
cp .env.example .env

# Edit .env with your database credentials and JWT secret
```

## Environment Variables

Create a `.env` file with the following variables:

```env
# PostgreSQL connection string
DATABASE_URL=postgres://username:password@host:port/database

# JWT Secret for token signing (required, minimum 32 characters)
JWT_SECRET=your-secret-key-minimum-32-characters-change-in-production

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

The API follows OAuth 2.0 patterns with bearer tokens and API keys.

### Token-Based Authentication Flow

1. **Client generates SIWE message** with wallet address
2. **User signs the message** in their wallet  
3. **Client sends to API** with signature and API key:
   ```http
   POST /api/auth/verify
   X-API-Key: <client-api-key>
   Content-Type: application/json
   
   {
     "message": "...",
     "signature": "0x..."
   }
   ```
4. **API validates** and returns tokens:
   ```json
   {
     "accessToken": "eyJhbGc...",
     "refreshToken": "crt_ref_...",
     "expiresIn": 900,
     "tokenType": "Bearer",
     "userId": "...",
     "address": "0x..."
   }
   ```
5. **Client uses access token** for API requests:
   ```http
   GET /api/users/me
   Authorization: Bearer <access-token>
   ```

### Token Management

- **Access tokens** expire in 15 minutes
- **Refresh tokens** expire in 30 days  
- **Token rotation** - Old refresh tokens are invalidated when used
- **Automatic refresh** - SDK handles token refresh automatically

### Refresh Token Flow

When access token expires:
```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "crt_ref_..."
}
```

Returns new token pair:
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "crt_ref_...",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

### API Keys (Server-to-Server)

API keys are used for:
- Initial SIWE authentication (required)
- Server-to-server API calls
- Higher rate limits

```http
X-API-Key: cartel_<32-character-key>
```

**API Key Features:**
- **Client identification** - Each application has its own key
- **Allowed origins** - Whitelist of domains for SIWE validation
- **Rate limiting** - Per-key rate limits
- **Scopes** - Control access permissions

## SDK Usage

### TypeScript/JavaScript

```typescript
import { CartelClient } from "@cartel/api/client";

// Initialize client
const client = new CartelClient(
  "https://api.cartel.sh",
  "cartel_your_api_key_here"
);

// Authenticate with SIWE
const auth = await client.verifySiwe(message, signature);
// Tokens are automatically stored and managed

// Make authenticated requests
const user = await client.getCurrentUser();

// Logout (clears tokens)
client.logout();
```

### Token Storage

The SDK provides flexible token storage:

```typescript
// Browser - uses localStorage by default
const client = new CartelClient(apiUrl, apiKey);

// Node.js - uses in-memory storage by default
const client = new CartelClient(apiUrl, apiKey);

// Custom storage implementation
import { InMemoryTokenStorage } from "@cartel/api/client";
const storage = new InMemoryTokenStorage();
const client = new CartelClient(apiUrl, apiKey, storage);
```

## API Endpoints

### Authentication

- `POST /api/auth/verify` - Verify SIWE signature and get tokens
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Get current user info
- `POST /api/auth/revoke` - Revoke all refresh tokens

### User Management

- `GET /api/users/id/discord/:discordId` - Get user ID by Discord ID
- `POST /api/users/identities/lookup` - Lookup user by various identities
- `POST /api/users/identities` - Add identity to user
- `DELETE /api/users/identities/:userId/:platform/:identity` - Remove identity

### Discord Integration

- `POST /api/discord/vanish` - Create vanishing channel
- `DELETE /api/discord/vanish/:channelId` - Remove vanishing channel
- `GET /api/discord/vanish` - List vanishing channels
- `POST /api/discord/channels` - Set guild channel
- `GET /api/discord/channels/:guildId/:key` - Get guild channel

### Practice Sessions

- `POST /api/sessions/practice` - Start practice session
- `POST /api/sessions/practice/stop` - Stop practice session
- `GET /api/sessions/practice/stats/daily/:discordId` - Get daily stats
- `GET /api/sessions/practice/stats/weekly/:discordId` - Get weekly stats

### Applications

- `POST /api/users/applications` - Create application
- `GET /api/users/applications/pending` - Get pending applications
- `PATCH /api/users/applications/:applicationId` - Update application status
- `POST /api/users/applications/:applicationId/vote` - Add vote to application

### Projects

- `POST /api/projects` - Create project
- `GET /api/projects/:projectId` - Get project
- `PATCH /api/projects/:projectId` - Update project
- `DELETE /api/projects/:projectId` - Delete project
- `GET /api/projects/user/:userId` - Get user's projects

### Admin

- `POST /api/admin/keys` - Create API key (requires admin scope)
- `GET /api/admin/keys` - List API keys
- `DELETE /api/admin/keys/:keyId` - Delete API key
- `POST /api/admin/identities/merge` - Merge user accounts

## Rate Limiting

Dynamic rate limits based on authentication:

| Auth Type | Requests/Minute |
|-----------|----------------|
| Root/Admin | 1000 |
| API Key | 100 |
| Bearer Token | 60 |
| Unauthenticated | 20 |

Special limits for sensitive operations:
- Auth endpoints: 5 requests per 15 minutes
- Write operations: 20 requests per minute

Rate limit headers:
```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1234567890
```

## Security

### Best Practices

- **Never expose tokens** - Access tokens are short-lived (15 min)
- **Use HTTPS** - Always use HTTPS in production
- **Rotate refresh tokens** - Old tokens are invalidated on use
- **Secure storage** - SDK handles secure token storage
- **API key security** - Keep API keys secret, rotate regularly

### Token Security Features

- **Short-lived access tokens** - Minimize exposure window
- **Refresh token rotation** - Detect and prevent token theft
- **Token families** - Track refresh token lineage
- **Automatic revocation** - Revoke entire family on suspicious activity

### SIWE Security

- **Client-side nonce generation** - Prevents replay attacks
- **Domain validation** - API keys restrict allowed origins
- **Timestamp validation** - Messages expire after set time
- **Signature verification** - Cryptographic proof of ownership

## Building

```bash
# Build for production
bun run build

# Type checking
bun run typecheck

# Linting
npx @biomejs/biome check --write .
```

## API Documentation

- Interactive API docs available at `/reference` when server is running
- OpenAPI spec at `/openapi.json`
- LLM-friendly docs at `/llms.txt`

## License

ISC

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request