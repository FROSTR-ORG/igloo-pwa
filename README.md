# Igloo PWA

A NIP-46 signing device for mobile and web, powered by FROSTR.

More documentation coming soon!

## Mobile WebSocket Persistence

This PWA now includes several strategies to keep WebSocket connections alive on mobile devices:

### Features Added

1. **Page Visibility API**: Detects when the app goes to background/foreground
2. **Automatic Reconnection**: Exponential backoff reconnection with up to 10 attempts
3. **Keep-Alive Pings**: Periodic pings to maintain connection health (every 30 seconds)
4. **Service Worker Background Sync**: Attempts to reconnect when the app is in background
5. **Connection State Monitoring**: Tracks connection health and triggers recovery

### How It Works

When you switch focus away from the browser tab on mobile:

1. **Page Hidden**: The app detects the visibility change and prepares for background mode
2. **Background Sync**: Registers a service worker background sync event
3. **Connection Monitoring**: Continues to monitor connection state
4. **Page Visible**: When you return to the app, it checks connection health and reconnects if needed
5. **Keep-Alive**: Resumes periodic pings to maintain connection

### Testing on Mobile

To test the mobile websocket persistence:

1. Open the app on your mobile device
2. Ensure you're connected (check the node status in Dashboard)
3. Switch to another app or browser tab
4. Wait 30-60 seconds
5. Return to the app - it should automatically reconnect if the connection was lost

### Configuration

You can adjust the reconnection behavior in `src/services/node/class.ts`:

```typescript
private _maxReconnectAttempts : number = 10        // Max retry attempts
private _reconnectDelay : number = 1000           // Initial delay (1 second)
private _keepAliveInterval : number = 30000       // Keep-alive interval (30 seconds)
```

### Browser Support

- **Page Visibility API**: Supported in all modern browsers
- **Service Worker Background Sync**: Supported in Chrome, Edge, Firefox
- **Keep-Alive Pings**: Works in all browsers with WebSocket support

### Debugging

Monitor the console for these log messages:
- `page visibility changed: visible/hidden`
- `attempting reconnection X/10 in Xms`
- `keep-alive pings sent`
- `background sync registered`

### Console Debugging Commands

You can test the connection status in the browser console:

```javascript
// Get connection info
if (window.global?.service?.node) {
  console.log('Connection Info:', window.global.service.node.getConnectionInfo());
}

// Manually trigger reconnection
if (window.global?.service?.node) {
  window.global.service.node.attemptReconnection();
}

// Check service worker registration
navigator.serviceWorker.ready.then(registration => {
  console.log('Service Worker ready:', registration);
  if ('sync' in registration) {
    registration.sync.register('keep-alive-sync');
    console.log('Background sync registered');
  }
});
```
