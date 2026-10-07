import { enforceOptions } from 'broadcast-channel';

// Alternate real transport for sandboxes that forbid the default Unix socket.
// Keep the default test command intact. This skips no leadership assertions.
enforceOptions({ type: 'native' });
