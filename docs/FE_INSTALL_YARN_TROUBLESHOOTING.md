# Installation Troubleshooting

## Network Timeout Error

If you encounter `ETIMEDOUT` errors during `yarn install`, try these solutions:

### Solution 1: Retry Installation
```bash
# Clear yarn cache and retry
yarn cache clean
yarn install
```

### Solution 2: Use npm instead (if yarn continues to fail)
```bash
# Remove yarn.lock temporarily and use npm
npm install
```

### Solution 3: Configure Yarn Registry (if behind proxy/firewall)
```bash
# Set registry to use HTTP instead of HTTPS
yarn config set registry http://registry.npmjs.org/

# Or use a different registry
yarn config set registry https://registry.yarnpkg.com/

# Then retry
yarn install
```

### Solution 4: Install Firebase Manually
If network issues persist, you can try installing Firebase directly:
```bash
yarn add firebase@^10.7.1
```

### Solution 5: Check Network/Firewall
- Ensure you have internet connectivity
- Check if your firewall is blocking npm/yarn registry access
- Try from a different network if possible

## Build Error: Cannot find module 'firebase/firestore'

This error occurs when:
1. Firebase package is not installed (due to failed `yarn install`)
2. TypeScript can't find the Firebase types

**Solution**: Complete the installation first:
```bash
# Ensure Firebase is installed
yarn install

# If that fails, try:
npm install

# Then rebuild
yarn build
```

## Verification

After successful installation, verify Firebase is installed:
```bash
# Check if firebase is in node_modules
ls node_modules/firebase

# Or check package.json
grep firebase package.json
```

You should see:
```json
"firebase": "^10.7.1"
```

## Alternative: Use npm

If yarn continues to have issues, you can use npm:
```bash
# Remove yarn.lock (optional, npm will create package-lock.json)
rm yarn.lock

# Install with npm
npm install

# Build with npm
npm run build
```

Note: The project uses yarn by default, but npm should work fine for installation.

