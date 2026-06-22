// React-free generic setters for the PWA store's draft form / secret fields.
//
// Lifted out of store.tsx so the dozen-plus near-identical
// updateXForm/updateXPassword methods can delegate to two typed reducers
// instead of each repeating the same nested-spread setState body. Each returns
// a NEW state (pure, immutable) so they can be unit-tested without standing up
// the provider, and so the existing setState((current) => ...) call sites keep
// the exact same update semantics.
import type { PwaDraftSecrets, PwaDraftState, PwaPersistedState } from './types';

/**
 * Set a single field on one of the plain `{ [field]: string }` draft forms
 * (createForm, rotationForm, profileForm, importProfileForm, importSaveForm,
 * onboardConnectForm, onboardSaveForm, rotateConnectForm). The array-bearing
 * (rotation/recover sources) and Record-keyed (distribution*) draft slices are
 * NOT routed through here — they have their own index-aware setters.
 */
export function setDraftFormField<K extends keyof PwaDraftState>(
  state: PwaPersistedState,
  formKey: K,
  field: keyof PwaDraftState[K] & string,
  value: string,
): PwaPersistedState {
  const drafts: PwaDraftState = {
    ...state.drafts,
    [formKey]: {
      ...(state.drafts[formKey] as Record<string, unknown>),
      [field]: value,
    },
  } as PwaDraftState;
  return { ...state, drafts };
}

/**
 * Set a single scalar secret field on `draftSecrets`. Password/confirm pairs
 * select the concrete key at the call site (e.g.
 * `field === 'password' ? 'profileFormPassword' : 'profileFormConfirm'`), so
 * this stays a one-field setter and never has to know the pairing convention.
 */
export function setDraftSecretField<K extends keyof PwaDraftSecrets>(
  state: PwaPersistedState,
  key: K,
  value: PwaDraftSecrets[K],
): PwaPersistedState {
  const draftSecrets: PwaDraftSecrets = {
    ...state.draftSecrets,
    [key]: value,
  };
  return { ...state, draftSecrets };
}
