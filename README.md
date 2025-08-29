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

The API uses JWT tokens for authentication with client-side SIWE (Sign-In with Ethereum).

### JWT Authentication Flow

1. **Client generates SIWE message** with their own nonce
2. **User signs the message** in their wallet
3. **Client sends to API** with signature and API key:
   - Endpoint: `POST /api/auth/verify`
   - Headers: `X-API-Key: <client-api-key>`
   - Body: `{ message, signature }`
4. **API validates**:
   - API key identifies the client
   - Domain/URI matches client's allowed origins
   - Signature is valid
   - Timestamps are valid
5. **API returns success** and sets httpOnly cookie for authentication

Authentication is handled via secure httpOnly cookies - no manual token management needed.

### API Keys (Required for SIWE verification)

API keys identify client applications and configure SIWE validation:
```
X-API-Key: <api-key>
```

**API Key Features:**
- **Client identification** - Each client app has its own key
- **Allowed origins** - Whitelist of domains/URIs for SIWE
- **Rate limiting** - Keys will be used for rate limiting
- **Key rotation** - Rotate with grace periods
- **Usage tracking** - Monitor last usage

**Important:** API keys are required for SIWE verification but do not grant authentication by themselves. JWTs are required for protected routes.

## API Documentation

### Interactive Documentation
Full API documentation with request/response schemas is available at:
- **Interactive Docs**: `http://localhost:3003/docs` (when running locally)
- **OpenAPI Spec**: `http://localhost:3003/openapi.json`

The interactive documentation provides:
- Complete endpoint descriptions
- Request/response schemas
- Authentication requirements
- Try-it-out functionality
- Example requests and responses

### API Categories
The API is organized into the following categories:
- **Authentication** - SIWE verification and session management
- **Projects** - User project management
- **Discord** - Discord bot integrations (vanishing channels, settings)
- **Sessions** - Practice session tracking
- **Users** - User identity and application management  
- **Admin** - Administrative operations (requires admin role)

## Authentication Tutorial (Next.js)

### Quick Setup

1. **Install dependencies:**
```bash
npm install siwe ethers uuid
```

2. **Configure your API key** (store in environment variables):
```env
NEXT_PUBLIC_API_KEY=cartel_your-api-key-here
NEXT_PUBLIC_API_URL=https://api.cartel.sh
```

3. **Create auth hook (`hooks/useAuth.ts`):**
```typescript
import { useState } from 'react';
import { SiweMessage } from 'siwe';
import { BrowserProvider } from 'ethers';
import { v4 as uuidv4 } from 'uuid';

const API_KEY = process.env.NEXT_PUBLIC_API_KEY!;
const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const signIn = async () => {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    
    // 1. Create SIWE message with client-generated nonce
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in to MyApp',
      uri: window.location.origin,
      version: '1',
      chainId: 1,
      nonce: uuidv4(), // Client generates unique nonce
      expirationTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min
    });
    
    const messageToSign = message.prepareMessage();
    const signature = await signer.signMessage(messageToSign);
    
    // 2. Send to API with API key
    const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
      method: 'POST',
      credentials: 'include', // Include cookies
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: messageToSign,
        signature
      })
    });
    
    if (!verifyRes.ok) {
      throw new Error('Authentication failed');
    }
    
    const data = await verifyRes.json();
    setIsAuthenticated(true);
    return data;
  };
  
  const signOut = async () => {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include'
    });
    setIsAuthenticated(false);
  };
  
  return { isAuthenticated, signIn, signOut };
}
```

3. **Make authenticated requests:**
```typescript
// Authentication cookie is sent automatically
await fetch(`${API_URL}/api/projects`, {
  method: 'POST',
  credentials: 'include', // Include cookies
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: 'My Project',
    description: 'Description here'
  })
});

// Get current user
const userRes = await fetch(`${API_URL}/api/auth/me`, {
  credentials: 'include'
});
const user = await userRes.json();
```

## Using the SDK

### SDK Authentication with SIWE

```typescript
import { CartelDBClient } from '@cartel-sh/db/client';
import { SiweMessage } from 'siwe';
import { BrowserProvider } from 'ethers';

// Initialize client with your API key
const client = new CartelDBClient(
  'https://api.cartel.sh',
  'cartel_your-api-key-here' // Required for SIWE verification
);

// Authentication flow
async function authenticate() {
  // 1. Get wallet address
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  
  // 2. Create SIWE message (client-side)
  const message = new SiweMessage({
    domain: window.location.host,
    address,
    statement: 'Sign in to MyApp',
    uri: window.location.origin,
    version: '1',
    chainId: 1,
    nonce: crypto.randomUUID(), // Client generates nonce
    expirationTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  
  // 3. Sign message with wallet
  const messageToSign = message.prepareMessage();
  const signature = await signer.signMessage(messageToSign);
  
  // 4. Verify with Cartel API
  const authResponse = await client.verifySiwe(messageToSign, signature);
  console.log('Authenticated:', authResponse);
  // Cookie is automatically set by the API
  
  // 5. Authentication complete - cookie will be sent with requests
  const user = await client.getCurrentUser();
  console.log('Current user:', user);
  
  return authResponse;
}

// Logout
async function logout() {
  await client.logout(); // Clears the httpOnly cookie
  console.log('Logged out');
}
```

### Node.js/Server-Side Authentication

```typescript
import { CartelDBClient } from '@cartel-sh/db/client';
import { SiweMessage } from 'siwe';

// Initialize client with your API key
const client = new CartelDBClient(
  process.env.CARTEL_API_URL!,
  process.env.CARTEL_API_KEY! // Your app's API key
);

// Server-side SIWE verification
async function verifyUserAuth(message: string, signature: string) {
  try {
    // Verify with Cartel API - cookie will be set automatically
    const authResponse = await client.verifySiwe(message, signature);
    
    // The API sets an httpOnly cookie that will be included in subsequent requests
    // No need to manually handle JWT tokens
    return authResponse;
  } catch (error) {
    console.error('Authentication failed:', error);
    throw error;
  }
}

// Make authenticated requests - cookies are sent automatically
async function createUserProject(projectData: any) {
  // No need to pass JWT - cookie is sent automatically
  const project = await client.createProject(projectData);
  return project;
}

// Get current user - cookie is sent automatically
async function getCurrentUserInfo() {
  const user = await client.getCurrentUser();
  return user;
}

// Logout
async function logoutUser() {
  await client.logout(); // Clears the httpOnly cookie
}
```

### SDK Usage Examples

```typescript
import { CartelDBClient } from '@cartel-sh/db/client';

// Initialize client
const client = new CartelDBClient(
  'https://api.cartel.sh',
  'cartel_your-api-key-here'
);

// After authentication (cookie is set automatically)
// Projects API
const projects = await client.getProjects();
const project = await client.createProject({
  title: 'My Project',
  description: 'A great project',
  isPublic: true
});
await client.updateProject(project.id, { description: 'Updated' });
await client.deleteProject(project.id);

// User identities
const userByEvm = await client.getUser({ evm: '0x1234...' });
const userByDiscord = await client.getUser({ discord: '123456789' });
const identities = await client.getUserIdentities('user-uuid');

// Discord integrations (may not require JWT)
await client.setVanishingChannel('channel-id', 'guild-id', 3600);
await client.setChannel('guild-id', 'voice', 'channel-id');

// Practice sessions
await client.startSession({ discordId: 'discord-id' });
const stats = await client.getDailyStats('discord-id');

// Admin operations (requires JWT with admin role)
const newUser = await client.createUserIdentity({
  platform: 'evm',
  identity: '0x5678...',
  isPrimary: true
});

await client.connectIdentity({
  userId: 'user-uuid',
  platform: 'discord',
  identity: '123456789',
  isPrimary: false
});
```

### cURL Examples

#### Authentication Flow

```bash
# Client-side SIWE authentication
# 1. Client generates SIWE message with their own nonce
# 2. User signs the message
# 3. Send to API with API key for verification

curl -X POST http://localhost:3003/api/auth/verify \
  -H "X-API-Key: cartel_your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "example.com wants you to sign in with your Ethereum account:\n0x1234...\n\nSign in to MyApp\n\nURI: https://example.com\nVersion: 1\nChain ID: 1\nNonce: unique-client-nonce\nIssued At: 2024-01-01T00:00:00.000Z",
    "signature": "0xsignature..."
  }'
# Response: {"userId": "...", "address": "...", "clientName": "MyApp"}
# Cookie is set automatically

# Subsequent requests include cookie automatically
curl -X GET http://localhost:3003/api/auth/me \
  -b cookies.txt -c cookies.txt

# Logout - clears cookie
curl -X POST http://localhost:3003/api/auth/logout \
  -b cookies.txt -c cookies.txt
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
# Create API key with client configuration
curl -X POST http://localhost:3003/api/admin/keys \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid-here",
    "name": "MyApp Production",
    "clientName": "MyApp",
    "allowedOrigins": [
      "myapp.com",
      "www.myapp.com",
      "*.myapp.com",
      "localhost:3000"
    ],
    "scopes": ["read", "write"],
    "description": "Production API key for MyApp"
  }'
# Response includes the API key (shown only once)

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

### Client-Side SIWE Security

- **Origin Validation**: Each API key has allowed origins to prevent domain spoofing
- **Client-Generated Nonces**: Clients generate unique nonces, preventing replay attacks
- **Timestamp Validation**: Messages have expiration times to limit validity window
- **Signature Verification**: Cryptographic verification ensures message authenticity
- **Client Identification**: API keys identify which client authenticated users

### API Key Security

- **Database Storage**: API keys are hashed using SHA-256 before storage - raw keys are never stored
- **One-Time Display**: API keys are shown only once during creation and cannot be retrieved later
- **Allowed Origins**: Configure trusted domains/URIs per client application
- **Key Rotation**: Support for rotating keys with grace periods to prevent downtime
- **Usage Tracking**: Monitor last usage timestamps to identify inactive keys

### Best Practices

- **Unique Keys Per Application**: Each client app should have its own API key
- **Restrict Origins**: Only allow necessary domains in `allowedOrigins`
- **Use Wildcards Carefully**: Be specific with subdomain wildcards (e.g., `*.app.example.com`)
- **Environment Variables**: Never commit API keys to version control
- **HTTPS Only**: Always use HTTPS in production
- **Monitor Usage**: Review API key usage patterns for anomalies
- **Short Message Expiry**: Use short expiration times for SIWE messages (15-30 minutes)

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