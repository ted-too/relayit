# Encryption Key Rotation Guide

This document explains how to safely rotate encryption keys in RelayIt's self-hosted environment.

## Overview

RelayIt uses versioned encryption keys to enable zero-downtime key rotation. The system automatically migrates encrypted data when a new key version is detected.

## Environment Configuration

```bash
# Version control
ENCRYPTION_KEY_VERSION=v1

# Versioned keys (64-character hex strings)
CREDENTIAL_ENCRYPTION_KEY_V1=76e8ec9626295942247515256b3ae48925836e889efb4c645c88c203b655709e
```

## Key Rotation Process

### Step 1: Generate New Key
```bash
# Generate a new 32-byte (64 hex characters) key
openssl rand -hex 32
# Example output: a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

### Step 2: Add New Key to Environment
```bash
# Keep existing version active
ENCRYPTION_KEY_VERSION=v1
CREDENTIAL_ENCRYPTION_KEY_V1=76e8ec9626295942247515256b3ae48925836e889efb4c645c88c203b655709e

# Add new key (don't activate yet)
CREDENTIAL_ENCRYPTION_KEY_V2=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

### Step 3: Deploy and Activate New Version
```bash
# Update version to trigger migration
ENCRYPTION_KEY_VERSION=v2
CREDENTIAL_ENCRYPTION_KEY_V1=76e8ec9626295942247515256b3ae48925836e889efb4c645c88c203b655709e
CREDENTIAL_ENCRYPTION_KEY_V2=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

### Step 4: Server Startup (Automatic Migration)
When the server starts, it will:
1. Detect version mismatch (env: v2, db: v1)
2. Create migration record in `encryption_migration` table
3. Re-encrypt all registered encrypted data with v2 key
4. Update database version to v2
5. Complete startup process

### Step 5: Cleanup (After Migration Success)
```bash
# Remove old key after migration completes
ENCRYPTION_KEY_VERSION=v2
CREDENTIAL_ENCRYPTION_KEY_V2=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

## Monitoring Migration Progress

### Check Migration Status
```sql
-- View current encryption version
SELECT * FROM system_config WHERE key = 'encryption_version';

-- Check migration progress
SELECT * FROM encryption_migration ORDER BY started_at DESC LIMIT 5;

-- View migration details
SELECT 
  id,
  from_version,
  to_version,
  status,
  migrated_records,
  total_records,
  started_at,
  completed_at,
  error_message
FROM encryption_migration 
WHERE status = 'in_progress';
```

### Log Monitoring
```bash
# Watch migration progress in application logs
tail -f /var/log/relayit/api.log | grep "Key rotation\|Migrated"
```

## Rollback Strategy

### Emergency Rollback (During Migration)

If migration fails or needs to be stopped:

#### Step 1: Stop Application
```bash
# Stop the API server immediately
systemctl stop relayit-api
# or
pkill -f "relayit-api"
```

#### Step 2: Revert Environment Version
```bash
# Revert to previous version
ENCRYPTION_KEY_VERSION=v1  # Back to old version
CREDENTIAL_ENCRYPTION_KEY_V1=76e8ec9626295942247515256b3ae48925836e889efb4c645c88c203b655709e
CREDENTIAL_ENCRYPTION_KEY_V2=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

#### Step 3: Mark Migration as Failed (Optional)
```sql
-- Mark migration as failed to prevent restart attempts
UPDATE encryption_migration 
SET status = 'failed', error_message = 'Manual rollback initiated'
WHERE status = 'in_progress';
```

#### Step 4: Restart Application
```bash
# Start with old version - no migration will run
systemctl start relayit-api
```

### Post-Migration Rollback (Advanced)

If you need to rollback after migration completes:

#### Option A: Restore from Backup (Recommended)
```bash
# Restore database from backup taken before rotation
pg_restore -d relayit_db backup_before_rotation.sql

# Revert environment to old version
ENCRYPTION_KEY_VERSION=v1
CREDENTIAL_ENCRYPTION_KEY_V1=76e8ec9626295942247515256b3ae48925836e889efb4c645c88c203b655709e
```

#### Option B: Reverse Migration (Complex)
```bash
# Create reverse migration by swapping versions
ENCRYPTION_KEY_VERSION=v1  # Target version
CREDENTIAL_ENCRYPTION_KEY_V1=76e8ec9626295942247515256b3ae48925836e889efb4c645c88c203b655709e
CREDENTIAL_ENCRYPTION_KEY_V2=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456

# Update database version manually to trigger reverse migration
UPDATE system_config SET value = 'v2' WHERE key = 'encryption_version';

# Restart server - will migrate v2 → v1
```

## Best Practices

### Pre-Rotation Checklist
- [ ] **Backup database** before rotation
- [ ] **Test new key generation** in staging environment
- [ ] **Verify disk space** for migration logs and temporary data
- [ ] **Schedule during low-traffic period**
- [ ] **Have rollback plan ready**

### During Rotation
- [ ] **Monitor migration progress** via logs and database
- [ ] **Watch system resources** (CPU, memory, disk I/O)
- [ ] **Keep old key available** until migration completes
- [ ] **Don't interrupt migration** unless critical

### Post-Rotation
- [ ] **Verify application functionality** with new keys
- [ ] **Test decryption** of recently encrypted data
- [ ] **Monitor error rates** for encryption/decryption failures
- [ ] **Clean up old keys** after confidence period
- [ ] **Update backup procedures** with new key version

## Troubleshooting

### Migration Stuck or Failed
```sql
-- Check migration status
SELECT * FROM encryption_migration WHERE status IN ('in_progress', 'failed');

-- Reset failed migration (allows retry)
UPDATE encryption_migration SET status = 'failed' WHERE status = 'in_progress';
```

### Key Not Found Errors
```bash
# Verify environment variables are set
env | grep CREDENTIAL_ENCRYPTION_KEY
env | grep ENCRYPTION_KEY_VERSION

# Check key format (should be 64 hex characters)
echo $CREDENTIAL_ENCRYPTION_KEY_V1 | wc -c  # Should output 65 (64 + newline)
```

### Performance Issues During Migration
```sql
-- Monitor migration progress
SELECT 
  migrated_records::int,
  total_records::int,
  (migrated_records::float / total_records::float * 100)::int as percent_complete
FROM encryption_migration 
WHERE status = 'in_progress';
```

## Security Considerations

### Key Storage
- **Never commit keys to version control**
- **Use secure environment variable management**
- **Rotate keys regularly** (recommended: every 6-12 months)
- **Generate keys with cryptographically secure random generators**

### Access Control
- **Limit access to environment variables** containing keys
- **Log key rotation events** for audit trails
- **Use separate keys per environment** (dev, staging, prod)

### Backup Strategy
- **Backup database before rotation**
- **Store backup keys securely** for emergency decryption
- **Test restore procedures** regularly
- **Document key history** for compliance

## Emergency Contacts

In case of encryption emergencies:
- Database Admin: [Your DBA contact]
- Security Team: [Your security contact]
- On-call Engineer: [Your on-call contact]

## Key Generation Script

```bash
#!/bin/bash
# generate-encryption-key.sh

echo "Generating new encryption key..."
NEW_KEY=$(openssl rand -hex 32)
echo "New key: $NEW_KEY"
echo ""
echo "Add to your environment:"
echo "CREDENTIAL_ENCRYPTION_KEY_V<next_version>=$NEW_KEY"
echo ""
echo "⚠️  Store this key securely and never commit to version control!"
```

Make the script executable:
```bash
chmod +x generate-encryption-key.sh
./generate-encryption-key.sh
```
