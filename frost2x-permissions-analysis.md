# Frost2x Permissions System Analysis

## Overview

The Frost2x browser extension implements a comprehensive permissions system that controls how websites can interact with the extension's functionality. This system is designed to manage access to Nostr signing operations, ensuring that users maintain control over which websites can perform specific actions.

## Data Structures

The permission system revolves around several key data structures defined in the type system.

### Core Types

From `src/types/perm.ts`:

```typescript
// Policy domain types (from CONST.POLICY_DOMAIN)
export type PolicyDomain = typeof CONST.POLICY_DOMAIN[keyof typeof CONST.POLICY_DOMAIN]
// Currently includes: 'nostr', 'bitcoin'

// Policy method types (from CONST.MESSAGE_TYPE)
export type PolicyMethod = typeof CONST.MESSAGE_TYPE[keyof typeof CONST.MESSAGE_TYPE]
// Includes methods like: 'nostr.getPublicKey', 'nostr.signEvent', etc.

// Policy accept values (string booleans)
export type PolicyAccept = 'true' | 'false'
```

### Base Policy

All permissions derive from the `BasePolicy` interface:

```typescript
export interface BasePolicy {
  host       : string       // The website domain (e.g., "iris.to")
  type       : PolicyMethod // The method name (e.g., "nostr.signEvent")
  accept     : PolicyAccept // Whether it's allowed ('true' or 'false')
  created_at : number       // Unix timestamp when created
}
```

### Signer Policy

The `SignerPolicy` extends the base policy with additional fields for signing operations:

```typescript
export interface SignerPolicy extends BasePolicy {
  conditions? : SignerPolicyConditions // Optional conditions for when to apply
  params?     : SignerPolicyParams     // Optional parameters for context
}
```

### Policy Conditions

Conditions allow fine-grained control over when permissions apply:

```typescript
export interface SignerPolicyConditions {
  kinds?        : Record<number, boolean> // Maps event kinds to boolean (allowed/disallowed)
  [key: string] : any                     // Extensible for future condition types
}
```

### Policy Parameters

Parameters provide context for permission decisions:

```typescript
export interface SignerPolicyParams {
  event?        : NostrEvent    // The event being signed
  [key: string] : any           // Extensible for other parameters
}
```

## Storage Implementation

The permission system uses a persistent storage mechanism implemented in `src/stores/perms.ts`.

### Store Interface

```typescript
export interface Store {
  signer  : SignerPolicy[]  // Array of signer policies
  wallet  : WalletPolicy[]  // Array of wallet policies (not currently used)
}
```

### Default Store

```typescript
const DEFAULT_STORE : Store = {  
  signer : [],
  wallet : []
}
```

### PermStore API

The store is wrapped in a namespace that provides access methods:

```typescript
export namespace PermStore {
  export type  Type    = Store
  export const DEFAULT = DEFAULT_STORE
  export const { fetch, reset, update, subscribe, use } = API
}
```

Available API methods:
- `fetch()`: Returns Promise<Store> - loads current permissions
- `reset()`: Returns Promise<void> - resets to default state
- `update(partial: Partial<Store>)`: Returns Promise<void> - merges updates
- `subscribe(callback: (store: Store) => void)`: Sets up a subscription
- `use()`: React hook to access store state and subscribe to changes

## Utility Functions

Several utility functions are defined in `src/lib/perms.ts` to manage permissions:

### Permission Check

```typescript
export function is_permission_required(key: string): boolean {
  return !(
    key in CONST.PERMISSION_BYPASS &&
    CONST.PERMISSION_BYPASS[key]
  )
}
```
This function checks if a permission is needed for a given method type by consulting the `PERMISSION_BYPASS` constant. System messages like `store.update`, `node.reset`, etc. bypass permission checks.

### Policy Finder

```typescript
export function find_policy_idx(
  table  : BasePolicy[],
  host   : string,
  type   : string,
  accept : boolean
) : number {
  return table.findIndex(row => 
    row.host   === host   && 
    row.type   === type   && 
    row.accept === String(accept)
  )
}
```
Finds the index of a policy in a table that matches the given criteria.

### Policy Filtering

```typescript
export function filter_policy(
  table  : BasePolicy[],
  host   : string,
  type   : string,
  accept : string
) : BasePolicy[] {
  return table.filter(perm => (
    !(perm.host === host && perm.accept === accept && perm.type === type)
  ))
}
```
Filters out (removes) policies matching the specified criteria.

### Reverse Policy Removal

```typescript
export function remove_reverse_policy(
  table  : BasePolicy[],
  policy : BasePolicy
) {
  // Check for reverse policy (accept/reject) that matches these conditions.
  const reverse_idx = table.findIndex(row => 
    row.host   === policy.host && 
    row.type   === policy.type &&
    row.accept === String(!policy.accept)
  )
  // Remove reverse policy if it exists.
  if (reverse_idx !== -1) {
    table.splice(reverse_idx, 1)
  }
}
```
Removes any contradictory policies. If adding an "allow" policy, this removes any corresponding "deny" policy for the same host and type (and vice versa).

## Signer Permissions Implementation

The implementation of signer permissions is defined in `src/permissions/signer.ts`:

### Permission Checking

```typescript
export async function get_signer_permission(
  host    : string,
  type    : string,
  params? : { event?: NostrEvent }
): Promise<boolean | null> {
  const perms = await PermStore.fetch().then(store => store.signer)
  // Iterate over the permissions.
  for (const policy of perms) {
    // If the policy matches the host and type,
    if (policy.host === host && policy.type === type) {
      // If the type is signEvent,
      if (type === 'nostr.signEvent' && params?.event) {
        // If the event has conditions set,
        if (policy.conditions) {
          // If the conditions have a kinds object,
          if (policy.conditions.kinds) {
            // If the event matches the conditions,
            if (match_event_conditions(policy.conditions, params.event)) {
              // Return the accept value.
              return policy.accept === 'true' ? true : false
            }
          } else {
            // Accept all is set for events.
            return policy.accept === 'true' ? true : false
          }
        }
      } else {
        // Accept all is set for non-signEvent requests.
        return policy.accept === 'true' ? true : false
      }
    }
  }
  // Return null if no policy matches the host and type.
  return null
}
```

This function performs the core permission check:
1. Fetches permissions from storage
2. Looks for a matching policy by host and type
3. For `nostr.signEvent` with event conditions:
   - Checks if the event matches the conditions
   - Returns the permission decision (true/false)
4. For other operations, simply returns the policy's accept value
5. Returns null if no matching policy is found (prompting a user permission request)

### Permission Updating

```typescript
export async function update_signer_permission(
  host        : string,
  type        : PolicyMethod,
  accept      : boolean,
  conditions? : SignerPolicyConditions
) : Promise<void> {
  // Create a new array to avoid mutating the original
  const perms = await PermStore.fetch().then(store => store.signer)
  // Check if we already have a matching policy
  const policy_idx = find_policy_idx(perms, host, type, accept)
  // If we found an existing policy with same accept value,
  if (policy_idx != -1) {
    const existing = perms[policy_idx]
    const updated  = update_policy(existing, conditions)
    // Update the policy.
    perms[policy_idx] = updated
  // Else, we need to add a new policy.
  } else {
    // Add new policy
    const policy : SignerPolicy = {
      host,
      type,
      conditions,
      accept     : accept ? 'true' : 'false',
      created_at : Math.round(Date.now() / 1000)
    }
    remove_reverse_policy(perms, policy)
    perms.push(policy)
  }
  // Update the policy store.
  return PermStore.update({ signer: perms }).then()
}
```

This function handles adding or updating permissions:
1. Fetches current permissions
2. Checks if an existing policy matches the criteria
3. If found, updates the existing policy with new conditions
4. If not found, creates a new policy:
   - Removes any contradictory policies
   - Adds the new policy to the array
5. Persists the updated permissions to storage

### Event Condition Matching

```typescript
function match_event_conditions(
  conditions : SignerPolicyConditions,
  event      : NostrEvent
): boolean {
  // If there are kind conditions,
  if (conditions?.kinds) {
    // If the event kind is in the kinds object,
    const kind_policy = conditions.kinds[event.kind]
    if (kind_policy !== undefined) {
      // Return the value of the event kind in the kinds object.
      return kind_policy
    }
  }
  // Otherwise, return false.
  return false
}
```

This function determines if an event matches the conditions:
1. Checks if kind conditions are specified
2. Looks up the policy for the specific event kind
3. Returns the policy value if found
4. Returns false if no matching condition exists

### Policy Updating

```typescript
function update_policy(
  policy      : SignerPolicy,
  conditions? : SignerPolicyConditions
): SignerPolicy {
  // Define the new conditions variable.
  let new_conditions : SignerPolicyConditions | undefined
  // If both the policy and the new conditions are defined,
  if (policy?.conditions !== undefined && conditions !== undefined) {
    // If the new conditions are empty,
    if (Object.keys(conditions).length === 0) {
      // Return the new conditions.
      new_conditions = conditions
    } else {  
      // Make a deep copy of the conditions.
      const copied = copy_conditions(policy?.conditions)
      // Merge conditions properly.
      new_conditions = merge_event_conditions(copied, conditions)
    }
  // Else, if only the policy has conditions,
  } else if (policy?.conditions !== undefined) {
    // Return the policy conditions.
    new_conditions = policy?.conditions
  } else {
    // Return undefined.
    new_conditions = undefined
  }
  // Return the updated policy.
  return {
    ...policy,
    conditions : new_conditions,
    created_at : Math.floor(Date.now() / 1000)
  }
}
```

This function handles updating an existing policy with new conditions:
1. Determines how to handle the conditions based on what exists
2. If both old and new conditions exist:
   - If new conditions are empty, use them directly
   - Otherwise, merge the conditions properly
3. If only old conditions exist, keep them
4. If no conditions exist, set to undefined
5. Returns the updated policy with a fresh timestamp

### Condition Merging

```typescript
function merge_event_conditions(
  curr : SignerPolicyConditions,
  next : SignerPolicyConditions
): SignerPolicyConditions {
  if (next.kinds !== undefined) {
    if (!curr.kinds) {
      curr.kinds = {}
    }
    Object.keys(next.kinds).forEach(kind => {
      curr.kinds![Number(kind)] = true
    })
  }
  return curr
}
```

This function merges conditions from two sources:
1. If the new conditions have kind specifications
2. Ensures the current conditions have a kinds object
3. Adds each new kind to the current conditions, setting it to true
4. Returns the merged conditions

### Utilities

```typescript
function copy_conditions(
  conditions? : SignerPolicyConditions
): SignerPolicyConditions {
  return JSON.parse(JSON.stringify(conditions ?? {}))
}
```

This utility creates a deep copy of condition objects to avoid mutation issues.

## Permission Flow

The complete permission flow works as follows:

1. A website requests access to a method via the content script
2. The background script receives the request and checks for existing permissions 
3. If permission exists:
   - For signEvent, checks if the event matches any conditions
   - For other methods, simply returns the policy decision
4. If no permission exists:
   - The mutex lock is acquired to prevent race conditions
   - A popup window opens to prompt the user for permission
   - The user's decision is stored in the permission store
   - Future requests use the stored policy

## Security Considerations

The permissions system implements several important security features:

1. **Domain Isolation**: Permissions are strictly tied to host domains, preventing cross-site attacks
2. **Fine-grained Control**: For signing events, permissions can be limited to specific event kinds
3. **Race Condition Prevention**: Mutex locks ensure that only one permission prompt can be active
4. **Contradiction Resolution**: Adding a new permission automatically removes contradictory ones
5. **Deep Copying**: Objects are deep-copied to prevent mutation-based attacks
6. **Typed Interface**: TypeScript interfaces ensure data structure correctness
7. **User Control**: All permissions can be viewed and revoked through the UI
