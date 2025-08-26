import { and, eq } from "drizzle-orm";
import { db, userIdentities, users } from "../client";

export const getUserByDiscordId = async (discordId: string): Promise<string> => {
  const identity = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.platform, "discord"),
      eq(userIdentities.identity, discordId),
    ),
  });

  if (identity) {
    return identity.userId;
  }

  const newUser = await db.insert(users).values({}).returning();
  const userId = newUser[0]!.id;

  await db.insert(userIdentities).values({
    userId,
    platform: "discord",
    identity: discordId,
  });

  return userId;
};