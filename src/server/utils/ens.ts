import { ethers } from "ethers";

export interface ENSProfile {
	name: string | null;
	avatar: string | null;
}

// ENS resolution cache to avoid repeated lookups
const ensCache = new Map<string, { profile: ENSProfile; timestamp: number }>();
const CACHE_DURATION = 3600000; // 1 hour in milliseconds

// Default public Ethereum RPC endpoint (can be overridden via env)
const DEFAULT_RPC_URL = "https://eth.llamarpc.com";

/**
 * Resolve ENS name and avatar for an Ethereum address
 */
export async function resolveENSProfile(address: string): Promise<ENSProfile> {
	// Validate Ethereum address
	if (!ethers.isAddress(address)) {
		return { name: null, avatar: null };
	}

	const normalizedAddress = address.toLowerCase();

	// Check cache
	const cached = ensCache.get(normalizedAddress);
	if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
		return cached.profile;
	}

	try {
		const rpcUrl = process.env.ETH_RPC_URL || DEFAULT_RPC_URL;
		const provider = new ethers.JsonRpcProvider(rpcUrl);

		// Resolve ENS name from address
		const ensName = await provider.lookupAddress(address);
		let avatar: string | null = null;

		// If we have an ENS name, try to get the avatar
		if (ensName) {
			try {
				const resolver = await provider.getResolver(ensName);
				if (resolver) {
					avatar = await resolver.getAvatar();
				}
			} catch (avatarError) {
				console.error(`Failed to resolve avatar for ${ensName}:`, avatarError);
			}
		}

		const profile: ENSProfile = { name: ensName, avatar };

		// Cache the result
		ensCache.set(normalizedAddress, {
			profile,
			timestamp: Date.now(),
		});

		return profile;
	} catch (error) {
		console.error(`Failed to resolve ENS for address ${address}:`, error);
		
		const profile: ENSProfile = { name: null, avatar: null };
		
		// Cache the failure to avoid repeated failed lookups
		ensCache.set(normalizedAddress, {
			profile,
			timestamp: Date.now(),
		});

		return profile;
	}
}


/**
 * Clear the ENS cache
 */
export function clearENSCache(): void {
	ensCache.clear();
}

/**
 * Get cache statistics
 */
export function getENSCacheStats() {
	return {
		size: ensCache.size,
		entries: Array.from(ensCache.entries()).map(([address, data]) => ({
			address,
			profile: data.profile,
			age: Date.now() - data.timestamp,
		})),
	};
}

/**
 * Backward compatibility - resolve just ENS name
 */
export async function resolveENS(address: string): Promise<string | null> {
	const profile = await resolveENSProfile(address);
	return profile.name;
}