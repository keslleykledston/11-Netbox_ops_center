# Deployment Instructions - Oxidized VRP Fix

## Changes Deployed

### 1. Custom VRP Model
**File:** `docker/oxidized-custom-models/vrp.rb`  
- Handles Huawei password change prompts
- Supports hostnames with colons (e.g., `Device:X_NE8000`)

### 2. Legacy SSH Algorithm Support
**File:** `server/src/modules/monitor/oxidized-service.js`  
- Enabled legacy KEX algorithms (diffie-hellman-group1-sha1, etc.)
- Enabled legacy host keys (ssh-rsa, ssh-dss)
- Enabled legacy ciphers (aes128-cbc, 3des-cbc, etc.)

### 3. Docker Compose Update
**File:** `docker-compose.yml`  
- Mounted `docker/oxidized-custom-models` to Oxidized container

## Deployment Steps

### For Existing Installations

```bash
# 1. Pull latest code
cd /opt/netbox-ops-center
git pull origin main

# 2. Restart containers to apply changes
docker-compose down
docker-compose up -d

# 3. Verify Oxidized loaded custom model
docker exec netbox-ops-center-oxidized ls -la /home/oxidized/.config/oxidized/model/vrp.rb
```

### For New Installations

The custom VRP model and configurations are now part of the standard deployment. Simply run:

```bash
./install.sh
```

## Verification

1. Check Oxidized logs for successful backup:
```bash
docker logs -f netbox-ops-center-oxidized
```

2. Look for:
```
Intercepted Password Change Prompt!
Config fetched for <DEVICE_NAME>
```

3. Verify in UI:
   - Go to "Backup" tab
   - Check device status shows "Success"

## Troubleshooting

If backup still fails after deployment:

1. **Check custom model is mounted:**
```bash
docker exec netbox-ops-center-oxidized cat /home/oxidized/.config/oxidized/model/vrp.rb
```

2. **Force config regeneration:**
```bash
docker exec netbox-ops-center-backend curl -X POST http://localhost:4000/api/oxidized/regenerate-config
docker restart netbox-ops-center-oxidized
```

3. **Verify SSH connectivity from Oxidized container:**
```bash
docker exec netbox-ops-center-oxidized ssh -v -p 51212 user@device-ip
```
