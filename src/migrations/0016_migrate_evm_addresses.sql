-- Migrate EVM addresses from userIdentities to users table
UPDATE users 
SET address = ui.identity
FROM user_identities ui
WHERE users.id = ui.user_id 
  AND ui.platform = 'evm' 
  AND ui.is_primary = true;

-- Remove EVM identity records after migration
DELETE FROM user_identities 
WHERE platform = 'evm';